/**
 * The signed links a page's photos are showing, kept fresh without anybody
 * noticing.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LIVES OUTSIDE THE DOCUMENT
 * ---------------------------------------------------------------------------
 * An entry stores paths, and a signed link is good for an hour. A page left
 * open longer than that — an entry read over breakfast, a laptop that slept
 * through lunch — would otherwise be showing addresses that no longer work.
 *
 * Refreshing must never be an edit. In the editor, a link that lived in the
 * document would make every refresh a transaction: a change for autosave to
 * write, a step for undo to take back, and a document that changed while
 * nobody touched it. So the document holds the path and nothing else, and this
 * holds the link, keyed by path. The editor's photo view and the read view's
 * `EntryImage` both subscribe here, and a refresh reaches them as a new `src`
 * on an `<img>` — ProseMirror is told to ignore that mutation, so it is not a
 * transaction at all.
 *
 * ---------------------------------------------------------------------------
 * WHEN IT REFRESHES
 * ---------------------------------------------------------------------------
 *   Ten minutes before the links expire, on a timer.
 *
 *   When the page becomes visible again and the links are that close, or past
 *   it. A sleeping laptop does not run timers, so the timer alone would wake up
 *   late, after the links had already died.
 *
 *   Once, when a photo fails to load. Whatever the reason — an expiry both of
 *   the above missed, a clock far enough out to fool them — a fresh link is
 *   worth one try. A second failure with a fresh link is not a link problem,
 *   and the photo says it could not be loaded.
 *
 *   For a path the page was not rendered with: a photo pasted in from another
 *   entry, or brought back by undo after a refresh left it out.
 *
 * Requests are batched, one for everything due at once, the same rule as on
 * the server. Only paths something is currently showing are refreshed.
 *
 * Expiry is measured on this browser's clock, from the lifetime the server
 * reported (`expiresAt - signedAt`) counted from when the batch arrived, not
 * from the server's `expiresAt` itself: a phone's clock can be minutes out, and
 * the margin is only ten.
 *
 * A photo uploaded from this page is shown from the file the browser already
 * has, through an object URL (`local`). Those do not expire and are never
 * refreshed, unless one fails, when the path is signed like any other.
 *
 * ---------------------------------------------------------------------------
 * THE SAME LINK AGAIN, SO THE BROWSER'S CACHE CAN ANSWER
 * ---------------------------------------------------------------------------
 * Every load signs afresh, and a link signed a second later is a different
 * address: to the browser, a file it has never seen. So a `LinkMemory` keeps,
 * for the document's life, the link each path was last shown with, and a batch
 * coming in prefers it over its own new link while it is not yet due for a
 * refresh — the same test, more than `earlyMs` of life left, that decides a
 * refresh. Anything less would be replaced at once, costing a request and the
 * very download it was meant to save. The entry opened again, the read page
 * then the editor, two entries naming one file, the Recycle Bin: each shows the
 * address the browser already holds, and Chrome answers it from its cache
 * (Storage sends `Expires` an hour on; measured on dev, PRD 09 Section 3).
 *
 * A remembered link that fails to load is forgotten, so the refresh that
 * follows takes the new one; so is a path the server no longer signs. Uploads'
 * object URLs are never remembered. Nothing here is written anywhere: the
 * memory is an object in the page's module, and ends with the document.
 *
 * A batch's life is counted from `receivedAt` when it carries one (the moment
 * the browser received it, or sent the request that fetched it, on this
 * object's clock), else from when it is taken in. That matters for a page's
 * data preloaded on hover and used minutes later.
 *
 * ---------------------------------------------------------------------------
 * A BATCH STILL ON ITS WAY
 * ---------------------------------------------------------------------------
 * On a tap, the entry's text is sent without waiting for its links, and the
 * links follow in the same response (PRD 09, Section 5): the first batch is a
 * promise. Until it lands, a path it will cover (`awaiting`) shows its
 * remembered link at once if it has one, and otherwise waits, `pending`,
 * without being signed through `/media/sign`, because the links are already
 * coming. When it lands it is taken in as a first batch always was.
 *
 * A batch that never lands as links is a batch that signed nothing: a promise
 * that rejects, and one still unsettled after `awaitMs`. SvelteKit's client
 * leaves a streamed promise unsettled for ever when the response ends without
 * its chunk (`process_stream` in `client.js`, 2.70.3). Every path still
 * without a link is then signed through `/media/sign`, as one the page was
 * rendered without, and the batch is ignored if it comes after all.
 */
import type { SignedMedia } from './signed';

export type LinkState =
	| { status: 'ready'; url: string }
	/** No link yet: one has been asked for. */
	| { status: 'pending' }
	/** The file could not be signed, or failed to load with a fresh link. */
	| { status: 'missing' };

