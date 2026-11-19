/**
 * An entry page learning that its entry changed somewhere else, and the two
 * choices it then offers (`ConflictDialog`). docs/constraints.md, "One entry in
 * two places", has the rules; this is how a page keeps them.
 *
 * ---------------------------------------------------------------------------
 * HOW A PAGE LEARNS, WITHOUT ASKING ON A TIMER
 * ---------------------------------------------------------------------------
 * - Another tab of this browser saves: it posts the new revision
 *   (`./broadcast`), and this page hears it at once.
 * - Anything else (another device, a direct write): when the page becomes
 *   visible again, or the window gains focus. A PC with two windows side by
 *   side never hides either, so focus is asked about as well as visibility.
 *   One GET of the autosave route, two small columns, one at a time. Offline,
 *   timed out, refused, signed out or deleted: nothing is shown and nothing
 *   changes; the next save says what a save says.
 * - A save refused as stale, while typing: the same modal.
 *
 * A revision past the page's is no conflict when the row's last save is one of
 * this page's own: on its way now, or never answered (`SaveTracker.isOwn`).
 *
 * ---------------------------------------------------------------------------
 * WHILE THE MODAL IS OPEN
 * ---------------------------------------------------------------------------
 * Autosave is paused, so nothing in this tab is sent, and nothing in it
 * changes: the page does not update itself, because an open old tab can be
 * the one good copy left. For the same reason leaving always asks, typed or
 * not (`entryAutosave`'s `pause`).
 *
 * ---------------------------------------------------------------------------
 * THE CHOICES
 * ---------------------------------------------------------------------------
 * Both first wait for a save already on its way, so its answer cannot land
 * after the choice.
 *
 * "Use the saved version" reads the title, date and body with a plain fetch
 * (an `invalidate` that fails offline loads the whole page as a document: the
 * browser's error page), and the page puts them on screen (`apply`): fields
 * set, the editor's document replaced, its undo history cleared, every upload
 * waiting or under way in this tab cancelled. Autosave's baseline becomes what
 * the editor then holds, so nothing is saved back. A read that fails leaves
 * the modal open and says why.
 *
 * "Keep this tab's version" saves this tab's title, date and body, as they
 * are, made from the newest revision the page has heard of, even when nothing
 * was typed here. Refused again (a save landed in between), the modal opens
 * again with the newer revision.
 *
 * ---------------------------------------------------------------------------
 * ANY OTHER CLOSE IS BACK
 * ---------------------------------------------------------------------------
 * With the modal showing, Back means leaving the page. A modal `<dialog>` is a
 * close watcher (HTML, "Close requests and close watchers"), so Android's Back
 * closes it and does not traverse history: the step is still there to take.
 * `ConflictDialog` hands any close that is not a choice to `leave`, which asks
 * what leaving asks (`confirmLeave`) and then takes that one step itself.
 *
 * Reopening the dialog instead, as this did at first, kept Back from ever
 * leaving: the reopened dialog, shown with no user activation since, got a
 * close-watcher group of its own (the list was empty after the close), and so
 * caught the next Back too, every time. `cancel` could not help: a close
 * request may be refused only with history-action activation, and each close
 * request uses it up.
 *
 * One step, once. While leaving, a second close (another swipe while the
 * navigation runs) only shows the modal again. With nothing behind the page in
 * the tab (opened on its own), Back would close the tab, which a page cannot
 * do, and `history.back()` does nothing: if no navigation has started after
 * `LEAVE_WAIT_MS`, the entry's journal is shown in its place. Not
 * `navigation.canGoBack`: it counts only this origin's entries, and is false
 * with a search page or the new-tab page behind, where Back does go (measured:
 * Playwright's first `about:blank`).
 */
import { goto } from '$app/navigation';
import type { ResolvedPathname } from '$app/types';
import { onMount } from 'svelte';
import { success } from '$lib/toast/toasts.svelte';
import type { Json } from '$lib/types/database';
import { onSaved, postSaved } from './broadcast';
import type { EntryAutosave } from './entry-autosave.svelte';
import { changedElsewhere, type SaveTracker } from './revision';
import type { DraftSender, DraftSenderHooks } from './send-draft';

/** What both entry pages autosave. */
export type EntryDraft = { title: string; entryDate: string; doc: string };

/** The saved version, as the page puts it on screen. */
export type SavedText = { title: string; entryDate: string; content: Json };

/** How long a read may take before it counts as failed. */
export const READ_LIMIT_MS = 10_000;

/** How long a leave waits for its step back to start before going to the journal. */
export const LEAVE_WAIT_MS = 2000;

export const SHOWING_SAVED = 'Showing the saved version.';
export const KEPT = "Kept this tab's version.";

export type EntryConflictOptions = {
	entryId: string;
	/** The autosave route: its GET is the read. */
	url: () => string;
	tracker: SaveTracker;
	/** Whether the entry exists yet. Until then nothing is read. */
	live?: () => boolean;
	/** Read lazily: the page makes both after this. */
	autosave: () => EntryAutosave<EntryDraft>;
	sender: () => DraftSender;
	/** Puts the saved version on screen and returns the draft it now holds, or `null` if it cannot yet. */
	apply: (text: SavedText) => EntryDraft | null;
	/** Where leaving goes when there is no step back to take: the entry's journal. */
	away: () => ResolvedPathname;
};

