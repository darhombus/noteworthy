/**
 * Ctrl+K (Cmd+K on a Mac): what the shell does with it, decided without the
 * DOM so the rules can be tested one by one. `QuickSearch.svelte` listens for
 * it once, on the window, and does what this says.
 *
 * ---------------------------------------------------------------------------
 * THE EDITOR HAS IT FIRST
 * ---------------------------------------------------------------------------
 * The entry editor already binds Mod-K: it opens the link dialog
 * (`linkShortcut` in `$lib/entries/editor`). ProseMirror handles the key on its
 * own element and prevents the default when a binding took it, so by the time
 * the window hears it, `defaultPrevented` says it is spoken for. The title
 * field above the editor is marked `data-editor-shortcuts`: Ctrl+K there does
 * nothing the app knows of, and search does not take it either. Anything
 * already handled, by anyone, is left alone.
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER'S OWN CTRL+K
 * ---------------------------------------------------------------------------
 * Chrome and Edge focus the address bar's search on Ctrl+K, and Firefox its
 * web search. The caller prevents that only when this returns an action, so
 * every case above (the editor's fields, another dialog open, composing) is
 * still the browser's.
 *
 * ---------------------------------------------------------------------------
 * WHICH KEY
 * ---------------------------------------------------------------------------
 * The same test ProseMirror's keymap makes for "Mod-k", so the editor and the
 * shell never disagree about what was pressed: Cmd on a Mac (`navigator.platform`
 * matching Mac, iPhone, iPad or iPod), Ctrl elsewhere, with no Shift or Alt.
 * The key is `k` either case, or, on a layout whose key there is not Latin
 * (Cyrillic `л`), a non-ASCII key whose `keyCode` is K's.
 */

/** The parts of a `KeyboardEvent` read here. */
export type KeyFacts = Pick<
	KeyboardEvent,
	| 'key'
	| 'keyCode'
	| 'ctrlKey'
	| 'metaKey'
	| 'altKey'
	| 'shiftKey'
	| 'isComposing'
	| 'defaultPrevented'
>;

/** What the page around the key looks like when it is pressed. */
export type ShortcutContext = {
	/** Cmd rather than Ctrl: see `isMacPlatform`. */
	mac: boolean;
	/** The quick-search modal is open. */
	quickOpen: boolean;
	/** The page is `/search`, which has a field of its own. */
	onSearchPage: boolean;
	/** Another modal dialog is open (the link dialog, a delete confirmation). */
	otherModalOpen: boolean;
	/** Focus is in a field that leaves the key to the editor (`data-editor-shortcuts`). */
	inEditorField: boolean;
};

export type ShortcutAction =
	/** Open the modal. */
	| 'open'
	/** The modal is open: select its field's text. */
	| 'select'
	/** On `/search`: focus the page's own field. */
	| 'focus-page';

/** The attribute that leaves Ctrl/Cmd+K to the editor. */
export const EDITOR_SHORTCUTS = 'data-editor-shortcuts';

const K = 75;

/** ProseMirror's test for "Mod" meaning Cmd. */
export function isMacPlatform(platform: string): boolean {
	return /Mac|iP(hone|[oa]d)/.test(platform);
}

/** Whether this is Ctrl+K, or Cmd+K on a Mac, and nothing else held. */
export function isModK(event: KeyFacts, mac: boolean): boolean {
	const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!modifier || event.altKey || event.shiftKey) {
		return false;
	}
	if (event.key === 'k' || event.key === 'K') {
		return true;
	}
	return event.key.length === 1 && event.key.charCodeAt(0) > 127 && event.keyCode === K;
}

/** What to do with a key, or `null` to leave it alone (and to the browser). */
export function shortcutAction(event: KeyFacts, context: ShortcutContext): ShortcutAction | null {
	if (!isModK(event, context.mac) || event.defaultPrevented || event.isComposing) {
		return null;
	}
	if (context.quickOpen) {
		return 'select';
	}
	if (context.otherModalOpen || context.inEditorField) {
		return null;
	}
	return context.onSearchPage ? 'focus-page' : 'open';
}