type Listener = (state: LinkState) => void;

type Entry = {
	url: string | null;
	/** When `url` stops working, on this browser's clock. `Infinity` for a local URL. */
	expires: number;
	local: boolean;
	/** Set when a load failure has already cost one refresh; cleared by a load. */
	retried: boolean;
	missing: boolean;
};

/**
 * The link each path was last shown with in this document, and when it stops
 * working on the clock of the `MediaLinks` that use it. Shared by every page's
 * `MediaLinks`; never stored anywhere.
 */
export class LinkMemory {
	readonly #links = new Map<string, { url: string; expires: number }>();

	/** The remembered link for `path`, if it has more than `margin` left at `now`. */
	recall(path: string, now: number, margin: number): { url: string; expires: number } | null {
		const kept = this.#links.get(path);
		if (kept === undefined) {
			return null;
		}
		if (kept.expires - margin <= now) {
			if (kept.expires <= now) {
				this.#links.delete(path);
			}
			return null;
		}
		return kept;
	}

	keep(path: string, url: string, expires: number): void {
		this.#links.set(path, { url, expires });
	}

	/** Forgets `path`'s link; only if it is `url`, when given. */
	forget(path: string, url?: string): void {
		if (url === undefined || this.#links.get(path)?.url === url) {
			this.#links.delete(path);
		}
	}

	get size(): number {
		return this.#links.size;
	}
}

export type MediaLinksOptions = {
	/** Asks the server to sign `paths`; `/media/sign` in the app. */
	sign: (paths: string[]) => Promise<SignedMedia>;
	/** Links shown earlier in this document, preferred while they have life left. */
	memory?: LinkMemory;
	/** How long before expiry to refresh. Ten minutes. */
	earlyMs?: number;
	/** How long to wait before asking again after a request itself failed. */
	retryMs?: number;
	/**
	 * For a first batch still on its way: the paths it will be for. A remembered
	 * link for one is shown before it lands. See A BATCH STILL ON ITS WAY.
	 */
	awaiting?: Iterable<string>;
	/** How long after `start()` a batch on its way is given up for. Five seconds. */
	awaitMs?: number;
	now?: () => number;
	/**
	 * Calls back whenever the page becomes visible. Returns an unsubscribe.
	 * Defaults to `visibilitychange` on `document`; tests pass their own.
	 */
	onVisible?: (callback: () => void) => () => void;
};

export const REFRESH_EARLY_MS = 10 * 60 * 1000;
export const RETRY_MS = 60 * 1000;
/**
 * The links follow the text by the signing's time, 62 ms warm and up to 148
 * after an idle (measured on dev, PRD 09); five seconds is a response that has
 * stopped, not a slow one.
 */
export const AWAIT_MS = 5 * 1000;

function documentVisibility(callback: () => void): () => void {
	const listener = (): void => {
		if (document.visibilityState === 'visible') {
			callback();
		}
	};
	document.addEventListener('visibilitychange', listener);
	return () => document.removeEventListener('visibilitychange', listener);
}

export class MediaLinks {
	readonly #entries = new Map<string, Entry>();
	readonly #listeners = new Map<string, Set<Listener>>();
	readonly #sign: (paths: string[]) => Promise<SignedMedia>;
	readonly #early: number;
	readonly #retry: number;
	readonly #now: () => number;
	readonly #onVisible: (callback: () => void) => () => void;
	readonly #memory: LinkMemory | null;
	readonly #awaitMs: number;

	/** Paths waiting for the next batch. */
	#queued = new Set<string>();
	#flushScheduled = false;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#stopVisibility: (() => void) | null = null;
	#started = false;
	/** A first batch is on its way and has not been given up for. */
	#arriving = false;
	#deadline: ReturnType<typeof setTimeout> | null = null;

	constructor(initial: SignedMedia | Promise<SignedMedia>, options: MediaLinksOptions) {
		this.#sign = options.sign;
		this.#early = options.earlyMs ?? REFRESH_EARLY_MS;
		this.#retry = options.retryMs ?? RETRY_MS;
		this.#now = options.now ?? Date.now;
		this.#onVisible = options.onVisible ?? documentVisibility;
		this.#memory = options.memory ?? null;
		this.#awaitMs = options.awaitMs ?? AWAIT_MS;
		if (initial instanceof Promise) {
			this.#arriving = true;
			this.#recall(options.awaiting ?? []);
			initial.then(
				(batch) => this.#land(batch),
				() => this.#land(null)
			);
		} else {
			this.#adopt(initial, Object.keys(initial.urls));
		}
	}

