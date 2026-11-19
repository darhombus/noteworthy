/**
 * When to save, and what to do when a save does not work.
 *
 * Deliberately knows nothing about Svelte, `fetch` or the DOM: it takes a
 * function that saves a value and a function to call when its state changes, and
 * everything else is timing and bookkeeping. That is what lets
 * `autosave.test.ts` drive the awkward cases — a save failing while another
 * change is queued, a flush arriving mid-flight — with fake timers and no
 * browser.
 *
 * ---------------------------------------------------------------------------
 * ONE SAVE AT A TIME, ALWAYS
 * ---------------------------------------------------------------------------
 * Two overlapping writes of the same row is the case that loses work, and it
 * loses it invisibly: the request that *started* second can arrive first, so the
 * older document wins and the newer one is overwritten by something a person
 * typed before it. Nothing errors. The entry just quietly goes backwards.
 *
 * The answer here is not to queue requests but to refuse to have two. While a
 * save is in flight nothing else is sent; when it finishes, the controller looks
 * at the current value and saves again if it has moved on. Only the latest value
 * matters, so a queue would be a queue of length one that kept throwing its
 * contents away — this keeps the value instead of the request.
 *
 * ---------------------------------------------------------------------------
 * THE TWO TIMERS
 * ---------------------------------------------------------------------------
 * `debounceMs` is the pause after the last change, and 1000ms is chosen against
 * how people type rather than against how fast the network is. The gap between
 * two words is a couple of hundred milliseconds; the gap between two sentences
 * is around a second. A shorter debounce fires mid-sentence and turns a paragraph
 * into a dozen writes, each ~250-300ms away in Frankfurt; a longer one starts to
 * feel like the app is not paying attention.
 *
 * `maxWaitMs` is the ceiling, and it exists because a debounce alone has no
 * upper bound: somebody typing steadily for four minutes would reset the timer
 * on every keystroke and never save at all. 5000ms means that however
 * continuously somebody writes, no more than five seconds of it is only in the
 * browser.
 *
 * ---------------------------------------------------------------------------
 * RECOVERY
 * ---------------------------------------------------------------------------
 * A failure does not schedule a retry of its own. A server that is down stays
 * down for longer than a timer, and a controller that kept trying would turn one
 * outage into a request every second from every open tab. Instead a failed save
 * is retried by the two things that mean somebody is still there: another edit,
 * which reschedules normally, and `flush()`, which is what the "Try again"
 * button and the browser coming back online both call.
 */

export type SaveState = 'saved' | 'pending' | 'saving' | 'failed';

/**
 * Why a save did not work. Six cases because they are six conversations:
 * `offline` will fix itself, `signed-out` needs a login, `invalid` needs an
 * edit, and `server` needs somebody else to do something. `stale` (the entry
 * changed somewhere else) and `deleted` (it is in the Recycle Bin) end saving
 * from this page: nothing sent from it again can be applied.
 */
export type FailureKind = 'offline' | 'signed-out' | 'invalid' | 'server' | 'stale' | 'deleted';

/** Thrown by the `save` function to say which kind of failure this was. */
export class SaveFailed extends Error {
	readonly kind: FailureKind;

	constructor(kind: FailureKind, message: string) {
		super(message);
		this.name = 'SaveFailed';
		this.kind = kind;
	}
}

export type AutosaveSnapshot = {
	state: SaveState;
	/** Set only while `state` is `failed`. */
	failure: FailureKind | null;
	message: string | null;
};

export type AutosaveOptions<T> = {
	/** Writes the value, or throws — `SaveFailed` to name the kind. */
	save: (value: T) => Promise<void>;
	/** Called on every state change, including the first. */
	onChange: (snapshot: AutosaveSnapshot) => void;
	debounceMs?: number;
	maxWaitMs?: number;
};

export type Autosave<T> = {
	/** The value has moved. Schedules a save unless one is already in flight. */
	change: (value: T) => void;
	/** Treat this value as already stored. Used to set the opening baseline. */
	reset: (value: T) => void;
	/** Save now, skipping the wait. Resolves once nothing is outstanding. */
	flush: () => Promise<void>;
	/** True while there is anything a save would still have to write. */
	outstanding: () => boolean;
	/**
	 * Nothing is sent until `resume`: the conflict modal is open. A save already
	 * on its way finishes; changes are still taken, and still outstanding.
	 */
	pause: () => void;
	resume: () => void;
	/** Saves the current value even if it is the stored one. Resolves once it has been tried. */
	force: () => Promise<void>;
	/** Resolves once no save is on its way. Sends nothing. */
	settle: () => Promise<void>;
	destroy: () => void;
};

