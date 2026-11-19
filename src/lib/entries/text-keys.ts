/**
 * The keys the entry editor handles differently from ProseMirror's defaults.
 * See docs/constraints.md, "Text-editing keys", for each engine's native
 * behaviour and the measurements behind them.
 *
 * ---------------------------------------------------------------------------
 * THE WORD KEYS BESIDE A MEDIA BLOCK
 * ---------------------------------------------------------------------------
 * Ctrl+Right at the end of a paragraph just before a photo, video or audio
 * item (and Ctrl+Left at the start of one just after) selected the whole item.
 * ProseMirror's `captureKeyDown` sends Left and Right to `selectHorizontally`
 * whatever modifier is held, and at a textblock's edge that selects the block
 * beyond it (prosemirror-view `selectHorizontally`, the `endOfTextblock`
 * branch). A plain contenteditable moves the caret instead, each engine its
 * own way. So in exactly that case the key is taken away from ProseMirror
 * before `captureKeyDown` runs — `handleDOMEvents.keydown` returning `true`
 * without `preventDefault` — and the browser moves the caret as it would
 * anywhere else; ProseMirror reads the result back as a text selection.
 * Plain Left and Right are left alone: selecting the block is how somebody
 * reaches it from the keyboard. Ctrl+Shift+Left/Right already behave natively.
 *
 * On a Mac the word key is Alt (Option), and that is the one handled there.
 *
 * ---------------------------------------------------------------------------
 * CTRL+UP AND CTRL+DOWN: BY PARAGRAPH, AS IN WORD
 * ---------------------------------------------------------------------------
 * Natively the three engines disagree (Chromium keeps the column and changes
 * paragraph, Firefox extends to the line's edge, WebKit does nothing). Here,
 * off a Mac, Ctrl+Up goes to the start of the paragraph, or of the previous
 * one when already at a start; Ctrl+Down to the end, or the next one's end.
 * Any textblock counts as a paragraph (headings, the paragraphs in list items);
 * media is stepped over. Selection only, so nothing enters the undo history. On
 * a Mac nothing changes: Cmd+Up is the start of the document there, and Ctrl+Up
 * is the system's.
 *
 * ---------------------------------------------------------------------------
 * WITH SHIFT: ONE MEDIA ITEM AT A TIME, AS IN WORD
 * ---------------------------------------------------------------------------
 * The head moves and the anchor stays, and a media item counts as a paragraph of
 * its own: one press takes the item and nothing past it. The selection always
 * ends right after the item (right before it, going up), between the blocks, even
 * with a paragraph next: so Delete takes the item and leaves the paragraphs either
 * side as two, where an end inside the next paragraph would join them. The next
 * press reaches that paragraph's far edge. `TextSelection.between` would pull a
 * between-blocks end back, so the selection is constructed directly, by the class
 * in `./between-blocks` that keeps it through undo and document changes. ProseMirror
 * warns about it once per page load.
 *
 * ---------------------------------------------------------------------------
 * CTRL+HOME IN AN ENTRY THAT STARTS WITH MEDIA
 * ---------------------------------------------------------------------------
 * The browsers disagree and none reaches the top: the gap cursor before the item
 * is the only place there, so Ctrl+Home goes to it and Ctrl+Shift+Home extends
 * to it. On a Mac, Cmd+Up and Cmd+Shift+Up. In an entry that starts with text
 * these keys are the browser's.
 *
 * ---------------------------------------------------------------------------
 * MOVING BLOCKS: ALT+SHIFT+UP/DOWN, AND CONTROL+SHIFT+UP/DOWN ON A MAC
 * ---------------------------------------------------------------------------
 * As in Word: the block the selection is in moves one place up or down
 * (`./move-blocks`). Off a Mac Ctrl+Shift+Up/Down keep extending by paragraph, so on
 * a Mac the same binding moves instead, where Option+Shift and Cmd+Shift are the
 * system's selection keys and are left alone. Here, beside the keys they share a
 * binding with, so one place says what each platform gets.
 *
 * Alt+Shift+Left/Right, off a Mac, are taken and do nothing. Measured: no engine's
 * page does anything with them (no change to the text or the selection), but whether
 * a browser goes Back or Forward on them could not be: Playwright's keys never reach
 * the browser's own shortcuts (Alt+Left did not go Back either). Taking them is the
 * safer rule, and loses nothing a page could see. On a Mac, Option+Shift+Left/Right
 * select by word and are never touched.
 *
 * "Mac" is `isMacPlatform(navigator.platform)`: the test ProseMirror's keymap
 * makes for Mod, so these keys and every Mod binding agree about the machine.
 *
 * A selected video or audio item whose player has focus (after a click on its
 * controls) never brings its keys here: its node view claims them. `editorKeyFromPlayer`
 * says which keys the player hands on: the move keys, Delete and Backspace, and off a Mac
 * Ctrl+Shift+Up/Down.
 */