export type EntryConflict = {
	/** The modal is open. */
	readonly open: boolean;
	/** A choice is being carried out. */
	readonly busy: boolean;
	/** Why the last choice could not be carried out, or `null`. */
	readonly problem: string | null;
	/** For `draftSender`: tell the other tabs, and open on a stale refusal. */
	readonly hooks: DraftSenderHooks;
	useSaved: () => Promise<void>;
	keep: () => Promise<void>;
	/**
	 * The modal was closed, and not by a choice: Back. Asks, then leaves one
	 * step back. `false` when the person chose to stay.
	 */
	leave: () => boolean;
};

type Answer = {
	revision?: unknown;
	lastSaveId?: unknown;
	title?: unknown;
	entryDate?: unknown;
	content?: unknown;
};

/** Call while the component initialises: it registers `onMount`. */
export function entryConflict(options: EntryConflictOptions): EntryConflict {
	const { entryId, tracker } = options;
	const live = options.live ?? (() => true);

	let open = $state(false);
	let busy = $state(false);
	let problem = $state<string | null>(null);
	/** The newest revision heard of from anywhere else. */
	let newest = 0;
	let reading = false;
	/** A leave is under way. See ANY OTHER CLOSE IS BACK. */
	let leaving = $state(false);

	function show(revision: number): void {
		newest = Math.max(newest, revision);
		if (!open) {
			open = true;
			problem = null;
			options.autosave().pause();
		}
	}

	/** Another place's write at `revision`, by `saveId`: a conflict unless this page has it, or made it. */
	function notice(revision: number, saveId: string | null): void {
		if (changedElsewhere(tracker, revision, saveId)) {
			show(revision);
		}
	}

	function close(): void {
		open = false;
		options.autosave().resume();
	}

	function read(withText: boolean): Promise<Response> {
		return fetch(withText ? `${options.url()}?text` : options.url(), {
			cache: 'no-store',
			signal: AbortSignal.timeout(READ_LIMIT_MS)
		});
	}

	async function check(): Promise<void> {
		if (open || reading || !live() || tracker.revision === null) {
			return;
		}
		reading = true;
		try {
			const response = await read(false);
			if (!response.ok || response.redirected) {
				return;
			}
			const answer = (await response.json()) as Answer;
			if (typeof answer.revision === 'number') {
				notice(answer.revision, typeof answer.lastSaveId === 'string' ? answer.lastSaveId : null);
			}
		} catch {
			// Offline or timed out: nothing to say, and nothing changes.
		} finally {
			reading = false;
		}
	}

	onMount(() => {
		const stopHearing = onSaved(entryId, (saved) => notice(saved.revision, saved.saveId));
		const onFocus = (): void => void check();
		const onVisible = (): void => {
			if (document.visibilityState === 'visible') {
				void check();
			}
		};
		addEventListener('focus', onFocus);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stopHearing();
			removeEventListener('focus', onFocus);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	/** The saved version, or why it could not be had. */
	async function fetchSaved(): Promise<{ revision: number; text: SavedText } | string> {
		let response: Response;
		try {
			response = await read(true);
		} catch {
			return 'Could not load the saved version. Check your connection and try again.';
		}
		if (response.status === 401 || response.redirected) {
			return 'Could not load the saved version: you have been signed out.';
		}
		if (response.status === 410) {
			return 'Could not load the saved version: this entry is in the Recycle Bin.';
		}
		let answer: Answer | null = null;
		try {
			answer = (await response.json()) as Answer;
		} catch {
			// Read as any other failure, below.
		}
		if (
			!response.ok ||
			typeof answer?.revision !== 'number' ||
			typeof answer.title !== 'string' ||
			typeof answer.entryDate !== 'string' ||
			typeof answer.content !== 'object' ||
			answer.content === null
		) {
			return 'Could not load the saved version. Try again.';
		}
		return {
			revision: answer.revision,
			text: { title: answer.title, entryDate: answer.entryDate, content: answer.content as Json }
		};
	}

	return {
		get open() {
			return open;
		},
		get busy() {
			return busy || leaving;
		},
		get problem() {
			return problem;
		},
		hooks: {
			saved: (revision, saveId) => postSaved({ entryId, revision, saveId }),
			stale: (revision) => show(revision)
		},

		async useSaved() {
			if (busy) {
				return;
			}
			busy = true;
			problem = null;
			try {
				await options.autosave().settle();
				const saved = await fetchSaved();
				if (typeof saved === 'string') {
					problem = saved;
					return;
				}
				const draft = options.apply(saved.text);
				if (draft === null) {
					problem = 'Could not show the saved version. Try again.';
					return;
				}
				tracker.adopt(saved.revision);
				options.sender().resume();
				// Before resuming, so the saved version is the baseline and nothing
				// is sent back.
				options.autosave().reset(draft);
				close();
				success(SHOWING_SAVED);
			} finally {
				busy = false;
			}
		},

		leave() {
			if (leaving) {
				return true;
			}
			if (!options.autosave().confirmLeave()) {
				return false;
			}
			leaving = true;
			history.back();
			setTimeout(() => {
				// A navigation inside the app has used the confirmation by now, and
				// a step to another document has unloaded this one. Still waiting,
				// there was no step to take: leave to the journal, already asked.
				if (options.autosave().leaveWaiting()) {
					void goto(options.away(), { replaceState: true });
				}
			}, LEAVE_WAIT_MS);
			return true;
		},

		async keep() {
			if (busy) {
				return;
			}
			busy = true;
			problem = null;
			try {
				await options.autosave().settle();
				tracker.adopt(Math.max(newest, tracker.revision ?? 0));
				options.sender().resume();
				close();
				await options.autosave().force();
				// Refused again, the modal is open once more; failed any other way,
				// the toolbar says so, with Try again.
				if (!open && options.autosave().status.failure === null) {
					success(KEPT);
				}
			} finally {
				busy = false;
			}
		}
	};
}