	/** Starts the timer and the visibility check. Browser only; call on mount. */
	start(): void {
		if (this.#started) {
			return;
		}
		this.#started = true;
		if (this.#arriving) {
			this.#deadline = setTimeout(() => this.#land(null), this.#awaitMs);
		}
		this.#stopVisibility = this.#onVisible(() => this.#refreshDue());
		// Anything already due — a page restored from the back/forward cache, or
		// rendered with links that could not be signed — is asked for now.
		this.#refreshDue();
		// And anything asked for before this ran. Components mount before the page
		// that starts this, so a photo or player whose server-rendered link had
		// already failed reports it here first, and would otherwise wait for ever.
		this.#enqueue([]);
		this.#schedule();
	}

	stop(): void {
		this.#started = false;
		this.#stopVisibility?.();
		this.#stopVisibility = null;
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}
		if (this.#deadline !== null) {
			clearTimeout(this.#deadline);
			this.#deadline = null;
		}
	}

	/** The state for `path` right now. Safe on the server, where nothing is ever fetched. */
	state(path: string): LinkState {
		const entry = this.#entries.get(path);
		if (entry === undefined) {
			return { status: 'pending' };
		}
		if (entry.missing) {
			return { status: 'missing' };
		}
		return entry.url === null ? { status: 'pending' } : { status: 'ready', url: entry.url };
	}

	/**
	 * Calls `listener` with the state for `path` now and on every change, until
	 * the returned function is called. A path this page has no link for is
	 * signed; one whose link is due is refreshed.
	 */
	subscribe(path: string, listener: Listener): () => void {
		let set = this.#listeners.get(path);
		if (set === undefined) {
			set = new Set();
			this.#listeners.set(path, set);
		}
		set.add(listener);
		listener(this.state(path));

		if (this.#needsLink(path)) {
			this.#enqueue([path]);
		} else {
			// A working link that may expire before whatever the timer is set for.
			this.#schedule();
		}

		return () => {
			set.delete(listener);
			if (set.size === 0) {
				this.#listeners.delete(path);
			}
		};
	}

