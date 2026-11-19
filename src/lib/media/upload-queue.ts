/**
 * Files on their way into an entry, one at a time.
 *
 * Like the autosave controller, this knows nothing about Svelte, TipTap or the
 * network: it is handed functions that prepare a file, read the allowance and
 * store a file, and everything here is order and bookkeeping. That is what lets
 * `upload-queue.test.ts` drive the awkward cases — a file refused at its turn
 * that was fine when it was picked, a retry, an entry that filled up meanwhile —
 * with no browser.
 *
 * ---------------------------------------------------------------------------
 * ONE AT A TIME, AND CHECKED AT ITS TURN
 * ---------------------------------------------------------------------------
 * The server checks each file against the allowance when it hands out the
 * file's upload link, against what is already stored. It cannot see an upload
 * that is still running, so two asked for together would each be measured
 * against the same total. Storage's trigger would still refuse the one that
 * went over (`20261004120000_media_allowance_trigger`), but only after the
 * whole file had been sent, and with no figures to show. Running them one
 * after another means the check a file meets includes everything before it,
 * and a file that cannot fit is told so before anything is sent.
 *
 * For the same reason every check happens when the file's turn comes, not when
 * it was picked. Five photos picked together are each measured against the
 * space the four before them left, and against the entry's count after those
 * four went in.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PERSON SEES
 * ---------------------------------------------------------------------------
 * Each file has a placeholder where it will go, drawn by the editor from what
 * `onChange` reports: "Waiting…" until its turn, "Uploading…" while it is
 * prepared and sent, and on failure a message saying what happened and, when
 * trying again could help, a Try again button. A file that is refused for good
 * — a type Noteworthy does not store, a GIF over 25 MB — says so and offers
 * Remove only. Nothing here is ever in the document: the editor inserts the
 * photo, video or audio when `onStored` says the file is stored, and not before.
 */
import { MAX_MEDIA_PER_ENTRY, FILE_LIMIT_BYTES } from './limits';
import { ENTRY_FULL, noSpaceMessage, tooBigMessage, type FileNoun } from './messages';
import type { Intake } from './intake';
import type { PreparedMedia } from './prepare';

export type UploadStatus = 'waiting' | 'working' | 'failed';

/** One file as its placeholder draws it. */
export type UploadView = {
	id: string;
	name: string;
	status: UploadStatus;
	/** Set only when `status` is `failed`. */
	message: string | null;
	/** Whether Try again is worth offering. */
	retryable: boolean;
	/**
	 * The picture's pixel size once the file has been prepared, so its
	 * placeholder can take the shape it will land in. `null` before that, and
	 * always for audio.
	 */
	width: number | null;
	height: number | null;
};

export type StoredFile = PreparedMedia & { path: string };

/**
 * A refusal the queue should show as it stands. `policy` marks Storage's own
 * refusal, which is almost always the allowance: the queue reads the allowance
 * again to say so with numbers. `remaining` marks the server's allowance check
 * refusing, with the bytes left, which the queue says with its own noun.
 */
export class UploadRefused extends Error {
	readonly retryable: boolean;
	readonly policy: boolean;
	readonly remaining: number | null;

	constructor(
		message: string,
		options: { retryable: boolean; policy?: boolean; remaining?: number }
	) {
		super(message);
		this.name = 'UploadRefused';
		this.retryable = options.retryable;
		this.policy = options.policy ?? false;
		this.remaining = options.remaining ?? null;
	}
}

export type UploadQueueOptions = {
	/** What `intake` made of the file, for the ones it accepted. */
	prepare: (file: File, intake: Extract<Intake, { ok: true }>) => Promise<PreparedMedia>;
	/**
	 * Bytes left in the allowance, or `null` for nobody signed in. Asked only
	 * after Storage refuses a file, to say why.
	 */
	remaining: () => Promise<number | null>;
	/**
	 * Stores the prepared file, checking it against the allowance first, and
	 * resolves to its path and the bytes that were left before it. Throws
	 * `UploadRefused`.
	 */
	store: (prepared: PreparedMedia) => Promise<{ path: string; remaining: number }>;
	/** How many photos, videos and recordings the entry holds right now. */
	held: () => number;
	/** The file is stored: put it in the entry. */
	onStored: (id: string, file: StoredFile) => void;
	/** Every change to any item. */
	onChange: (items: UploadView[]) => void;
	/** The allowance, whenever the queue learns it. */
	onRemaining?: (bytes: number) => void;
	/** Turns an unexpected throw into something to show, about a file called `noun`. */
	describe?: (thrown: unknown, noun: FileNoun) => string;
};

export type UploadQueue = {
	/** Queues files, in order, and returns an id for each. */
	add: (files: File[], intakes: Intake[]) => string[];
	/**
	 * Every queued file as its placeholder draws it.
	 *
	 * `add` announces before its caller has had a chance to make the placeholders
	 * — it cannot hand out ids any earlier — so the caller reads the first state
	 * from here rather than waiting for the next change, which might be seconds
	 * away for a file that is still waiting its turn.
	 */
	views: () => UploadView[];
	retry: (id: string) => void;
	/** Drops a file that is waiting or has failed. One that is uploading cannot be. */
	remove: (id: string) => void;
	/**
	 * Drops every file, the one being prepared or uploaded too: whatever it
	 * becomes is not handed to `onStored`. A file that reaches Storage anyway is
	 * named by no entry, and the nightly job removes it. "Use the saved version".
	 */
	cancel: () => void;
	/** True while anything is waiting or uploading: leaving would lose it. */
	busy: () => boolean;
	destroy: () => void;
};

