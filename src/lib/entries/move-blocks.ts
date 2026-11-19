/**
 * Moving blocks with the keyboard: Alt+Shift+Up/Down off a Mac, Control+Shift+Up/Down
 * on one (the bindings are in `./text-keys`). See docs/constraints.md, "Text-editing
 * keys", "Moving blocks".
 *
 * ---------------------------------------------------------------------------
 * WHAT MOVES, AND PAST WHAT
 * ---------------------------------------------------------------------------
 * The unit is the children of one container that the selection reaches: the entry
 * itself, a list (its items, each with anything nested in it) or a quote (its direct
 * children). The container is the innermost one holding both ends of the selection;
 * a list item is not one, so nothing inside a list item moves on its own, and a
 * selection reaching from a list into the paragraph after it moves the whole list
 * with that paragraph. A child the selection only touches at its edge (from the very
 * end of a paragraph, to the very start of the next) is not part of it, as Delete
 * would leave it whole, unless that leaves nothing: then both blocks it touches move.
 * Then, when the unit is every child of a list or a quote, the list or quote is the
 * unit instead, moving as one block among its container's children; a whole sublist
 * makes its list item the unit; and again, up to the entry (A WHOLE LIST OR QUOTE, in
 * `moveUnit`). So a caret in a list of one item moves the list. A selected item or a gap cursor stands for its item: the one
 * whose corner the gap cursor is drawn at.
 *
 * One press moves the unit past one neighbour, the container's next child that way,
 * whatever it is: a paragraph, an item, or a whole list or quote. At the container's
 * edge nothing happens, and the key is still taken. The empty paragraph TipTap's
 * TrailingNode keeps at the end of the entry stays put: nothing moves past it and it
 * does not move, or a press at the bottom would take it away and TrailingNode would
 * add it back, an edit with nothing to show for it.
 *
 * ---------------------------------------------------------------------------
 * THE STEP, AND WHAT IT KEEPS
 * ---------------------------------------------------------------------------
 * One `ReplaceAroundStep` over the unit and its neighbour, keeping the unit as its gap
 * and putting the neighbour back on the other side. Measured in the editor
 * (see docs/constraints.md, "Moving blocks"): positions in the gap map through the step and its undo, so a
 * collapsed item in the unit stays collapsed and a selected one keeps its ring with no
 * help. The neighbour is put back, so its positions do not map:
 *
 *   - the selection is not left to mapping at all, but made again on the same content
 *     (`moved`), the same kind as it was;
 *   - a collapsed neighbour is found again by `./collapse` (the same node, in the same
 *     transaction);
 *   - an upload's placeholder is carried by `BLOCK_MOVE_META` (`./uploads`), which
 *     says exactly where every position in the pair went.
 *
 * A playing video goes on playing when it ends up before the block it changed places
 * with, and stops when it ends up after it: ProseMirror's view keeps the first child
 * that matches as it goes through the new order and draws the other one afresh. That
 * is the view's, whatever step is used (all four candidates measured the same).
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 * Each press is its own undo step: the history is closed before the move and again
 * after it, so neither a quick second press nor the typing after it joins it. Undo and
 * redo give back the selection exactly: the history keeps a bookmark of the selection
 * before each step, so a selected item or a gap cursor is first made a kept one
 * (`./gap-cursor`, KEPT SELECTIONS), whose bookmark comes back as itself.
 */
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
	NodeSelection,
	Plugin,
	PluginKey,
	TextSelection,
	type EditorState,
	Selection,
	type Transaction
} from '@tiptap/pm/state';
import { ReplaceAroundStep } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { selectionBetween } from './between-blocks';
import { KeptNodeSelection, KeptGapCursor, kept, mediaAfter, mediaBefore } from './gap-cursor';
import { isMediaNode } from './media';

/**
 * Set on a move's transaction: before it, `[from, mid)` and `[mid, to)` were two runs
 * of blocks side by side; after it the second comes first.
 */
export type BlockMove = { from: number; mid: number; to: number };

export const BLOCK_MOVE_META = 'noteworthyBlockMove';

/**
 * Where a position in one of the two runs went: a block's start goes with its block
 * (`[from, mid)` and `[mid, to)` are half open). `null` for a position outside both,
 * which the step maps as ProseMirror maps anything.
 */
