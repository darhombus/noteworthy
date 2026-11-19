/**
 * Autosave as an entry page uses it.
 *
 * `./autosave` is the controller, and knows nothing about pages: it is timing
 * and bookkeeping over a `save` function it is handed. The request, and the
 * revision it carries, are `./send-draft`. This is the rest — the
 * controller's lifetime, coming back online, and what
 * leaving the page does while something is unsaved. Both entry pages use it:
 * the edit page for every save, and the new-entry page, whose only difference
 * is that its first save creates the row. One copy, so the two pages cannot
 * drift into disagreeing about when it is safe to leave.
 *
 * ---------------------------------------------------------------------------
 * LEAVING
 * ---------------------------------------------------------------------------
 * Moved here from the edit page unchanged. The guards fire only when the
 * controller says something is outstanding — a save waiting on its debounce,
 * open on the network, or failed:
 *
 *   `beforeNavigate` covers links and the back button, and does not ask. A
 *   client-side navigation keeps the document alive, so a `fetch` started here
 *   survives it — the guard flushes and lets the navigation through, and the
 *   next page's data is asked for once the save has landed. Asking somebody to
 *   confirm something the app is about to do for them would be theatre. The
 *   exception is a *failed* save: flushing would fail again, so that one still
 *   asks.
 *
 *   `beforeunload` covers closing the tab and reloading, where the document does
 *   not survive and an open request dies with it. Nothing can be done about that
 *   from here, so this one warns whenever anything is outstanding.
 *
 * A page can also say it holds unsaved work autosave was never given, through
 * the `unsent` option; with nothing outstanding, that asks on a link and warns
 * on close. Only the new-entry page uses it, for a title typed before the body.
 *
 * `holding` is the stronger version of the same idea, for work nothing can
 * finish once the page is gone — a file on its way into the entry. It is asked
 * about first and whatever autosave's own state is, because flushing a save
 * does nothing for an upload that dies with the tab.
 *
 * The page landed on shows what has been saved, never a copy fetched before
 * the last save: while this page is open its data request waits for the save,
 * and a preload's answer is held until the navigation, then used or asked
 * again (`$lib/navigation/saved-first`). The guard tells it which navigation
 * went ahead.
 *
 * A `keepalive: true` fetch would let a save outlive the tab, and was
 * deliberately not used: it would be a second writer running outside the
 * controller's one-save-at-a-time rule, and overlapping writes of one row is the
 * single failure the controller is built to avoid. The warning is the honest
 * version.
 */
import { beforeNavigate } from '$app/navigation';
import type { BeforeNavigate } from '@sveltejs/kit';
import { onMount } from 'svelte';
import { finishBeforeRestoreReload, reloadingForSession, type Unfinished } from '$lib/auth/stale';
import { savedFirst } from '$lib/navigation/saved-first-app';
import { createAutosave, type Autosave, type AutosaveSnapshot } from './autosave';
import {
	INITIAL_SAVE_DISPLAY,
	nextSaveDisplay,
	type SaveDisplay,
	type SaveDisplayState
} from './save-display';

export type EntryAutosave<T> = {
	/**
	 * The controller's own state. Starts as `saved`, which is also what "nothing
	 * to do" is. What the page decides with — and what the leave guards below
	 * read — rather than what it shows.
	 */
	readonly status: AutosaveSnapshot;
	/**
	 * What `SaveStatus` shows: the same snapshots, except that a failure stays on
	 * screen until a save succeeds. See `./save-display`. Kept apart from
	 * `status` so that showing a failure through a retry changes nothing about
	 * how leaving behaves: a retry in flight is still a save in flight to the
	 * guards, which flush it rather than ask.
	 */
	readonly display: SaveDisplay;
	change: (value: T) => void;
	reset: (value: T) => void;
	flush: () => Promise<void>;
	/**
	 * Nothing is sent while the conflict modal is open (`./conflict.svelte`).
	 * Leaving then always asks, as for a failed save, typed or not, and closing
	 * or reloading the tab warns: the tab holds a version the other save
	 * replaced, which exists nowhere else.
	 */
	pause: () => void;
	resume: () => void;
	/** Saves what the page holds even if nothing changed: "Keep this tab's version". */
	force: () => Promise<void>;
	/** Resolves once no save is on its way. */
	settle: () => Promise<void>;
	/**
	 * Asks what leaving asks with the conflict modal showing, now, for a leave
	 * the page starts itself: the modal closed by Back (`./conflict.svelte`).
	 * That is always "could not be saved", typed or not (see `pause`), after the
	 * upload question if a file is on its way. On `true` the next navigation is
	 * let through without asking again.
	 */
	confirmLeave: () => boolean;
	/** Whether a confirmed leave is still waiting for its navigation. */
	leaveWaiting: () => boolean;
};

