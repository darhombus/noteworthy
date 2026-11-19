/**
 * The gap cursor: where the caret goes when there is no text to put it in,
 * before a media item at the top of an entry or between two stacked items.
 * prosemirror-gapcursor keeps the selection and answers the arrows; this draws
 * it, and answers Enter and Backspace. See docs/constraints.md, "Text-editing
 * keys", "The gap cursor".
 *
 * ---------------------------------------------------------------------------
 * WHY A CLASS ON THE FIGURE, AND NOT THE PLUGIN'S OWN WIDGET
 * ---------------------------------------------------------------------------
 * The caret marks the item's corner, and a photo or video under the height cap
 * is centred in the column, narrower than it. Its width sum needs the item's
 * `--media-ratio`, which is on the figure and cannot reach a sibling before it.
 * So a node decoration marks the figure and a `::before` on it draws the caret
 * (`layout.css`, "THE GAP CURSOR"). As with the tint, the node view keeps its
 * elements. The plugin's widget stays in the document with nothing drawn: it
 * has to, because `coordsAtPos` measures it when the caret is scrolled to.
 *
 * ---------------------------------------------------------------------------
 * ENTER LEAVES A GAP CURSOR THE PLUGIN WOULD NOT HAVE MADE
 * ---------------------------------------------------------------------------
 * After Enter there is a paragraph above the caret, and the plugin only counts
 * a gap as valid with something closed on both sides. It constructs one anyway,
 * and draws it, and the arrows and typing work there. Three things consequently
 * need saying:
 *
 *   - Undo and redo resolve it through `GapBookmark`, which falls back to
 *     `Selection.near`: the item, selected. `appendTransaction` puts it back.
 *   - Backspace would select the empty paragraph (`selectNodeBackward`). Here it
 *     removes it, which is what Enter's opposite should do.
 *   - Any other document change landing there, such as an upload being stored,
 *     falls back the same way and leaves the item selected. Accepted.
 *
 * ---------------------------------------------------------------------------
 * KEPT SELECTIONS: WHAT A MOVE HANDS THE HISTORY
 * ---------------------------------------------------------------------------
 * Moving blocks (`./move-blocks`) has to give back, on undo and redo, exactly the
 * selection it found and made: a selected item (its ring) and a gap cursor beside
 * an item, wherever they now are. Neither survives the history as it stands:
 * `GapBookmark` turns a gap with a paragraph above into the item selected, and
 * `restoreGap` turns any item selected with a paragraph above, after an undo, into
 * a gap. So the move hands the history these two subclasses, whose bookmarks come
 * back as themselves, and `restoreGap` leaves a kept item alone. Nothing else makes
 * them; any new selection is a plain one again.
 */