export function movedPosition(move: BlockMove, pos: number): number | null {
	if (pos >= move.from && pos < move.mid) {
		return pos + (move.to - move.mid);
	}
	if (pos >= move.mid && pos < move.to) {
		return pos - (move.mid - move.from);
	}
	return null;
}

function isContainer(node: ProseMirrorNode): boolean {
	const groups = (node.type.spec.group ?? '').split(' ');
	return (
		node.type === node.type.schema.topNodeType ||
		node.type.name === 'blockquote' ||
		groups.includes('list')
	);
}

/** Whether anything is selected in `[a, b)`: text, a leaf, or a whole empty line. */
function holdsAnything(doc: ProseMirrorNode, a: number, b: number): boolean {
	if (b <= a) {
		return false;
	}
	let found = false;
	doc.nodesBetween(a, b, (node, pos) => {
		if (found) {
			return false;
		}
		if (node.isText) {
			found = Math.min(b, pos + node.nodeSize) > Math.max(a, pos);
		} else if (node.isLeaf || (node.isTextblock && node.content.size === 0)) {
			found = pos >= a && pos + node.nodeSize <= b;
		}
		return !found;
	});
	return found;
}

/** The range a selection stands for: a gap cursor its item, anything else itself. */
function reach(selection: Selection): { from: number; to: number } | null {
	if (selection instanceof GapCursor) {
		const item = mediaAfter(selection.$head) ?? mediaBefore(selection.$head);
		return item === null ? null : { from: item.pos, to: item.pos + item.node.nodeSize };
	}
	return { from: selection.from, to: selection.to };
}

export type MoveUnit = {
	/** The unit's children, `[first, last]`, and the neighbour's index. */
	first: number;
	last: number;
	neighbour: number;
	/** In the document: the unit, and the neighbour. */
	unit: { from: number; to: number };
	other: { from: number; to: number };
};

/** The unit and its container's children, before any neighbour is chosen. */
type Unit = {
	/** The container's children, by index, and where each starts (one more: the end). */
	offsets: number[];
	childCount: number;
	first: number;
	last: number;
	/** Whether child `index` is TrailingNode's empty last paragraph. */
	trailing: (index: number) => boolean;
};

/** What the selection would move, with the trailing paragraph left out; `null` for nothing. */
function unitOf(doc: ProseMirrorNode, selection: Selection): Unit | null {
	const range = reach(selection);
	if (range === null) {
		return null;
	}
	const $from = doc.resolve(range.from);
	const $to = doc.resolve(range.to);
	const containerAt = (from: number): number => {
		let at = from;
		while (at > 0 && !isContainer($from.node(at))) {
			at -= 1;
		}
		return at;
	};
	let depth = containerAt($from.sharedDepth(range.to));
	let container = $from.node(depth);
	let offsets: number[] = [];
	const measure = () => {
		container = $from.node(depth);
		offsets = [$from.start(depth)];
		container.forEach((child) => offsets.push(offsets[offsets.length - 1] + child.nodeSize));
	};
	measure();
	const span = (index: number) => ({ from: offsets[index], to: offsets[index + 1] });

	let first = $from.index(depth);
	let last = $to.indexAfter(depth) - 1;
	if (last < first) {
		return null;
	}
	const touched = (index: number) => {
		const { from, to } = span(index);
		return holdsAnything(doc, Math.max(from, range.from), Math.min(to, range.to));
	};
	// Children only touched at an edge are left out, unless that would leave none (from
	// the very end of one paragraph to the very start of the next, as Shift+Right at a
	// paragraph's end makes): then both move (decided 2026-11-08).
	const covered: number[] = [];
	for (let index = first; index <= last; index += 1) {
		if (touched(index)) {
			covered.push(index);
		}
	}
	if (covered.length > 0) {
		first = covered[0];
		last = covered[covered.length - 1];
	}
	// A WHOLE LIST OR QUOTE: units that are every child of a list or a quote make the
	// list or quote itself the unit, and so on up: a whole sublist makes its list item
	// the unit (nothing in an item moves on its own), which moves among its own list's
	// items, unless they are all selected too (decided 2026-11-09).
	while (depth > 0 && first === 0 && last === container.childCount - 1) {
		depth = containerAt(depth - 1);
		measure();
		first = $from.index(depth);
		last = first;
	}

	const trailing = (index: number) =>
		depth === 0 &&
		index === container.childCount - 1 &&
		container.child(index).type.name === 'paragraph' &&
		container.child(index).content.size === 0;
	if (trailing(last)) {
		if (last === first) {
			return null;
		}
		last -= 1;
	}
	return { offsets, childCount: container.childCount, first, last, trailing };
}