export type EntryAutosaveOptions = {
	/**
	 * Work in progress that leaving would lose outright, as the question to ask
	 * before leaving — or `null` when there is none.
	 *
	 * Unlike `unsent`, this is asked first and whatever autosave's own state is,
	 * because nothing can finish it in the background: an upload lives in the
	 * page, and a client-side navigation takes the editor and its placeholder
	 * with it. Flushing a save afterwards is still right, so a person who says
	 * "leave anyway" keeps the words they typed and loses only the file they can
	 * pick again.
	 *
	 * Only the editor pages use it, for a file on its way into the entry.
	 */
	holding?: () => string | null;
	/**
	 * Work the page is holding that autosave has deliberately not been given,
	 * as the question to ask before leaving it — or `null` when there is none.
	 *
	 * Autosave only knows about drafts it was handed, so on its own it treats a
	 * page as safe to leave whenever nothing is waiting, in flight or failed.
	 * That is right for the edit page, which hands it everything and does not
	 * pass this. The new-entry page withholds drafts on purpose until the body
	 * has text, so a title typed on its own is invisible to autosave and would
	 * be lost without a word; it passes this to say so. Consulted only when
	 * autosave itself has nothing outstanding, so once there is a draft the
	 * rules above apply unchanged.
	 */
	unsent?: () => string | null;
};

const WARNING = 'This entry could not be saved. Leave anyway?';

/**
 * Whether closing or reloading the page asks first: when there is work leaving
 * would lose, except while a page the back/forward cache gave back is being
 * reloaded (`$lib/auth/stale`). That page is hidden and its work has been
 * saved or cannot be; a "stay" answered then would leave it hidden for good.
 */
export function asksBeforeUnload(work: {
	outstanding: boolean;
	unsent: string | null;
	holding: string | null;
	/**
	 * The conflict modal is showing: the tab holds a version the other save
	 * replaced, which exists nowhere else, so closing or reloading warns
	 * whether or not anything was typed (`pause`).
	 */
	conflicted?: boolean;
}): boolean {
	if (reloadingForSession()) {
		return false;
	}
	return (
		work.outstanding || work.conflicted === true || work.unsent !== null || work.holding !== null
	);
}

/**
 * Creates the controller for this page. Call it while the component
 * initialises, as with any lifecycle function — it registers `onMount` and
 * `beforeNavigate` for the page that calls it.
 *
 * Until the page has mounted there is no controller and `change` and `reset`
 * do nothing. Neither page can call them earlier anyway: both wait for the
 * editor, which only exists after mount.
 */