import { Extension } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import {
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { isMediaNode } from './media';

/** On the item a gap cursor is before: a caret at its top left corner. */
export const GAP_BEFORE_CLASS = 'entry-media-gap-before';

/** On the item a gap cursor is after, when no item follows: its bottom left. */
export const GAP_AFTER_CLASS = 'entry-media-gap-after';

type Found = { pos: number; node: ProseMirrorNode };

/** The media item that starts right after `$pos`, through any wrapper it opens. */
export function mediaAfter($pos: ResolvedPos): Found | null {
	let pos = $pos.pos;
	for (let node = $pos.nodeAfter; node !== null && !node.isTextblock; node = node.firstChild) {
		if (isMediaNode(node)) {
			return { pos, node };
		}
		pos += 1;
	}
	return null;
}

/** The media item that ends right before `$pos`, through any wrapper it closes. */
export function mediaBefore($pos: ResolvedPos): Found | null {
	let pos = $pos.pos;
	for (let node = $pos.nodeBefore; node !== null && !node.isTextblock; node = node.lastChild) {
		if (isMediaNode(node)) {
			return { pos: pos - node.nodeSize, node };
		}
		pos -= 1;
	}
	return null;
}

/** What `Selection.getBookmark` is declared to return. */
type Bookmark = ReturnType<Selection['getBookmark']>;
type NodeBookmark = ReturnType<NodeSelection['getBookmark']>;

/** Whether `$pos` lies between blocks with an item right beside it. */
function besideItem($pos: ResolvedPos): boolean {
	return !$pos.parent.inlineContent && (mediaAfter($pos) !== null || mediaBefore($pos) !== null);
}

/** Where an item's bookmark goes when the item is deleted: the nearest selection. */
class NearBookmark implements Bookmark {
	readonly head: number;
	constructor(readonly anchor: number) {
		this.head = anchor;
	}
	map(mapping: Mappable): NearBookmark {
		return new NearBookmark(mapping.map(this.anchor));
	}
	resolve(doc: ProseMirrorNode): Selection {
		return Selection.near(doc.resolve(this.anchor));
	}
}

class KeptNodeBookmark implements NodeBookmark {
	constructor(readonly anchor: number) {}
	map(mapping: Mappable): KeptNodeBookmark | NearBookmark {
		const { deleted, pos } = mapping.mapResult(this.anchor);
		return deleted ? new NearBookmark(pos) : new KeptNodeBookmark(pos);
	}
	resolve(doc: ProseMirrorNode): Selection {
		const $pos = doc.resolve(this.anchor);
		const node = $pos.nodeAfter;
		return node !== null && NodeSelection.isSelectable(node)
			? new KeptNodeSelection($pos)
			: Selection.near($pos);
	}
}

/** A selected item the history gives back selected. See KEPT SELECTIONS. */
export class KeptNodeSelection extends NodeSelection {
	override map(doc: ProseMirrorNode, mapping: Mappable): Selection {
		const mapped = super.map(doc, mapping);
		return mapped instanceof NodeSelection ? new KeptNodeSelection(mapped.$from) : mapped;
	}

	override getBookmark(): NodeBookmark {
		return new KeptNodeBookmark(this.anchor);
	}
}

class KeptGapBookmark implements Bookmark {
	constructor(readonly pos: number) {}
	map(mapping: Mappable): Bookmark {
		return new KeptGapBookmark(mapping.map(this.pos));
	}
	resolve(doc: ProseMirrorNode): Selection {
		const $pos = doc.resolve(this.pos);
		return besideItem($pos) ? new KeptGapCursor($pos) : Selection.near($pos);
	}
}

/**
 * A gap cursor beside an item that the history gives back as it was, valid to
 * the plugin or not (a paragraph above it). See KEPT SELECTIONS.
 */
export class KeptGapCursor extends GapCursor {
	override map(doc: ProseMirrorNode, mapping: Mappable): Selection {
		const $pos = doc.resolve(mapping.map(this.head));
		return besideItem($pos) ? new KeptGapCursor($pos) : Selection.near($pos);
	}

	override getBookmark(): Bookmark {
		return new KeptGapBookmark(this.anchor);
	}
}

/** The same selection as one the history gives back exactly, or `null` if it already is. */
export function kept(selection: Selection): Selection | null {
	if (selection instanceof KeptNodeSelection || selection instanceof KeptGapCursor) {
		return null;
	}
	if (selection instanceof NodeSelection) {
		return new KeptNodeSelection(selection.$from);
	}
	if (selection instanceof GapCursor) {
		return new KeptGapCursor(selection.$head);
	}
	return null;
}

/** The class saying where the caret goes, on the item it goes beside. */
export function gapCaret(state: EditorState): DecorationSet {
	const { selection, doc } = state;
	if (!(selection instanceof GapCursor)) {
		return DecorationSet.empty;
	}
	const after = mediaAfter(selection.$head);
	const found = after ?? mediaBefore(selection.$head);
	if (found === null) {
		return DecorationSet.empty;
	}
	return DecorationSet.create(doc, [
		Decoration.node(found.pos, found.pos + found.node.nodeSize, {
			class: after === null ? GAP_AFTER_CLASS : GAP_BEFORE_CLASS
		})
	]);
}

type Dispatch = ((tr: Transaction) => void) | undefined;

/**
 * Enter at a gap cursor before an item: an empty paragraph above it, with the
 * caret still before the item, so another Enter adds another line. Its own undo
 * step however fast the presses come. Left alone (`false`) where no item follows.
 */
export function enterAtGap(state: EditorState, dispatch?: Dispatch): boolean {
	const { selection, schema } = state;
	if (!(selection instanceof GapCursor) || mediaAfter(selection.$head) === null) {
		return false;
	}
	const paragraph = schema.nodes.paragraph.create();
	const tr = state.tr.insert(selection.head, paragraph);
	tr.setSelection(new GapCursor(tr.doc.resolve(selection.head + paragraph.nodeSize)));
	dispatch?.(closeHistory(tr).scrollIntoView());
	return true;
}

/** Backspace at a gap cursor with an empty paragraph above: removes it, and stays. */
export function backspaceAtGap(state: EditorState, dispatch?: Dispatch): boolean {
	const { selection } = state;
	if (!(selection instanceof GapCursor)) {
		return false;
	}
	const before = selection.$head.nodeBefore;
	if (before === null || !before.isTextblock || before.content.size > 0) {
		return false;
	}
	const start = selection.head - before.nodeSize;
	const tr = state.tr.delete(start, selection.head);
	tr.setSelection(new GapCursor(tr.doc.resolve(start)));
	dispatch?.(tr.scrollIntoView());
	return true;
}

function mediaCount(doc: ProseMirrorNode): number {
	let count = 0;
	doc.descendants((node) => {
		if (isMediaNode(node)) {
			count += 1;
		}
		return !node.isTextblock;
	});
	return count;
}

/**
 * Undo or redo that arrived at a selected item with a paragraph above it, the
 * item having been there all along: that is `GapBookmark` falling back from a gap
 * it does not count as valid, so the gap is put back. An item the step brought
 * back is another matter: it was selected when it went, and stays so. So is a
 * kept one (KEPT SELECTIONS): it was selected, not a gap fallen back.
 */
export function restoreGap(
	transactions: readonly Transaction[],
	previous: EditorState,
	state: EditorState
): Transaction | null {
	const { selection } = state;
	if (
		!(selection instanceof NodeSelection) ||
		selection instanceof KeptNodeSelection ||
		!isMediaNode(selection.node) ||
		selection.$from.nodeBefore?.isTextblock !== true ||
		!transactions.some(isHistoryTransaction) ||
		mediaCount(previous.doc) !== mediaCount(state.doc)
	) {
		return null;
	}
	return state.tr.setSelection(new GapCursor(selection.$from));
}

/** For the editor's extension list. Holds no schema. */
export function gapCursorExtension(): Extension {
	return Extension.create({
		name: 'noteworthyGapCursor',
		addKeyboardShortcuts() {
			return {
				Enter: () =>
					enterAtGap(this.editor.state, this.editor.view.dispatch.bind(this.editor.view)),
				Backspace: () =>
					backspaceAtGap(this.editor.state, this.editor.view.dispatch.bind(this.editor.view))
			};
		},
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('noteworthyGapCaret'),
					props: { decorations: gapCaret },
					appendTransaction: restoreGap
				})
			];
		}
	});
}