/** What a press would move, and past what; `null` where nothing would move. */
export function moveUnit(state: EditorState, dir: -1 | 1): MoveUnit | null {
	const found = unitOf(state.doc, state.selection);
	if (found === null) {
		return null;
	}
	const { offsets, childCount, first, last, trailing } = found;
	const neighbour = dir < 0 ? first - 1 : last + 1;
	if (neighbour < 0 || neighbour >= childCount || trailing(neighbour)) {
		return null;
	}
	return {
		first,
		last,
		neighbour,
		unit: { from: offsets[first], to: offsets[last + 1] },
		other: { from: offsets[neighbour], to: offsets[neighbour + 1] }
	};
}

/**
 * DROPPING. What a drag of the selection moves (the same unit as a press), and the
 * places it can land: every boundary between its container's children, as one press
 * after another would take it, so a top-level item never lands inside a list or a
 * quote, and nothing lands below TrailingNode's empty last paragraph. The unit's own
 * two edges are in the list (a drop there moves nothing). `null` where nothing can move.
 * `moving` is what is dragged: the selection, or an item dragged by its own button
 * without being selected (PRD 16 decision 13), as `NodeSelection` of it.
 */
export function dropPlaces(
	state: EditorState,
	moving: Selection = state.selection
): { unit: MoveUnit['unit']; places: number[] } | null {
	const found = unitOf(state.doc, moving);
	if (found === null) {
		return null;
	}
	const { offsets, childCount, first, last, trailing } = found;
	const places: number[] = [];
	for (let index = 0; index <= childCount; index += 1) {
		const inside = index > first && index <= last;
		const pastTrailing = index === childCount && trailing(childCount - 1);
		if (!inside && !pastTrailing) {
			places.push(offsets[index]);
		}
	}
	return { unit: { from: offsets[first], to: offsets[last + 1] }, places };
}

/**
 * The same selection on the same content after the unit moved by `delta`. An end the
 * unit does not reach (the edge of a child it only touched) is brought to the unit's
 * edge first, so the selection still covers what it covered.
 */
function moved(
	selection: Selection,
	doc: ProseMirrorNode,
	unit: MoveUnit['unit'],
	delta: number
): Selection {
	const place = (pos: number) => Math.min(Math.max(pos, unit.from), unit.to) + delta;
	if (selection instanceof GapCursor) {
		const before = mediaAfter(selection.$head);
		const item = before ?? mediaBefore(selection.$head);
		// `reach` found it, so it is there.
		const pos = item!.pos + delta + (before === null ? item!.node.nodeSize : 0);
		return new KeptGapCursor(doc.resolve(pos));
	}
	if (selection instanceof NodeSelection) {
		return new KeptNodeSelection(doc.resolve(selection.from + delta));
	}
	// A text selection, a between-blocks one included. (A select-all reaches every
	// child, so it never moves.) Both ends in text: exactly that text selection, even one
	// covering only the edge between two blocks, which `selectionBetween` makes a caret.
	const anchor = doc.resolve(place(selection.anchor));
	const head = doc.resolve(place(selection.head));
	if (anchor.parent.inlineContent && head.parent.inlineContent) {
		return new TextSelection(anchor, head);
	}
	return selectionBetween(doc, anchor.pos, head.pos);
}

/**
 * The move a press makes, as a transaction: a state and a direction in, the
 * transaction out, or `null` where nothing moves (an edge, or nothing to move).
 */
export function blockMove(state: EditorState, dir: -1 | 1): Transaction | null {
	const found = moveUnit(state, dir);
	return found === null ? null : shift(state, found.unit, found.other, dir < 0).scrollIntoView();
}

/**
 * THE STEP: the unit past `other`, the run of its siblings straight before it (`up`) or
 * after it, as one `ReplaceAroundStep` keeping the unit as its gap. A press passes one
 * neighbour; a drop passes as many as lie between the unit and where it lands. The
 * selection after it is `moving` on the same content: the selection, or an item dragged
 * without being selected, which is selected once it lands.
 */
