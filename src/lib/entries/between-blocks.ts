/**
 * A text selection with an end between blocks, right beside a media item: what
 * Ctrl+Shift+Up/Down, Ctrl+Shift+Home and a drag over media make. See
 * docs/constraints.md, "Text-editing keys", "A selection that ends beside media".
 *
 * ---------------------------------------------------------------------------
 * WHY A SUBCLASS OF TextSELECTION, AND NOT OF Selection
 * ---------------------------------------------------------------------------
 * ProseMirror accepts a `TextSelection` with such an end, and draws it, but two
 * things it does with one lose it. `map` collapses it to a caret on any document
 * change, and its bookmark re-resolves through `TextSelection.between`, which
 * pulls the end back into text, so undo cannot bring it back.
 *
 * Everything else about it is right, and depends on it being a `TextSelection`:
 * `splitBlock` in TipTap and in prosemirror-commands only deletes the selection
 * for one (a direct `Selection` subclass made Enter add a line and delete nothing),
 * `selectHorizontally` and `selectVertically` branch on it (Shift+arrows and the
 * plain arrows all changed), and the view's Safari-only path for anything else
 * made undo fall back to the pulled-back selection in WebKit. Measured in all three
 * engines; see docs/constraints.md, "A selection that ends beside media". So this overrides only what loses the selection.
 *
 * It keeps `TextSelection`'s JSON ID and `toJSON`: nothing in the app serialises a
 * selection, and one read back from JSON is put right by `appendTransaction` below.
 * The price is ProseMirror's console warning, once per page load, for a text
 * selection endpoint outside inline content.
 *
 * ---------------------------------------------------------------------------
 * AFTER A DELETE, THE CARET GOES WHERE THE SELECTION BEGAN
 * ---------------------------------------------------------------------------
 * As in Word and Google Docs (decided 2026-11-03). That is `caretAt` on the mapped
 * anchor. An end between blocks lands in the emptied line, or at the end of the
 * paragraph it began from; between two items it is a gap cursor beside what is
 * left. An item is never left selected: only text positions are searched for.
 *
 * TipTap's Delete and Backspace run `deleteRange` and take the caret from `map`;
 * ProseMirror's own `tr.deleteSelection` (a cut, or Enter through `splitBlock`) takes
 * it from `replace`. Both come here.
 *
 * ---------------------------------------------------------------------------
 * WHICH SIDE A MAPPED END STICKS TO
 * ---------------------------------------------------------------------------
 * A between-blocks end sticks inwards, so an upload landing exactly on the
 * selection's edge stays out of it. An end in text maps as `TextSelection`'s does.
 * Something landing inside the selection is inside it, and is selected.
 */