	/** A photo just uploaded from this page, shown from the browser's own copy. */
	local(path: string, url: string): void {
		this.#entries.set(path, {
			url,
			expires: Number.POSITIVE_INFINITY,
			local: true,
			retried: false,
			missing: false
		});
		this.#notify(path);
	}

	/** The element showing `url` for `path` loaded it; a later failure may retry again. */
	loaded(path: string): void {
		const entry = this.#entries.get(path);
		if (entry !== undefined) {
			entry.retried = false;
		}
	}

	/**
	 * The element showing `url` for `path` could not load it. Refreshes once;
	 * a second failure marks the photo missing.
	 */
	failed(path: string, url: string): void {
		const entry = this.#entries.get(path);
		if (entry === undefined || entry.url !== url) {
			// A newer link is already on its way to the element, or already there.
			return;
		}
		// Whatever the reason, this link is not offered to anything again.
		this.#memory?.forget(path, url);
		if (entry.retried) {
			entry.missing = true;
			this.#notify(path);
			return;
		}
		entry.retried = true;
		this.#enqueue([path]);
	}

	#due(entry: Entry): boolean {
		return entry.url === null || entry.expires - this.#early <= this.#now();
	}

	/**
	 * Whether `path` is to be signed now: it has no link, or a link that is due.
	 * Not one with no link while the first batch is on its way, which brings it.
	 */
	#needsLink(path: string): boolean {
		const entry = this.#entries.get(path);
		if (entry === undefined) {
			return !this.#arriving;
		}
		return !entry.local && this.#due(entry);
	}

	/** Refreshes every path something is showing whose link is due. */
	#refreshDue(): void {
		const due = [...this.#listeners.keys()].filter((path) => this.#needsLink(path));
		if (due.length > 0) {
			this.#enqueue(due);
		}
	}

	/** Shows the remembered link of each of `paths` that has one, ahead of the batch bringing them. */
	#recall(paths: Iterable<string>): void {
		const now = this.#now();
		for (const path of paths) {
			const kept = this.#memory?.recall(path, now, this.#early) ?? null;
			if (kept !== null) {
				this.#entries.set(path, {
					url: kept.url,
					expires: kept.expires,
					local: false,
					retried: false,
					missing: false
				});
			}
		}
	}

	/**
	 * The first batch landed, or `null`: it rejected, or `awaitMs` passed. Taken in
	 * as a first batch, and every path something shows that is still without a
	 * link is signed through the server. Once only: a batch that lands after it
	 * was given up for is older than what was asked for since.
	 */
	#land(batch: SignedMedia | null): void {
		if (!this.#arriving) {
			return;
		}
		this.#arriving = false;
		if (this.#deadline !== null) {
			clearTimeout(this.#deadline);
			this.#deadline = null;
		}
		if (batch !== null) {
			// Not a path whose remembered link already failed here: its own refresh
			// is on the way, and taking the batch's link first would make that
			// answer look like the same link again, and the file missing.
			const asked = Object.keys(batch.urls).filter((path) => !this.#entries.get(path)?.retried);
			this.#adopt(batch, asked);
		}
		this.#refreshDue();
		this.#schedule();
	}

	#enqueue(paths: string[]): void {
		for (const path of paths) {
			this.#queued.add(path);
		}
		if (this.#flushScheduled || !this.#started) {
			return;
		}
		this.#flushScheduled = true;
		// A microtask, so everything that asks in the same turn — every photo on a
		// page subscribing as it mounts — goes in one request.
		queueMicrotask(() => void this.#flush());
	}

	async #flush(): Promise<void> {
		this.#flushScheduled = false;
		const paths = [...this.#queued];
		this.#queued.clear();
		if (paths.length === 0 || !this.#started) {
			return;
		}

		let batch: SignedMedia;
		try {
			batch = await this.#sign(paths);
		} catch {
			// The request failed, not the files. Anything with no working link is
			// shown as missing for now and asked for again in a minute.
			for (const path of paths) {
				const entry = this.#entries.get(path);
				if (entry === undefined || entry.url === null || entry.retried) {
					this.#entries.set(path, {
						url: entry?.url ?? null,
						expires: entry?.expires ?? 0,
						local: false,
						retried: entry?.retried ?? false,
						missing: true
					});
					this.#notify(path);
				}
			}
			setTimeout(
				() => this.#enqueue(paths.filter((path) => this.#listeners.has(path))),
				this.#retry
			);
			return;
		}

		this.#adopt(batch, paths);
		this.#schedule();
	}

	/**
	 * Takes a batch in. `asked` is every path the batch was for, so that one it
	 * came back without — a file that is gone, or not the caller's — is marked
	 * missing rather than left waiting.
	 */
	#adopt(batch: SignedMedia, asked: string[]): void {
		const lifetime = batch.expiresAt - batch.signedAt;
		const now = this.#now();
		const fresh = (batch.receivedAt ?? now) + lifetime;

		for (const path of asked) {
			const signed = batch.urls[path];
			const previous = this.#entries.get(path);
			const remembered =
				signed === undefined ? null : (this.#memory?.recall(path, now, this.#early) ?? null);
			const url = remembered?.url ?? signed;
			const expires = remembered?.expires ?? fresh;
			if (url === undefined) {
				// Not signed: the file is gone, or not the caller's. Nothing to offer later.
				this.#memory?.forget(path);
				this.#entries.set(path, {
					url: previous?.url ?? null,
					expires: previous?.expires ?? 0,
					local: false,
					retried: previous?.retried ?? false,
					missing: true
				});
			} else {
				if (remembered === null) {
					this.#memory?.keep(path, url, expires);
				}
				this.#entries.set(path, {
					url,
					expires,
					local: false,
					// Kept across the refresh, so a second failure of the fresh link is
					// the one that gives up.
					retried: previous?.retried ?? false,
					// A link asked for *because* this one failed, that comes back
					// identical, is not another try: Storage signs the same path at the
					// same second into the same URL, and nothing would reload. Without
					// this the photo would sit there broken and say nothing.
					missing: previous?.retried === true && previous.url === url
				});
			}
			this.#notify(path);
		}
	}

	#schedule(): void {
		if (!this.#started) {
			return;
		}
		if (this.#timer !== null) {
			clearTimeout(this.#timer);
			this.#timer = null;
		}

		// Only links something is showing. A photo deleted from the entry keeps its
		// entry here, in case undo brings it back, but is not worth a request.
		let soonest = Number.POSITIVE_INFINITY;
		for (const path of this.#listeners.keys()) {
			const entry = this.#entries.get(path);
			if (entry !== undefined && !entry.local && entry.url !== null && !entry.missing) {
				soonest = Math.min(soonest, entry.expires);
			}
		}
		if (!Number.isFinite(soonest)) {
			return;
		}

		// The refresh this starts reschedules when its answer arrives; this does
		// not reschedule itself, or a due link would spin the timer until it did.
		const wait = Math.max(0, soonest - this.#early - this.#now());
		this.#timer = setTimeout(() => {
			this.#timer = null;
			this.#refreshDue();
		}, wait);
	}

	#notify(path: string): void {
		const state = this.state(path);
		for (const listener of this.#listeners.get(path) ?? []) {
			listener(state);
		}
	}
}