function shift(
	state: EditorState,
	unit: MoveUnit['unit'],
	other: MoveUnit['other'],
	up: boolean,
	moving: Selection = state.selection
): Transaction {
	const neighbour = state.doc.slice(other.from, other.to).content;
	const size = other.to - other.from;
	const from = up ? other.from : unit.from;
	const to = up ? unit.to : other.to;
	const step = new ReplaceAroundStep(
		from,
		to,
		unit.from,
		unit.to,
		new Slice(Fragment.from(neighbour), 0, 0),
		up ? 0 : size,
		false
	);
	const tr = state.tr.step(step);
	const delta = up ? -size : size;
	const move: BlockMove = up ? { from, mid: unit.from, to } : { from, mid: unit.to, to };
	tr.setSelection(moved(moving, tr.doc, unit, delta));
	return closeHistory(tr).setMeta(BLOCK_MOVE_META, move);
}

/** The editor's view, or anything that holds a state and dispatches (the unit tests). */
type View = { readonly state: EditorState; dispatch: (tr: Transaction) => void };

type Sides = number | { top: number; right: number; bottom: number; left: number };
const side = (value: Sides | undefined, which: 'top' | 'bottom', fallback: number): number =>
	value === undefined ? fallback : typeof value === 'number' ? value : value[which];

/**
 * THE MOVED BLOCKS IN VIEW. The move's `scrollIntoView` is ProseMirror's, which brings
 * the caret (or a selected item) into view and nothing more: a paragraph of several lines
 * moved down with the caret on its first line was left with the rest below the window,
 * and even a line of its own ended a pixel past the window's bottom (its box is taller
 * than the caret). So after it the whole moved run, `[from, to)` in the new document, is
 * brought into view where it fits, with the editor's own edges: below the pinned row by
 * `scrollThreshold` and `scrollMargin`, which the editor sets (`EntryEditor.svelte`), and
 * the same at the bottom. A run taller than the room is left to ProseMirror's scroll of
 * the caret. The window only: the editor is never in a scrolling box of its own.
 *
 * The page's own scroll anchoring moves first, in all three engines (Playwright's WebKit
 * 26 too): a block moved up, whose element ProseMirror kept, is held still where it was
 * on the screen, and ProseMirror then finds it in view and does nothing. Measured; see
 * docs/constraints.md, "Moving blocks".
 */
function revealMoved(view: EditorView, from: number, to: number): void {
	const win = view.dom.ownerDocument.defaultView;
	if (win === null) {
		return;
	}
	const $from = view.state.doc.resolve(from);
	let top = Infinity;
	let bottom = -Infinity;
	$from.parent.forEach((_child, offset) => {
		const pos = $from.start() + offset;
		if (pos < from || pos >= to) {
			return;
		}
		const dom = view.nodeDOM(pos);
		if (dom instanceof win.HTMLElement) {
			const box = dom.getBoundingClientRect();
			top = Math.min(top, box.top);
			bottom = Math.max(bottom, box.bottom);
		}
	});
	if (top === Infinity) {
		return;
	}
	const threshold = view.someProp('scrollThreshold') as Sides | undefined;
	const margin = view.someProp('scrollMargin') as Sides | undefined;
	const restTop = side(margin, 'top', 5);
	const restBottom = win.innerHeight - side(margin, 'bottom', 5);
	if (bottom - top > restBottom - restTop) {
		return;
	}
	if (top < side(threshold, 'top', 0)) {
		win.scrollBy({ top: top - restTop, behavior: 'instant' });
	} else if (bottom > win.innerHeight - side(threshold, 'bottom', 0)) {
		win.scrollBy({ top: bottom - restBottom, behavior: 'instant' });
	}
}

/**
 * A press: nothing at an edge (the key is still taken, so `true`), otherwise the
 * selection made a kept one, the move, the moved blocks brought into view (THE MOVED
 * BLOCKS IN VIEW, in the editor only), and the history closed after it.
 */
export function moveBlocks(view: View, dir: -1 | 1): boolean {
	const found = moveUnit(view.state, dir);
	if (found === null) {
		return true;
	}
	const keep = kept(view.state.selection);
	if (keep !== null) {
		view.dispatch(view.state.tr.setSelection(keep));
	}
	const tr = blockMove(view.state, dir);
	if (tr !== null) {
		view.dispatch(tr);
		if ('nodeDOM' in view) {
			const size = found.other.to - found.other.from;
			const delta = dir < 0 ? -size : size;
			revealMoved(view as EditorView, found.unit.from + delta, found.unit.to + delta);
		}
		view.dispatch(closeHistory(view.state.tr));
	}
	return true;
}