type Item = {
	id: string;
	file: File;
	intake: Intake;
	noun: FileNoun;
	status: UploadStatus;
	message: string | null;
	retryable: boolean;
	/** Kept across a retry, so a failed upload is not re-encoded to try again. */
	prepared: PreparedMedia | null;
	/** Order of service: a retried file goes to the back. */
	turn: number;
};

let ids = 0;

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
	const items: Item[] = [];
	let turns = 0;
	let running = false;
	let destroyed = false;

	function views(): UploadView[] {
		return items.map(({ id, file, status, message, retryable, prepared }) => ({
			id,
			name: file.name,
			status,
			message,
			retryable,
			width: prepared?.width ?? null,
			height: prepared?.height ?? null
		}));
	}

	function announce(): void {
		if (!destroyed) {
			options.onChange(views());
		}
	}

	function fail(item: Item, message: string, retryable: boolean): void {
		item.status = 'failed';
		item.message = message;
		item.retryable = retryable;
	}

	/** Files that will go into the entry unless something stops them. */
	function inFlight(): number {
		return items.filter((item) => item.status !== 'failed').length;
	}

	async function serve(item: Item): Promise<void> {
		const accepted = item.intake;
		if (!accepted.ok) {
			return;
		}

		try {
			if (item.prepared === null) {
				item.prepared = await options.prepare(item.file, accepted);
				// Its size is known now, a whole upload before it lands.
				announce();
			}
		} catch (thrown) {
			// A file that cannot be decoded or shrunk will not decode or shrink on a
			// second try either.
			fail(item, options.describe?.(thrown, item.noun) ?? String(thrown), false);
			return;
		}
		const prepared = item.prepared;
		if (!items.includes(item)) {
			// Cancelled while it was being prepared: nothing is sent.
			return;
		}

		if (prepared.blob.size > FILE_LIMIT_BYTES) {
			fail(item, tooBigMessage(item.noun, prepared.blob.size), false);
			return;
		}

		if (options.held() >= MAX_MEDIA_PER_ENTRY) {
			fail(item, ENTRY_FULL, true);
			return;
		}

		let path: string;
		let left: number;
		try {
			({ path, remaining: left } = await options.store(prepared));
		} catch (thrown) {
			if (thrown instanceof UploadRefused && thrown.remaining !== null) {
				// The allowance, checked before anything was sent.
				options.onRemaining?.(thrown.remaining);
				fail(item, noSpaceMessage(item.noun, prepared.blob.size, thrown.remaining), true);
				return;
			}
			if (thrown instanceof UploadRefused && thrown.policy) {
				// Storage's policy said no. Read the allowance again to say why, with
				// numbers; if it turns out there was room, say what Storage said.
				const now = await options.remaining().catch(() => null);
				if (now !== null) {
					options.onRemaining?.(now);
				}
				if (now !== null && prepared.blob.size > now) {
					fail(item, noSpaceMessage(item.noun, prepared.blob.size, now), true);
					return;
				}
			}
			if (thrown instanceof UploadRefused) {
				fail(item, thrown.message, thrown.retryable);
			} else {
				fail(item, options.describe?.(thrown, item.noun) ?? String(thrown), true);
			}
			return;
		}

		options.onRemaining?.(left - prepared.blob.size);
		const index = items.indexOf(item);
		if (index === -1) {
			// Cancelled while it was uploading: stored, and put nowhere.
			return;
		}
		items.splice(index, 1);
		if (!destroyed) {
			options.onStored(item.id, { ...prepared, path });
		}
	}

	async function pump(): Promise<void> {
		if (running || destroyed) {
			return;
		}
		running = true;
		try {
			for (;;) {
				const next = items
					.filter((item) => item.status === 'waiting')
					.sort((a, b) => a.turn - b.turn)[0];
				if (next === undefined || destroyed) {
					break;
				}
				next.status = 'working';
				announce();
				await serve(next);
				announce();
			}
		} finally {
			running = false;
		}
	}

	return {
		add(files, intakes) {
			const added: string[] = [];
			files.forEach((file, index) => {
				const intake = intakes[index];
				ids += 1;
				const item: Item = {
					id: `upload-${ids}`,
					file,
					intake,
					noun: intake.ok ? intake.noun : 'photo',
					status: 'waiting',
					message: null,
					retryable: false,
					prepared: null,
					turn: (turns += 1)
				};

				if (!intake.ok) {
					fail(item, intake.message, false);
				} else if (options.held() + inFlight() >= MAX_MEDIA_PER_ENTRY) {
					// Refused now rather than at its turn, where it is certain to be:
					// everything ahead of it will have gone in first.
					fail(item, ENTRY_FULL, true);
				}

				items.push(item);
				added.push(item.id);
			});
			announce();
			void pump();
			return added;
		},

		views,

		retry(id) {
			const item = items.find((candidate) => candidate.id === id);
			if (item === undefined || item.status !== 'failed' || !item.retryable) {
				return;
			}
			item.status = 'waiting';
			item.message = null;
			item.retryable = false;
			item.turn = turns += 1;
			announce();
			void pump();
		},

		remove(id) {
			const index = items.findIndex((candidate) => candidate.id === id);
			if (index === -1 || items[index].status === 'working') {
				return;
			}
			items.splice(index, 1);
			announce();
		},

		cancel() {
			items.splice(0, items.length);
			announce();
		},

		busy() {
			return items.some((item) => item.status !== 'failed');
		},

		destroy() {
			destroyed = true;
		}
	};
}