import { Extension } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
	AllSelection,
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	TextSelection
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { isMacPlatform } from '$lib/search/shortcut';
import { selectionBetween } from './between-blocks';
import { mediaAfter } from './gap-cursor';
import { isMediaNode } from './media';
import { keepSelectedItem, moveBlocks } from './move-blocks';

function onMac(): boolean {
	return typeof navigator !== 'undefined' && isMacPlatform(navigator.platform);
}

type MoveKeyFacts = Pick<
	KeyboardEvent,
	'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'isComposing'
>;

/**
 * Which way `event` moves blocks on this machine (MOVING BLOCKS above), or `null` for
 * any other key: exactly the modifiers the bindings below name, Alt+Shift off a Mac,
 * Control+Shift on one. For the players, whose keys ProseMirror never sees
 * (`./player-node`, EDITOR KEYS FROM INSIDE A PLAYER).
 */
export function moveKeyDirection(event: MoveKeyFacts, mac: boolean): -1 | 1 | null {
	if (event.isComposing || !event.shiftKey || event.metaKey) {
		return null;
	}
	if (mac ? !event.ctrlKey || event.altKey : !event.altKey || event.ctrlKey) {
		return null;
	}
	return event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : null;
}

/** What an editor key pressed inside a player is (`./player-node`, EDITOR KEYS FROM INSIDE A PLAYER). */
export type KeyFromPlayer = { take: 'move'; dir: -1 | 1 } | { take: 'delete' } | { take: 'extend' };

/**
 * Which of the editor's keys `event` is, of those a player hands on to the editor, or
 * `null` for a key the player keeps: the move keys (`moveKeyDirection`); Delete and
 * Backspace with no modifier; and, off a Mac, Ctrl+Shift+Up/Down (extend by paragraph).
 * On a Mac the extend keys are the system's (Option+Shift, Cmd+Shift) and stay as they are.
 */
export function editorKeyFromPlayer(event: MoveKeyFacts, mac = onMac()): KeyFromPlayer | null {
	const dir = moveKeyDirection(event, mac);
	if (dir !== null) {
		return { take: 'move', dir };
	}
	if (event.isComposing || event.metaKey || event.altKey) {
		return null;
	}
	if ((event.key === 'Delete' || event.key === 'Backspace') && !event.ctrlKey && !event.shiftKey) {
		return { take: 'delete' };
	}
	if (
		!mac &&
		event.ctrlKey &&
		event.shiftKey &&
		(event.key === 'ArrowUp' || event.key === 'ArrowDown')
	) {
		return { take: 'extend' };
	}
	return null;
}

/** Whether the selection is a caret in right-to-left text. */
function rightToLeft(view: EditorView): boolean {
	const { node } = view.domAtPos(view.state.selection.head);
	const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
	return element !== null && getComputedStyle(element).direction === 'rtl';
}

/**
 * Whether this key, here, is one ProseMirror would answer by selecting a
 * media block where a plain contenteditable moves the caret. Mirrors the
 * branch of `selectHorizontally` it replaces, so nothing else changes.
 */
export function wordKeyIntoBlock(view: EditorView, event: KeyboardEvent, mac: boolean): boolean {
	if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
		return false;
	}
	const word = mac
		? event.altKey && !event.ctrlKey && !event.metaKey
		: event.ctrlKey && !event.altKey && !event.metaKey;
	if (!word || event.shiftKey || event.isComposing || view.composing) {
		return false;
	}
	const { selection } = view.state;
	if (!(selection instanceof TextSelection) || !selection.empty) {
		return false;
	}
	const forward = (event.key === 'ArrowRight') !== rightToLeft(view);
	if (!view.endOfTextblock(forward ? 'forward' : 'backward')) {
		return false;
	}
	const { $head } = selection;
	if ($head.depth === 0) {
		return false;
	}
	const $beyond = view.state.doc.resolve(forward ? $head.after() : $head.before());
	return Selection.findFrom($beyond, forward ? 1 : -1) instanceof NodeSelection;
}

/**
 * Where Ctrl+Up (`dir` -1) or Ctrl+Down (1) puts the head: the nearest
 * textblock start before `head`, or end after it. `null` at the entry's edge.
 */
export function paragraphEdge(doc: ProseMirrorNode, head: number, dir: -1 | 1): number | null {
	let target: number | null = null;
	doc.descendants((node, pos) => {
		if (!node.isTextblock) {
			return true;
		}
		const start = pos + 1;
		const end = start + node.content.size;
		if (dir < 0 && start < head) {
			target = start;
		} else if (dir > 0 && end > head && target === null) {
			target = end;
		}
		return false;
	});
	return target;
}

function byParagraph(view: EditorView, dir: -1 | 1): boolean {
	if (onMac()) {
		return false;
	}
	const { state } = view;
	const target = paragraphEdge(state.doc, state.selection.head, dir);
	if (target === null) {
		// At the entry's first start or last end: nothing further, and nothing
		// of the browser's either.
		return true;
	}
	view.dispatch(
		state.tr.setSelection(TextSelection.near(state.doc.resolve(target))).scrollIntoView()
	);
	return true;
}