/**
 * The move a drop at `place` makes (one of `dropPlaces`), as a transaction, or `null`
 * where it moves nothing: at the unit's own edges, or anywhere not on the list.
 */
export function blockDrop(
	state: EditorState,
	place: number,
	moving: Selection = state.selection
): Transaction | null {
	const found = dropPlaces(state, moving);
	if (found === null || !found.places.includes(place)) {
		return null;
	}
	const { unit } = found;
	if (place === unit.from || place === unit.to) {
		return null;
	}
	const up = place < unit.from;
	return shift(
		state,
		unit,
		up ? { from: place, to: unit.from } : { from: unit.to, to: place },
		up,
		moving
	);
}

/**
 * A drop, as a press is made (`moveBlocks`): the selection made a kept one, the move,
 * and the history closed after it, so it is one undo step that gives the selection
 * back. No scroll: the unit lands where the pointer is. Whether anything moved.
 *
 * `item`: the position of an item dragged by its own button without being selected
 * (PRD 16 decision 13). That item moves, not the selection, and is selected where it
 * lands, in the move's own transaction: so the history's bookmark is of the selection
 * there was before the drag, and undo gives that back (kept first, as for a press).
 */
export function dropBlocks(view: View, place: number, item: number | null = null): boolean {
	const moving = (state: EditorState): Selection =>
		item === null ? state.selection : new KeptNodeSelection(state.doc.resolve(item));
	if (blockDrop(view.state, place, moving(view.state)) === null) {
		return false;
	}
	const keep = kept(view.state.selection);
	if (keep !== null) {
		view.dispatch(view.state.tr.setSelection(keep));
	}
	const tr = blockDrop(view.state, place, moving(view.state));
	if (tr === null) {
		return false;
	}
	view.dispatch(tr);
	view.dispatch(closeHistory(view.state.tr));
	return true;
}

/**
 * THE PAGE'S SELECTION AROUND A SELECTED ITEM. The browser can move its own selection
 * off a selected item with nobody doing anything, and ProseMirror then reads that back
 * as a new selection: the ring goes, and the next press moves something else. Measured
 * (the guard off; Firefox never did it; see docs/constraints.md, "Moving blocks", the guard):
 *
 *   - Chromium, an item selected between two other items: the moment a modifier goes
 *     down, with or without any move (Shift alone, a photo between a video and audio),
 *     its selection goes to the start of the entry's first line. Alt+Shift+Down then
 *     moved the first paragraph. After a move it also happened once by itself, 17ms
 *     after the figures were drawn again.
 *   - WebKit: whenever the selected figure's insides change, with or without a move. A
 *     figure drawn afresh by a move fills itself when its link answers (38 to 56ms here,
 *     a round trip later on a slower line).
 *
 * So the page's selection is not taken, ProseMirror's own is kept and drawn again, in two
 * narrow cases, and only when an item is selected (a gap cursor too, after a move) and the
 * read is of the selection alone (the document is not changing with it):
 *
 *   - from a move, or an undo or redo, until anybody presses a key (a modifier is not
 *     one; it counts once the editor has handled it, see `down`), the mouse or a finger,
 *     or starts composing: a read with none of those is the
 *     browser's, whenever the link answers. Measured per move: Chromium 2 such reads (its
 *     own move, and one more after the selection is drawn again, then none in 2s), WebKit
 *     1, Firefox 0;
 *   - while a modifier is held and nothing else has been pressed since it went down: a
 *     modifier alone never moves a selection;
 *   - THE ENTRY'S START: a read collapsed at the entry's start (`Selection.atStart`), with
 *     an item selected and no key, click, touch or composition since it was selected.
 *     That is where Chromium throws the page's selection, and it can do so before the
 *     modifier's keydown reaches the page, so before the window above opens: 3 runs in
 *     40 of the guard test moved "First" (see docs/constraints.md, "Moving blocks").
 *     Decided
 *     2026-11-09 as the narrow rule, over refusing any read while an item is
 *     selected.
 *
 * Nothing else is refused. A swipe on Android's space bar or a screen reader moving the
 * caret with no key event is refused only between a move (or its undo or redo) and the
 * next key, press, touch or composition. A phone moves an item only by a long press on ⌃
 * or a collapsed row (A LONG PRESS ON ⌃ in `pointer-selection.ts`), and the next touch
 * ends that window; neither holds a modifier. The selection is drawn again at most once
 * per task.
 */