export function entryAutosave<T>(
	save: (value: T) => Promise<void>,
	options: EntryAutosaveOptions = {}
): EntryAutosave<T> {
	/** The page's own unsaved work, when autosave has none. See `unsent`. */
	const unsent = (): string | null => options.unsent?.() ?? null;
	/** Work leaving would lose however autosave is doing. See `holding`. */
	const holding = (): string | null => options.holding?.() ?? null;

	let status = $state<AutosaveSnapshot>({ state: 'saved', failure: null, message: null });
	/**
	 * The display rule's memory, in a plain variable and not in `$state`.
	 *
	 * `onChange` runs inside `autosave.change()`, and both pages call `change()`
	 * from a `$effect`. Anything reactive read here is read by that effect, so a
	 * `$state` that `onChange` both reads and writes makes the page's effect depend
	 * on a value it then changes — an effect loop, which Svelte stops with
	 * `effect_update_depth_exceeded` after taking the page's reactivity down. This
	 * is only ever read here, and `display` below is only ever written here.
	 */
	let displayState: SaveDisplayState = INITIAL_SAVE_DISPLAY;
	// `raw`, because it is only ever replaced whole.
	let display = $state.raw<SaveDisplay>(INITIAL_SAVE_DISPLAY.display);
	let autosave: Autosave<T> | null = null;
	/** The conflict modal is open. See `pause`. */
	let paused = false;
	/** Leaving was asked about already. See `confirmLeave`. */
	let leaveConfirmed = false;
	/** Saves sent, and whether one is on its way: for `$lib/navigation/saved-first`. */
	let sends = 0;
	let saving = false;

	/**
	 * Sends what is waiting and waits for it, again if more was typed meanwhile,
	 * until nothing is outstanding. Not while the conflict modal is open, nor
	 * after a failure: leaving then was asked about, and a retry would be a
	 * save the person did not ask for.
	 */
	async function finish(): Promise<void> {
		for (let round = 0; round < 10; round += 1) {
			if (autosave === null || !autosave.outstanding() || paused || status.state === 'failed') {
				break;
			}
			await autosave.flush();
		}
		await autosave?.settle();
	}

	onMount(() => {
		autosave = createAutosave<T>({
			save: async (value) => {
				sends += 1;
				saving = true;
				try {
					await save(value);
				} finally {
					saving = false;
				}
			},
			onChange: (snapshot) => {
				status = snapshot;
				// Folded here, on every snapshot as the controller reports it, and not
				// derived from `status` in a component: the rule reads meaning off the
				// order snapshots arrive in, and reactivity would coalesce two that
				// land in the same tick — a save coming back and the next one going
				// out — into the second alone.
				displayState = nextSaveDisplay(displayState, snapshot);
				display = displayState.display;
			}
		});

		// Coming back online is the one moment a failed save is worth retrying
		// without being asked: the person did nothing, but the reason it failed
		// has just stopped being true.
		const retryWhenOnline = (): void => {
			if (autosave?.outstanding() === true) {
				void autosave.flush();
			}
		};

		const guardUnload = (event: BeforeUnloadEvent): void => {
			if (
				autosave === null ||
				// Asked already (`confirmLeave`), and the step back left the document.
				leaveConfirmed ||
				!asksBeforeUnload({
					outstanding: autosave.outstanding(),
					conflicted: paused,
					unsent: unsent(),
					holding: holding()
				})
			) {
				return;
			}
			// `preventDefault()` is the current way to ask for the browser's dialog;
			// `returnValue` is the older one and is still what some browsers read.
			// Setting both costs nothing and neither wording is ours to choose.
			event.preventDefault();
			event.returnValue = '';
		};

		/**
		 * A page the back/forward cache gives back is reloaded once the person may
		 * have signed out (`$lib/auth/stale`), and a reload loses whatever was
		 * typed and not saved: measured, typing whose save had failed came back
		 * with the page and was gone after the reload. So the save is finished
		 * first, while the page is still hidden; what could not be saved is
		 * reported, and the page is then shown again rather than reloaded.
		 */
		const finishOnRestore = async (): Promise<Unfinished> => {
			if (autosave === null) {
				return 'none';
			}
			if (autosave.outstanding()) {
				await autosave.flush();
			}
			if (status.failure === 'signed-out') {
				return 'signed-out';
			}
			return autosave.outstanding() || unsent() !== null || holding() !== null ? 'unsaved' : 'none';
		};
		const stopFinishing = finishBeforeRestoreReload(finishOnRestore);
		const stopWatching = savedFirst().watch({
			sent: () => sends,
			saving: () => saving,
			outstanding: () => autosave?.outstanding() ?? false,
			finish
		});

		addEventListener('online', retryWhenOnline);
		addEventListener('beforeunload', guardUnload);

		return () => {
			stopWatching();
			stopFinishing();
			removeEventListener('online', retryWhenOnline);
			removeEventListener('beforeunload', guardUnload);
			autosave?.destroy();
			autosave = null;
		};
	});

	beforeNavigate((navigation) => {
		let cancelled = false;
		guardLeaving({
			...navigation,
			cancel: () => {
				cancelled = true;
				navigation.cancel();
			}
		});
		// After the guard, which flushes what is waiting: the page's preloaded
		// answer is then handed over or asked again (`$lib/navigation/saved-first`).
		if (!cancelled && autosave !== null && navigation.to !== null && navigation.type !== 'leave') {
			savedFirst().leaving(navigation.to.url);
		}
	});

	function guardLeaving(navigation: BeforeNavigate): void {
		if (autosave === null) {
			return;
		}

		// Asked already, by `confirmLeave`, for the navigation this is. Kept for a
		// step that leaves the document, so `guardUnload` does not ask again.
		if (leaveConfirmed) {
			if (navigation.type !== 'leave') {
				leaveConfirmed = false;
			}
			if (autosave.outstanding() && !paused) {
				void autosave.flush();
			}
			return;
		}

		// Asked first, and separately: an upload cannot be flushed, finished in the
		// background or picked up by the next page, so this is a real question
		// whatever autosave is doing. Closing the tab is `guardUnload`'s, above.
		const held = holding();
		if (held !== null && navigation.type !== 'leave' && !confirm(held)) {
			navigation.cancel();
			return;
		}

		// The conflict modal is showing: this tab holds a version the other save
		// replaced, which exists nowhere else, and leaving gives it up. So leaving
		// asks whether or not anything was typed here. Closing the tab is
		// `guardUnload`'s, and unchanged.
		if (paused) {
			if (navigation.type !== 'leave' && !confirm(WARNING)) {
				navigation.cancel();
			}
			return;
		}

		if (!autosave.outstanding()) {
			// Nothing of autosave's to lose — but the page may be holding something
			// it never gave autosave. Nothing can finish that in the background, so
			// this asks. Closing the tab is left to `guardUnload`: browsers refuse a
			// `confirm()` during unload, and the native dialog is the only one there.
			const question = unsent();
			if (question !== null && navigation.type !== 'leave' && !confirm(question)) {
				navigation.cancel();
			}
			return;
		}

		if (status.state === 'failed') {
			if (!confirm(WARNING)) {
				navigation.cancel();
			}
			return;
		}

		// Not cancelled and not awaited here. The request outlives a client-side
		// navigation because the document does; the next page's data waits for it
		// (`$lib/navigation/saved-first`), so it shows what this save stored.
		void autosave.flush();
	}

	return {
		get status() {
			return status;
		},
		get display() {
			return display;
		},
		change: (value) => autosave?.change(value),
		reset: (value) => autosave?.reset(value),
		flush: async () => {
			await autosave?.flush();
		},
		pause: () => {
			paused = true;
			autosave?.pause();
		},
		resume: () => {
			paused = false;
			autosave?.resume();
		},
		force: async () => {
			await autosave?.force();
		},
		settle: async () => {
			await autosave?.settle();
		},
		confirmLeave: () => {
			if (autosave === null) {
				return true;
			}
			// The same questions, in the same order, as `beforeNavigate` above with
			// the modal showing: the upload first, then always the warning.
			const held = holding();
			if (held !== null && !confirm(held)) {
				return false;
			}
			if (!confirm(WARNING)) {
				return false;
			}
			leaveConfirmed = true;
			return true;
		},
		leaveWaiting: () => leaveConfirmed
	};
}