type Stop = { media: boolean; start: number; end: number };

/** Textblocks by their content, media by the whole node, in document order. */
function stops(doc: ProseMirrorNode): Stop[] {
	const found: Stop[] = [];
	doc.descendants((node, pos) => {
		if (isMediaNode(node)) {
			found.push({ media: true, start: pos, end: pos + node.nodeSize });
			return false;
		}
		if (node.isTextblock) {
			found.push({ media: false, start: pos + 1, end: pos + 1 + node.content.size });
			return false;
		}
		return true;
	});
	return found;
}

/**
 * Where Ctrl+Shift+Up (`dir` -1) or Ctrl+Shift+Down (1) puts the head: the
 * paragraph's edge as without Shift, or, with a media item next, just past that
 * item, between the blocks. `null` at the entry's edge.
 */
export function extendedEdge(doc: ProseMirrorNode, head: number, dir: -1 | 1): number | null {
	const all = stops(doc);
	for (const stop of dir > 0 ? all : [...all].reverse()) {
		const media = dir > 0 ? stop.start >= head : stop.end <= head;
		const text = dir > 0 ? stop.end > head : stop.start < head;
		if (stop.media ? media : text) {
			return dir > 0 ? stop.end : stop.start;
		}
	}
	return null;
}

/** Which end of the selection stays and which moves, going `dir`. */
function ends(selection: Selection, dir: -1 | 1): { anchor: number; head: number } {
	if (selection instanceof NodeSelection) {
		return dir > 0
			? { anchor: selection.from, head: selection.to }
			: { anchor: selection.to, head: selection.from };
	}
	if (selection instanceof AllSelection) {
		return { anchor: Selection.atStart(selection.$from.doc).from, head: selection.to };
	}
	return { anchor: selection.anchor, head: selection.head };
}

function extendByParagraph(view: EditorView, dir: -1 | 1): boolean {
	if (onMac()) {
		return false;
	}
	const { doc, selection, tr } = view.state;
	const { anchor, head } = ends(selection, dir);
	const target = extendedEdge(doc, head, dir);
	if (target !== null) {
		view.dispatch(tr.setSelection(selectionBetween(doc, anchor, target)).scrollIntoView());
	}
	// At the entry's edge the key is still taken, as without Shift.
	return true;
}

/** Where the entry's first item is, if the entry starts with one. */
export function leadingMedia(doc: ProseMirrorNode): number | null {
	return mediaAfter(doc.resolve(0))?.pos ?? null;
}

/** The go-to-start keys, on the platform (`forMac`) they are its own on. */
function toEntryStart(view: EditorView, forMac: boolean, extend: boolean): boolean {
	const { doc, selection, tr } = view.state;
	const item = onMac() === forMac ? leadingMedia(doc) : null;
	if (item === null) {
		return false;
	}
	const target = extend
		? selectionBetween(doc, ends(selection, -1).anchor, item)
		: new GapCursor(doc.resolve(item));
	view.dispatch(tr.setSelection(target).scrollIntoView());
	return true;
}

export function textEditingKeys(): Extension {
	return Extension.create({
		name: 'noteworthyTextEditingKeys',
		addKeyboardShortcuts() {
			return {
				'Ctrl-ArrowUp': () => byParagraph(this.editor.view, -1),
				'Ctrl-ArrowDown': () => byParagraph(this.editor.view, 1),
				'Ctrl-Shift-ArrowUp': () =>
					onMac() ? moveBlocks(this.editor.view, -1) : extendByParagraph(this.editor.view, -1),
				'Ctrl-Shift-ArrowDown': () =>
					onMac() ? moveBlocks(this.editor.view, 1) : extendByParagraph(this.editor.view, 1),
				'Alt-Shift-ArrowUp': () => !onMac() && moveBlocks(this.editor.view, -1),
				'Alt-Shift-ArrowDown': () => !onMac() && moveBlocks(this.editor.view, 1),
				// Taken, and nothing done: MOVING BLOCKS above.
				'Alt-Shift-ArrowLeft': () => !onMac(),
				'Alt-Shift-ArrowRight': () => !onMac(),
				'Ctrl-Home': () => toEntryStart(this.editor.view, false, false),
				'Ctrl-Shift-Home': () => toEntryStart(this.editor.view, false, true),
				'Meta-ArrowUp': () => toEntryStart(this.editor.view, true, false),
				'Meta-Shift-ArrowUp': () => toEntryStart(this.editor.view, true, true)
			};
		},
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('noteworthyWordKeys'),
					props: {
						handleDOMEvents: {
							// `true` keeps the key from ProseMirror's own handler (and so
							// from `captureKeyDown`); the default is not prevented, so the
							// browser moves the caret.
							keydown: (view, event) => wordKeyIntoBlock(view, event, onMac())
						}
					}
				}),
				// A selected item kept from the browser's own moves of the page's selection.
				keepSelectedItem()
			];
		}
	});
}