export function keepSelectedItem(): Plugin<number> {
	// A count of moves, undos and redos, so the view can tell one has happened.
	const key = new PluginKey<number>('noteworthyKeepSelectedItem');
	let seen = 0;
	let armed = false;
	let held = false;
	// An item selected, and no key, click or touch since: THE ENTRY'S START, below.
	let untouched = false;
	let redrawing = false;
	// Refusals so far, for a probe of the guard to read through the plugin's spec (see
	// docs/constraints.md, "Moving blocks", the guard).
	let refused = 0;
	return new Plugin<number>({
		key,
		refusals: () => refused,
		state: {
			init: () => 0,
			apply: (tr, count) =>
				tr.getMeta(BLOCK_MOVE_META) !== undefined || isHistoryTransaction(tr) ? count + 1 : count
		},
		view(view) {
			const document = view.dom.ownerDocument;
			const modifier = (event: KeyboardEvent) =>
				['Shift', 'Control', 'Alt', 'Meta'].includes(event.key);
			const input = (): void => {
				armed = false;
				held = false;
				untouched = false;
			};
			// A key other than a modifier ends both windows, but only once the editor's own
			// handlers have had it. ProseMirror's keydown reads the page's selection first
			// thing (`forceFlush`), and a change a modifier brought about (Chromium) that it
			// had not read yet is read there. Ended in the capture phase, before it, that read
			// was taken, and Alt+Shift+Down moved "First" (2 runs in 10, Chromium,
			// see docs/constraints.md, "Moving blocks"). So it ends in the bubble phase on
			// the document: after the editor's handlers, before the key's default action (the
			// browser's own caret move, or typing). A task later as well, should anything stop
			// the key's propagation. A move the key makes keeps the after-move window open.
			let pressing: number | null = null;
			const settle = (): void => {
				if (pressing === null) {
					return;
				}
				if (seen === pressing) {
					armed = false;
				}
				held = false;
				untouched = false;
				pressing = null;
			};
			const down = (event: KeyboardEvent): void => {
				if (modifier(event)) {
					held = true;
					untouched = false;
					return;
				}
				settle();
				pressing = seen;
				setTimeout(settle, 0);
			};
			const handled = (event: KeyboardEvent): void => {
				if (!modifier(event)) {
					settle();
				}
			};
			const up = (event: KeyboardEvent): void => {
				if (modifier(event)) {
					held = false;
				}
			};
			const presses = ['pointerdown', 'mousedown', 'touchstart', 'compositionstart'] as const;
			document.addEventListener('keydown', down, true);
			document.addEventListener('keydown', handled);
			document.addEventListener('keyup', up, true);
			for (const type of presses) {
				document.addEventListener(type, input, true);
			}
			return {
				update: (updated, previous) => {
					const { selection } = updated.state;
					if (
						!selection.eq(previous.selection) &&
						selection instanceof NodeSelection &&
						isMediaNode(selection.node)
					) {
						untouched = true;
					}
					const count = key.getState(updated.state) ?? 0;
					if (count !== seen) {
						seen = count;
						armed = true;
					}
				},
				destroy: () => {
					document.removeEventListener('keydown', down, true);
					document.removeEventListener('keydown', handled);
					document.removeEventListener('keyup', up, true);
					for (const type of presses) {
						document.removeEventListener(type, input, true);
					}
				}
			};
		},
		props: {
			createSelectionBetween: (view, $anchor, $head) => {
				const { selection } = view.state;
				const item =
					(selection instanceof NodeSelection && isMediaNode(selection.node)) ||
					(armed && selection instanceof GapCursor);
				// `$anchor` in another document: the selection is being read with a change.
				if (!item || $anchor.doc !== view.state.doc) {
					return null;
				}
				// THE ENTRY'S START: where Chromium throws the page's selection, sometimes before
				// the modifier's keydown reaches the page, so before `held` can be set.
				const toStart =
					untouched &&
					selection instanceof NodeSelection &&
					$anchor.pos === $head.pos &&
					$anchor.pos === Selection.atStart(view.state.doc).from;
				if (!(armed || held || toStart)) {
					return null;
				}
				refused += 1;
				if (!redrawing) {
					redrawing = true;
					setTimeout(() => {
						redrawing = false;
						if (view.hasFocus()) {
							view.focus();
						}
					}, 0);
				}
				return selection;
			}
		}
	});
}