import { Extension } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import type { Node as ProseMirrorNode, ResolvedPos, Slice } from '@tiptap/pm/model';
import {
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { mediaAfter, mediaBefore } from './gap-cursor';

function inText($pos: ResolvedPos): boolean {
	return $pos.parent.inlineContent;
}

function besideMedia($pos: ResolvedPos): boolean {
	return inText($pos) || mediaAfter($pos) !== null || mediaBefore($pos) !== null;
}

/** Whether only blocks' edges lie between two positions: nothing to have selected. */
function coversNothing(doc: ProseMirrorNode, a: number, b: number): boolean {
	const from = Math.min(a, b);
	const to = Math.max(a, b);
	let found = false;
	doc.nodesBetween(from, to, (node, pos) => {
		const emptyLine = node.isTextblock && node.content.size === 0;
		if (node.isLeaf || (emptyLine && pos >= from && pos + node.nodeSize <= to)) {
			found = true;
		}
		return !found;
	});
	return !found;
}

/**
 * The caret at `pos`: in text if it is in text, a gap cursor if it is beside an
 * item, and otherwise the nearest text. Never a selected item.
 */
export function caretAt(doc: ProseMirrorNode, pos: number): Selection {
	const $pos = doc.resolve(pos);
	if (inText($pos)) {
		return new TextSelection($pos);
	}
	if (besideMedia($pos)) {
		return new GapCursor($pos);
	}
	return (
		Selection.findFrom($pos, -1, true) ?? Selection.findFrom($pos, 1, true) ?? Selection.near($pos)
	);
}

/**
 * From `anchor` to `head`, either of which may lie between blocks. Beside an item
 * such an end is kept, whichever class that needs. Nothing between them is the
 * caret where the selection began; a between-blocks end with no item beside it
 * has nothing to mean, and goes back into text as ProseMirror would put it.
 */
export function selectionBetween(doc: ProseMirrorNode, anchor: number, head: number): Selection {
	if (anchor === head || coversNothing(doc, anchor, head)) {
		return caretAt(doc, anchor);
	}
	const $anchor = doc.resolve(anchor);
	const $head = doc.resolve(head);
	if (inText($anchor) && inText($head)) {
		return new TextSelection($anchor, $head);
	}
	if (!besideMedia($anchor) || !besideMedia($head)) {
		return TextSelection.between($anchor, $head);
	}
	return new BetweenBlocksSelection($anchor, $head);
}

/** What TextSelection.getBookmark is declared to return. */
type Bookmark = ReturnType<TextSelection['getBookmark']>;

class BetweenBlocksBookmark implements Bookmark {
	constructor(
		readonly anchor: number,
		readonly head: number
	) {}

	map(mapping: Mappable): Bookmark {
		return new BetweenBlocksBookmark(mapping.map(this.anchor), mapping.map(this.head));
	}

	resolve(doc: ProseMirrorNode): Selection {
		return selectionBetween(doc, this.anchor, this.head);
	}
}

export class BetweenBlocksSelection extends TextSelection {
	override map(doc: ProseMirrorNode, mapping: Mappable): Selection {
		const forward = this.anchor <= this.head;
		const side = ($pos: ResolvedPos, first: boolean): number => (inText($pos) || first ? 1 : -1);
		const anchor = mapping.mapResult(this.anchor, side(this.$anchor, forward));
		const head = mapping.mapResult(this.head, side(this.$head, !forward));
		if (anchor.deletedAcross || head.deletedAcross || forward !== anchor.pos <= head.pos) {
			return caretAt(doc, anchor.pos);
		}
		return selectionBetween(doc, anchor.pos, head.pos);
	}

	override replace(tr: Transaction, content?: Slice): void {
		const start = tr.steps.length;
		super.replace(tr, content);
		if (content === undefined || content.size === 0) {
			// Marks kept for the next character typed, which setting a selection clears.
			const marks = tr.storedMarks;
			tr.setSelection(this.map(tr.doc, tr.mapping.slice(start)));
			if (marks !== null) {
				tr.setStoredMarks(marks);
			}
		}
	}

	override getBookmark(): Bookmark {
		return new BetweenBlocksBookmark(this.anchor, this.head);
	}
}

/**
 * ProseMirror makes between-blocks text selections of its own (Shift+Left/Right
 * over an item, `TextSelection.fromJSON`), and they would lose undo and mapping.
 */
export function adoptBetweenBlocks(state: EditorState): Transaction | null {
	const { selection } = state;
	if (
		selection instanceof BetweenBlocksSelection ||
		!(selection instanceof TextSelection) ||
		selection.empty ||
		(inText(selection.$anchor) && inText(selection.$head))
	) {
		return null;
	}
	return state.tr.setSelection(new BetweenBlocksSelection(selection.$anchor, selection.$head));
}

type Dispatch = ((tr: Transaction) => void) | undefined;

/**
 * Enter over a selection that starts between blocks, which no command in TipTap's
 * Enter chain deletes: `splitBlock` will not act there and `createParagraphNear`
 * adds a line and leaves the selection. As elsewhere, the selection goes and an
 * empty line is left. A selection starting in text is `splitBlock`'s already.
 */
export function enterOverSelection(state: EditorState, dispatch?: Dispatch): boolean {
	const { selection } = state;
	if (!(selection instanceof BetweenBlocksSelection) || inText(selection.$from)) {
		return false;
	}
	const tr = state.tr.deleteSelection();
	const caret = tr.selection;
	if (caret instanceof GapCursor) {
		const line = state.schema.nodes.paragraph.create();
		tr.insert(caret.head, line);
		tr.setSelection(new GapCursor(tr.doc.resolve(caret.head + line.nodeSize)));
	} else if (caret.$head.parent.content.size > 0) {
		tr.split(caret.head);
	}
	dispatch?.(tr.scrollIntoView());
	return true;
}

/** For the editor's extension list. Holds no schema. */
export function betweenBlocksExtension(): Extension {
	return Extension.create({
		name: 'noteworthyBetweenBlocks',
		addKeyboardShortcuts() {
			return {
				Enter: () =>
					enterOverSelection(this.editor.state, this.editor.view.dispatch.bind(this.editor.view))
			};
		},
		addProseMirrorPlugins() {
			return [
				new Plugin({
					key: new PluginKey('noteworthyBetweenBlocks'),
					appendTransaction: (_transactions, _old, state) => adoptBetweenBlocks(state)
				})
			];
		}
	});
}