export const DEBOUNCE_MS = 1000;
export const MAX_WAIT_MS = 5000;

export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
	const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	const maxWaitMs = options.maxWaitMs ?? MAX_WAIT_MS;

	let current: { value: T } | null = null;
	/** The serialised form of the last value known to be stored. */
	let stored: string | null = null;

	let state: SaveState = 'saved';
	let failure: FailureKind | null = null;
	let message: string | null = null;

	let timer: ReturnType<typeof setTimeout> | null = null;
	/** When the oldest still-unsaved change happened, for the ceiling. */
	let dirtySince: number | null = null;
	let inFlight: Promise<void> | null = null;
	let destroyed = false;
	let paused = false;

	function announce(next: SaveState, kind: FailureKind | null, text: string | null): void {
		state = next;
		failure = kind;
		message = text;
		options.onChange({ state, failure, message });
	}

	function clearTimer(): void {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	}

	function dirty(): boolean {
		return current !== null && JSON.stringify(current.value) !== stored;
	}

	function schedule(): void {
		if (destroyed || paused || inFlight !== null || !dirty()) {
			return;
		}

		clearTimer();
		dirtySince ??= Date.now();

		// Whichever comes first: a pause long enough to be a pause, or the ceiling
		// on how long a continuous stretch of typing may go unsaved.
		const untilCeiling = dirtySince + maxWaitMs - Date.now();
		timer = setTimeout(() => void run(), Math.max(0, Math.min(debounceMs, untilCeiling)));
	}

	async function run(): Promise<void> {
		clearTimer();

		if (destroyed || paused || inFlight !== null || current === null) {
			return;
		}

		const attempt = JSON.stringify(current.value);
		if (attempt === stored) {
			dirtySince = null;
			if (state !== 'saved') {
				announce('saved', null, null);
			}
			return;
		}

		const value = current.value;
		announce('saving', null, null);

		inFlight = (async () => {
			try {
				await options.save(value);
				// Recorded against the value that was *sent*, not the current one —
				// anything typed while the request was in flight is still unsaved and
				// the comparison below is what notices.
				stored = attempt;
				dirtySince = null;
				if (destroyed) {
					return;
				}
				if (dirty()) {
					announce('pending', null, null);
				} else {
					announce('saved', null, null);
				}
			} catch (thrown) {
				if (destroyed) {
					return;
				}
				const kind = thrown instanceof SaveFailed ? thrown.kind : 'server';
				const text = thrown instanceof SaveFailed ? thrown.message : 'Could not save. Try again.';
				announce('failed', kind, text);
			}
		})();

		try {
			await inFlight;
		} finally {
			inFlight = null;
		}

		// Only reschedule after a success. A failure waits for somebody to edit
		// again or press the button, rather than retrying into a wall.
		if (state === 'pending') {
			schedule();
		}
	}

	return {
		change(value: T) {
			if (destroyed) {
				return;
			}
			current = { value };

			if (!dirty()) {
				// Typed and then undone back to what is stored. Nothing to write, and
				// nothing to warn anybody about on the way out.
				clearTimer();
				dirtySince = null;
				if (state !== 'saving') {
					announce('saved', null, null);
				}
				return;
			}

			if (state !== 'saving') {
				announce('pending', null, null);
			}
			schedule();
		},

		reset(value: T) {
			current = { value };
			stored = JSON.stringify(value);
			dirtySince = null;
			clearTimer();
			announce('saved', null, null);
		},

		async flush() {
			clearTimer();
			// Awaited rather than raced: a flush that fired its own request while one
			// was already open would be the second concurrent writer this whole
			// design exists to prevent.
			if (inFlight !== null) {
				await inFlight;
			}
			await run();
		},

		outstanding() {
			return state !== 'saved';
		},

		pause() {
			paused = true;
			clearTimer();
		},

		resume() {
			paused = false;
			schedule();
		},

		async force() {
			if (inFlight !== null) {
				await inFlight;
			}
			// Forgotten, so the comparison in `run` finds something to write.
			stored = null;
			await run();
		},

		async settle() {
			if (inFlight !== null) {
				await inFlight;
			}
		},

		destroy() {
			destroyed = true;
			clearTimer();
		}
	};
}
