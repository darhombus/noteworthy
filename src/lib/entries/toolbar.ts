/**
 * What the toolbar needs to draw itself — and nothing that knows how to compute
 * it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN FILE
 * ---------------------------------------------------------------------------
 * `EntryToolbar.svelte` is imported the ordinary way, so it and everything it
 * imports are in the server's module graph. `editor.ts` must not be: it pulls in
 * TipTap and ProseMirror, and `new Editor()` reads `document`, which is the
 * whole reason `EntryEditor.svelte` reaches that module through a dynamic
 * `import()` inside `onMount`.
 *
 * A shared *type* would have been safe — `import type` is erased — but the
 * toolbar also needs a starting value, and one `import { EMPTY_TOOLBAR_STATE }`
 * from `editor.ts` would have quietly undone the arrangement. Nothing would have
 * failed: the build succeeds, the server just evaluates TipTap on every render
 * of every page and the edit route stops being code-split. The kind of
 * regression that is invisible until somebody profiles a bundle.
 *
 * So the data shape lives here, where there is nothing to import, and
 * `readToolbarState()` — which needs a real editor — stays over in `editor.ts`.
 * This file has no imports on purpose. Keep it that way.
 */

export type ToolbarState = {
	canUndo: boolean;
	canRedo: boolean;
	heading1: boolean;
	heading2: boolean;
	bold: boolean;
	italic: boolean;
	strike: boolean;
	highlight: boolean;
	bulletList: boolean;
	orderedList: boolean;
	blockquote: boolean;
	link: boolean;
	/** Whether the entry holds any media, which is when Collapse all is shown. */
	media: boolean;
	/** Whether every media item is collapsed, which turns Collapse all into Expand all. */
	allCollapsed: boolean;
};

/** What the toolbar shows before the editor exists. Nothing on, nothing to undo. */
export const EMPTY_TOOLBAR_STATE: ToolbarState = {
	canUndo: false,
	canRedo: false,
	heading1: false,
	heading2: false,
	bold: false,
	italic: false,
	strike: false,
	highlight: false,
	bulletList: false,
	orderedList: false,
	blockquote: false,
	link: false,
	media: false,
	allCollapsed: false
};

/** The keys, for walking the state without listing them a third time. */
export const TOOLBAR_KEYS = Object.keys(EMPTY_TOOLBAR_STATE) as (keyof ToolbarState)[];

/**
 * The four marks a toolbar press or a keyboard shortcut toggles over a word.
 *
 * Named here rather than in `editor.ts` for the same reason `ToolbarState` is:
 * `EntryToolbar.svelte` needs it, and that component must not import anything
 * that pulls TipTap into the server bundle.
 */
export type WordMark = 'bold' | 'italic' | 'strike' | 'highlight';
