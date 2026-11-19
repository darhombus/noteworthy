/**
 * The mouse around media, and on a selection. See docs/constraints.md,
 * "Text-editing keys", "The pointer".
 *
 * ---------------------------------------------------------------------------
 * A DRAG COVERS AN ITEM AS SOON AS THE POINTER IS OVER IT
 * ---------------------------------------------------------------------------
 * Left to the browsers, it does not. Chromium does not move its selection while the
 * pointer is over a `<video>`. Over a collapsed row or stacked items, the browser's
 * focus lands inside a figure at offset 0, which ProseMirror reads as "before the
 * item", and `TextSelection.between` pulls the head back to the text above. Nothing
 * reaches an item at the very top. And some engines cover an item early, from the
 * margin above it.
 *
 * So while the pointer is over an item, or in the margin next to one, the head comes
 * from its height (`headAt`): the item's far side, between the blocks. Only the
 * height, so a pointer beside the column still counts. Two ways in, because neither
 * is enough alone: `createSelectionBetween` answers when the browser reports a change,
 * and `mousemove` dispatches for when it reports none (over a video). Over text
 * neither does anything, and a drag that never comes near an item is the browser's
 * and ProseMirror's own, untouched.
 *
 * ---------------------------------------------------------------------------
 * THE ANCHOR IS THE BROWSER'S CARET
 * ---------------------------------------------------------------------------
 * Read from the browser's selection at the first move, before the browser has answered
 * it, not from `posAtCoords` at the press. (After its answer, a long fast first move
 * from the middle of a line into the gap between two items had already moved Chromium's
 * own anchor to the line's start.) In a margin the two differ: between the last line and the empty one below
 * it, Chromium's caret goes into the empty line and `posAtCoords` gives the position
 * between the two paragraphs, which no item is beside, so `selectionBetween` pulled
 * every head back into text and a drag up over the items below a line tinted none of
 * them (reported 2026-11-05). Starting on the line itself, the two differed by one.
 *
 * ---------------------------------------------------------------------------
 * PAINTED AS HELD
 * ---------------------------------------------------------------------------
 * During a mouse drag in Chrome, ProseMirror does not write its selection to the page
 * while the page's anchor is unchanged, until the release (`selectionToDOM`, "Need to
 * delay selection normalization"). Over text the browser moves its own selection, so
 * nothing is lost; over an item only ProseMirror's moves. Coming up from below a video
 * or audio item into a photo above a line, the photo was tinted and the line held
 * whole while the page still drew half of it, until the release. So whenever the head
 * is decided here, and once more as it is given back over text, the page's selection is
 * put where ProseMirror's is (`paintSelection`). In every engine: in Firefox and WebKit
 * ProseMirror's own write over an item left the page's head on the far side of it.
 *
 * ---------------------------------------------------------------------------
 * A PRESS ON AN ITEM
 * ---------------------------------------------------------------------------
 * A press anywhere on a media item but its own controls (the player, the collapse
 * button, the row) is a press beside it: before it in its upper half, after it in its
 * lower half. Dragged, it selects from there, the item included as soon as the pointer
 * is over it; released where it began, it is a click there, which clears the
 * selection and leaves the caret or gap cursor beside the item, or, on a photo's
 * picture, selects the photo. ProseMirror and the browser are kept out of it, so every
 * head is decided here: the browser makes no selection from inside a figure, and
 * ProseMirror would select the item or start dragging it. Until then the player
 * claimed its whole figure (`stopEvent`), so a click in the blank space beside a
 * portrait video, or beside the audio player, reached nothing: the page's selection
 * went and ProseMirror's stayed, the media still tinted.
 *
 * ---------------------------------------------------------------------------
 * A CLICK ON THE PAGE BACKGROUND
 * ---------------------------------------------------------------------------
 * Outside the editor's column, the browser drops its selection, and so the drawn one.
 * ProseMirror kept its own, hidden (the tint too, by `entry-selection-elsewhere`), and
 * Delete or Bold after returning acted on what nobody could see. So a press there
 * clears it, once the browser has answered the press and only if it took focus
 * nowhere and left its selection outside the editor. Never a press on anything that
 * acts on the selection or takes focus (`KEEPS_SELECTION`): the toolbar, a menu, a
 * dialog, the title. A node selection keeps its ring, so it is left.
 *
 * ---------------------------------------------------------------------------
 * LEAVING THE BROWSER TO START
 * ---------------------------------------------------------------------------
 * A browser decides what a press is on its first move past a few pixels: a selection
 * if the press is outside the selected text, a drag of that text if inside. So nothing
 * here may change the selection before then. A selection written in that move's own
 * handler (ProseMirror writes at once until its own handler has seen a move) contains
 * the press point by the time the browser looks, and it starts a drag of the text: a
 * quick flick of the mouse from a paragraph into the margin below it moved the words.
 * So each move is answered after the browser's own handling of it, and only once
 * the pointer has left the press.
 *
 * ---------------------------------------------------------------------------
 * A CLICK ON A SELECTION ALWAYS CLEARS IT
 * ---------------------------------------------------------------------------
 * A press on selected text released a few pixels away did nothing. Below some
 * distance the browser ignores it; from there on it starts a drag of the selection
 * that drops on itself. The distance differs (measured: a `mouseup` at 3px in Chromium
 * and 1px in WebKit, a `drop` from 4px and 3px; Firefox's `mouseup` collapses by itself). So both are answered
 * alike, by distance alone: under ProseMirror's own click tolerance of 10px, the caret
 * goes to the release point. A drag of 10px or more moves the text as ever.
 *
 * Only mouse events are read, so a long press and the handles on a phone are the
 * browser's own (but on ⌃: A LONG PRESS ON ⌃, below). A tap on a selection, for which phones send a `mousedown` and a
 * `mouseup` a moment later, comes here as a click.
 *
 * ---------------------------------------------------------------------------
 * SCROLLING AT THE EDGES
 * ---------------------------------------------------------------------------
 * A browser scrolls the page while a drag of its own is held near or past the window's
 * edge. A drag pressed on an item is not the browser's (the press is prevented, A PRESS
 * ON AN ITEM), so nothing scrolled, and the selection could not go past the window
 * (reported 2026-11-06). So such a drag scrolls here (`edgeSpeed`), as Chromium's own
 * text drag does, measured: within 20px of an edge, or past it, by the distance into
 * that band in pixels per frame, held still or not, until the pointer is back inside,
 * the page's end, or the release. One rule for every engine (`data-engine` is for
 * appearance only); Firefox's and WebKit's own start at the edge itself. The top edge is
 * the bottom of the pinned row, which no browser knows of.
 *
 * And whatever scrolls the page under a drag followed here (the browser's own edge
 * scroll included), the head is taken again from where the pointer now is: no
 * `mousemove` comes while it is held still, and a head decided over an item stayed
 * there while the browser's own selection went on.
 *
 * ---------------------------------------------------------------------------
 * MOVING A SELECTED ITEM
 * ---------------------------------------------------------------------------
 * A photo, video or audio item selected on its own (its ring) is moved by pressing on
 * it with a mouse or touchpad and dragging (PRD 16, decision 10). Anywhere on it but
 * the player (`NOT_FOR_MOVING`): the photo, the blank space beside a player, a video's
 * picture, the collapsed row and the corner button. An item not selected is pressed as before (A
 * PRESS ON AN ITEM), except on its buttons (ANY ITEM BY ITS BUTTONS). The editor runs the drag, not the browser's drag and drop: so the
 * edges scroll by the rule above (the browser's own knows nothing of the pinned row,
 * and Firefox's and WebKit's did not scroll at all), nothing leaves the page (a drop
 * on the title, or in another tab, would be the browser's), and only a press whose
 * `pointerdown` was a mouse's starts one; a touch never does, but for A LONG PRESS ON ⌃
 * (below). The browser's own drag
 * of a selected item is refused (`dragstart`): it started from a selected video's
 * picture (the page's selection holds the figure, and ProseMirror makes a selected
 * figure `draggable`), so the three kinds disagreed (reported 2026-11-07).
 *
 * A VIDEO'S PICTURE. A selected video is also grabbed by its picture: the video's box
 * above its bottom `VIDEO_CONTROLS_PX`, in every engine (no engine check), and never a
 * sound-only video's. Chromium and Firefox both play or pause on a click there, so the
 * press is left to the player (nothing prevented) until the pointer has moved 6px with
 * the button held; then it is a move drag, and its release (`pointerup`, `mouseup`,
 * `click`) is kept from the player, so it neither plays nor pauses. Released over the
 * video, Chromium sends only the `click`, which ends the drag. Firefox sends the page
 * no press and no release on a video at all (only `dragstart` and the moves), so
 * there it never starts, and its picture stays the player's: measured (see
 * docs/constraints.md, "Dragging a selected item"), and no engine check is made. The player's own
 * controls, and an audio player (whose time display sits differently in each engine,
 * and plays on a click in Firefox), are never grabbed.
 *
 * ITS BUTTONS. The collapsed row, and the corner button that collapses an item, are
 * drag handles too (decided 2026-11-10), for every kind and engine: our own buttons, so
 * every engine sends their presses (the press is caught in the capture phase, ahead of
 * the button's own `mousedown` and of `stopEvent`). Moved 6px with the button held, it
 * is a move drag, and its release's `click` is swallowed, so it neither collapses nor
 * expands; under that, it is the button's click, as before. A touch, or the keyboard:
 * the button, unchanged. The move cursor shows once a drag has begun (`MOVING_CLASS`),
 * never on hover.
 *
 * ANY ITEM BY ITS BUTTONS (PRD 16 decision 13, 2026-11-13). The two buttons move their
 * item whether or not it is selected; everywhere else on an item that is not selected, a
 * press is as before (A PRESS ON AN ITEM). Not selected, the press changes nothing until
 * it is dragged (focus stays where it was, and a click collapses or expands, as before),
 * the item moves, not the selection (`dropBlocks`'s `item`), and it is selected where it
 * lands, in the move's own transaction, then focused. So undo gives back the selection
 * there was before the drag, and Escape or a drop outside changes nothing at all. It
 * takes a press that is held (a mouse button, a touchpad pushed down): a touchpad's
 * tap-and-drag toggles the item first, Windows sending its first tap as a click
 * (decided 2026-11-13; docs/constraints.md, "Any item by its buttons").
 *
 * QUICK PRESSES. The second (or third) press of a run is a handle's press too: a click on
 * an item, then a press there and a drag, is done quickly, and felt as one gesture. Until
 * it moves 6px it is what it was.
 *
 * What moves, and where it can land, are the keys' (`./move-blocks`, DROPPING): the
 * unit a press would move, put at the boundary between its container's children
 * nearest the pointer, which a line shows. The same step as a press, so it is one undo
 * step, the item is still selected, a collapsed one stays collapsed and an upload's
 * placeholder follows its block. A release where the press began is a click, as
 * before; one at the unit's own place, back where it started, moves nothing.
 * Escape, or a release anywhere but over the editor below the pinned row, moves
 * nothing at all.
 *
 * ---------------------------------------------------------------------------
 * A LONG PRESS ON ⌃
 * ---------------------------------------------------------------------------
 * The one move a finger makes (PRD 16 decision 14, the one exception to "a touch never
 * starts one"). Held still on an expanded item's corner button, or anywhere on a
 * collapsed item's row (decided 2026-11-13: else a collapsed item could not be moved on
 * a phone), for `HOLD_MS`, within
 * `HOLD_SLOP_PX`, the item is picked up: its figure gets `LIFTED_CLASS` (the ring, drawn
 * by a class, so neither the selection nor focus changes, and the on-screen keyboard
 * neither opens nor closes) and a short buzz (`buzz`). From then on the finger's touch
 * events drive the same move as a mouse's (the line, the edge scroll, the drop as one
 * step), the bottom edge being above the keyboard (`fingerBottom`); the item is
 * selected where it lands and focus is left where it was. Released where it was held,
 * nothing happens, and the tap Chromium makes of that is swallowed (`swallowTap`).
 *
 * Before the pick-up the page is the browser's: a finger moving past the slop, or
 * the page scrolling under it, lets go, and the page scrolls as it would anywhere. After
 * it, the button's own non-passive `touchmove` (`holdTheFinger` in `./collapse`, there
 * before the finger lands, so the browser waits for it) keeps the page still. Android's
 * menu at a long press (`contextmenu`) is refused on the held button while it is held.
 * A long press anywhere else, a photo included, is the browser's own. Measured
 * under Chromium's touch emulation (see docs/constraints.md, "A long press on ⌃"): Android's own
 * long press is not, and is still to be checked on a real Android phone.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
	AllSelection,
	NodeSelection,
	Plugin,
	PluginKey,
	TextSelection,
	type EditorState
} from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { caretAt, selectionBetween } from './between-blocks';
import { mediaAfter } from './gap-cursor';
import { isMediaNode } from './media';
import { LIFTED_CLASS } from './collapse';
import { dropBlocks, dropPlaces } from './move-blocks';
import { SOUND_ONLY_CLASS } from '$lib/media/player';
import { browserSelectionHere } from './selection-tint';

/** ProseMirror's own click tolerance, as the square of the distance (`isNear`). */
const CLICK_TOLERANCE_SQUARED = 100;

/** See `leftThePress`. */
const LEFT_THE_PRESS_PX = 6;

/** Long enough for ProseMirror's selection sync after the release. */
const AFTER_RELEASE_MS = 50;

/** Chromium's band inside each edge where its own drag scrolls (measured, 2026-11-06). */
export const EDGE_BAND_PX = 20;

/**
 * How far to scroll per frame with the pointer at height `y`, between a top edge (the
 * pinned row's bottom) and a bottom edge (the window's): negative is up, 0 inside.
 * Chromium's own, measured: by the distance into a band of `EDGE_BAND_PX` inside the
 * edge, counting the band's first row as 1 at the bottom (619 in a 620px window gives
 * 20), and as the band's width less the pointer's height at the top (row 0 gives 20).
 */
export function edgeSpeed(y: number, top: number, bottom: number): number {
	const up = top + EDGE_BAND_PX - y;
	if (up > 0) {
		return -up;
	}
	const down = y - (bottom - EDGE_BAND_PX) + 1;
	return down > 0 ? down : 0;
}

/** The height the pointer counts as at: clamped into the visible part of the page. */
export function visibleY(y: number, top: number, bottom: number): number {
	return Math.min(Math.max(y, top + 1), bottom - 1);
}

/** Where the page's visible part starts: below the pinned row, if one is there. */
function visibleTop(view: EditorView): number {
	const row = view.dom.ownerDocument.querySelector('[data-pinned-row]');
	if (row !== null) {
		return Math.max(0, row.getBoundingClientRect().bottom);
	}
	const threshold = view.someProp('scrollThreshold');
	return typeof threshold === 'number' ? threshold : (threshold?.top ?? 0);
}

function visibleBottom(view: EditorView): number {
	return view.dom.ownerDocument.documentElement.clientHeight;
}

/**
 * The bottom a finger can reach, in the window's coordinates: the visual viewport's
 * bottom when it ends higher (Android's keyboard, which by default shrinks only the
 * visual viewport, so the window's own bottom is under the keys), else the window's.
 */
export function fingerBottom(
	windowBottom: number,
	viewport: { offsetTop: number; height: number } | null
): number {
	return viewport === null
		? windowBottom
		: Math.min(windowBottom, viewport.offsetTop + viewport.height);
}

/** See `fingerBottom`: for a move by a finger (A LONG PRESS ON ⌃). */
function touchBottom(view: EditorView): number {
	const viewport = view.dom.ownerDocument.defaultView?.visualViewport ?? null;
	return fingerBottom(visibleBottom(view), viewport);
}

/** A media item and what lies round it, by height on screen. */
export type Span = {
	pos: number;
	end: number;
	top: number;
	bottom: number;
	/** The bottom of the block before; -Infinity above an item that starts the entry. */
	above: number;
	/** The top of the block after: the margin down to it counts as the item, going down. */
	below: number;
	/** The end of the text straight before, if a textblock is. */
	textBefore: number | null;
};

/**
 * Where the head goes with the pointer at height `y`, for a selection from `anchor`:
 * past the item it is over, or on this side of one it has not reached yet. `null`
 * over text, which is the browser's.
 *
 * The margin between stacked items belongs to the item already crossed, either way.
 */
export function headAt(spans: readonly Span[], anchor: number, y: number): number | null {
	for (const span of spans) {
		if (span.pos >= anchor) {
			if (y >= span.top && y < span.below) {
				return span.end;
			}
			if (y < span.top && y >= span.above && span.textBefore !== null) {
				return span.textBefore;
			}
		} else if (span.end <= anchor) {
			if (y <= span.bottom && y > span.above) {
				return span.pos;
			}
		}
	}
	return null;
}

function rectOf(view: EditorView, pos: number): DOMRect | null {
	const dom = view.nodeDOM(pos);
	return dom instanceof HTMLElement ? dom.getBoundingClientRect() : null;
}

function spansOf(view: EditorView): Span[] {
	const { doc } = view.state;
	const leading = mediaAfter(doc.resolve(0))?.pos ?? null;
	const spans: Span[] = [];
	doc.descendants((node, pos) => {
		if (node.isTextblock) {
			return false;
		}
		if (!isMediaNode(node)) {
			return true;
		}
		const box = rectOf(view, pos);
		if (box === null) {
			return false;
		}
		const end = pos + node.nodeSize;
		const $pos = doc.resolve(pos);
		const $end = doc.resolve(end);
		const before = $pos.nodeBefore;
		const after = $end.nodeAfter;
		const boxBefore = before === null ? null : rectOf(view, pos - before.nodeSize);
		const boxAfter = after === null ? null : rectOf(view, end);
		spans.push({
			pos,
			end,
			top: box.top,
			bottom: box.bottom,
			above: pos === leading ? -Infinity : (boxBefore?.bottom ?? box.top),
			below: boxAfter?.top ?? box.bottom,
			textBefore: before?.isTextblock === true ? pos - 1 : null
		});
		return false;
	});
	return spans;
}

/** Whether a press at this document position lands on what is selected. */
export function insideSelection(state: EditorState, pos: number): boolean {
	const { selection } = state;
	const ranged = selection instanceof TextSelection || selection instanceof AllSelection;
	return ranged && !selection.empty && pos >= selection.from && pos <= selection.to;
}

/**
 * Whether a press at this position is only on the selection's edge. It may be on the
 * selected letter, and start a drag of the text, or just past it, and start a new
 * selection: only the browser knows, so both are followed until it says which.
 */
export function onSelectionEdge(state: EditorState, pos: number): boolean {
	const { from, to } = state.selection;
	return pos === from || pos === to;
}

/**
 * Whether the pointer is far enough from the press that the browser has decided what
 * the press is. Past every engine's own distance for starting a drag (4px at most).
 */
export function leftThePress(fromX: number, fromY: number, x: number, y: number): boolean {
	return Math.hypot(x - fromX, y - fromY) >= LEFT_THE_PRESS_PX;
}

/** Whether a release at (x, y) counts as a click pressed at (fromX, fromY). */
export function withinClick(fromX: number, fromY: number, x: number, y: number): boolean {
	const dx = x - fromX;
	const dy = y - fromY;
	return dx * dx + dy * dy < CLICK_TOLERANCE_SQUARED;
}

/** The caret under the point, as a click there would put it. */
function placeCaret(view: EditorView, x: number, y: number): void {
	const at = view.posAtCoords({ left: x, top: y });
	if (at === null) {
		return;
	}
	const caret = caretAt(view.state.doc, at.pos);
	if (!caret.eq(view.state.selection)) {
		view.dispatch(view.state.tr.setSelection(caret).setMeta('pointer', true));
	}
	view.focus();
}

type Drag = {
	/**
	 * Where the selection stays anchored: the browser's caret at the press, read at the
	 * first move (`null` until then); with Shift the selection's own; on an item, beside it.
	 */
	anchor: number | null;
	/** Where the press was by `posAtCoords`, if the browser's caret cannot be read. */
	pressedAt: number;
	/** The head while it is decided here, and `null` while it is the browser's. */
	head: number | null;
	/** Pressed on an item: the browser was kept out, so every head is decided here. */
	own: boolean;
};

type Press = { x: number; y: number };

/** Where the pointer is, in the window's coordinates. */
type Point = { x: number; y: number };

/** What a press is on, inside a media item's figure. */
type ItemPress =
	{ kind: 'control' } | { kind: 'item'; pos: number; end: number; box: DOMRect; picture: boolean };

/**
 * The parts of a figure that are the item's own controls: the player, the collapse
 * button and the collapsed row, and an upload's placeholder. Everything else in a
 * figure (the blank space beside a portrait photo or video, the strip beside the audio
 * player, the photo itself) is the item, for selecting.
 */
const CONTROLS = 'video, audio, button, .entry-upload';

/** The media item a figure in the editor draws, if it draws one. */
function itemOf(
	view: EditorView,
	figure: Element | null
): { pos: number; node: ProseMirrorNode } | null {
	if (figure === null || !view.dom.contains(figure)) {
		return null;
	}
	let found: { pos: number; node: ProseMirrorNode } | null = null;
	view.state.doc.descendants((node, pos) => {
		if (found !== null || node.isTextblock) {
			return false;
		}
		if (isMediaNode(node) && view.nodeDOM(pos) === figure) {
			found = { pos, node };
			return false;
		}
		return !isMediaNode(node);
	});
	return found;
}

/** What the press is on, if inside a media item's figure; `null` elsewhere. */
function itemUnder(view: EditorView, target: EventTarget | null): ItemPress | null {
	if (!(target instanceof Element) || !view.dom.contains(target)) {
		return null;
	}
	if (target.closest(CONTROLS) !== null) {
		return { kind: 'control' };
	}
	const figure = target.closest('figure');
	const found = itemOf(view, figure);
	if (figure === null || found === null) {
		return null;
	}
	return {
		kind: 'item',
		pos: found.pos,
		end: found.pos + found.node.nodeSize,
		box: figure.getBoundingClientRect(),
		picture:
			found.node.type.name === 'image' &&
			target.closest('.entry-media-body img, .entry-media-pending, .entry-media-missing') !== null
	};
}

/** The browser's own anchor, as a document position, if its selection is in the editor. */
function browserAnchor(view: EditorView): number | null {
	const selection = view.dom.ownerDocument.getSelection();
	const node = selection?.anchorNode ?? null;
	if (selection === null || node === null || !view.dom.contains(node)) {
		return null;
	}
	try {
		return view.posAtDOM(node, selection.anchorOffset);
	} catch {
		return null;
	}
}

/**
 * Puts the browser's selection where ProseMirror's is, if its head is elsewhere. See
 * PAINTED AS HELD above. Placed as ProseMirror's own `setSelection` would place it.
 */
export function paintSelection(view: EditorView): void {
	const domSelection = view.dom.ownerDocument.getSelection();
	if (domSelection === null || domSelection.rangeCount === 0 || !view.hasFocus()) {
		return;
	}
	const { anchor, head } = view.state.selection;
	const at = (node: Node | null, offset: number): number | null => {
		if (node === null || !view.dom.contains(node)) {
			return null;
		}
		try {
			return view.posAtDOM(node, offset);
		} catch {
			return null;
		}
	};
	if (
		at(domSelection.anchorNode, domSelection.anchorOffset) === anchor &&
		at(domSelection.focusNode, domSelection.focusOffset) === head
	) {
		return;
	}
	const from = view.domAtPos(anchor, anchor ? -1 : 1);
	const to = view.domAtPos(head, head ? -1 : 1);
	domSelection.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

/**
 * Where a press on an item at height `y` counts as being: before the item in its upper
 * half, after it in its lower half. See A PRESS ON AN ITEM above.
 */
export function besideItem(
	item: { pos: number; end: number; box: { top: number; bottom: number } },
	y: number
): number {
	return y < (item.box.top + item.box.bottom) / 2 ? item.pos : item.end;
}

/**
 * What on the page acts on the selection, or takes focus, so that a press on it keeps
 * the editor's selection: see A CLICK ON THE PAGE BACKGROUND above.
 */
const KEEPS_SELECTION =
	'button, a, input, textarea, select, label, summary, dialog, audio, video, [role], [tabindex], [contenteditable]';

/** Whether a press on `target`, outside the editor, leaves the editor's selection. */
export function keepsSelection(target: Element): boolean {
	return target.closest(KEEPS_SELECTION) !== null;
}

/**
 * SCROLLING AT THE EDGES, for a drag run here: every animation frame while the pointer
 * is near an edge or past it, by `edgeSpeed`, then `follow` the pointer at once, in the
 * same frame (left to the `scroll` event, a frame later, a head was a frame behind the
 * page, 50px and more out). Per frame, as Chromium's own: its steps stayed the same while
 * frames took 14–23ms. Back inside, or at the page's end, it waits for `start` again.
 */
function edgeScroller(
	view: EditorView,
	pointer: () => Point | null,
	follow: (at: Point) => void,
	bottom: (view: EditorView) => number = visibleBottom
): { start: () => void; stop: () => void } {
	const win = view.dom.ownerDocument.defaultView;
	let frame: number | null = null;
	let ended = false;
	const scrollFrame = (): void => {
		frame = null;
		const at = pointer();
		if (ended || view.isDestroyed || at === null || win === null) {
			return;
		}
		const speed = edgeSpeed(at.y, visibleTop(view), bottom(view));
		const page = view.dom.ownerDocument.scrollingElement ?? view.dom.ownerDocument.documentElement;
		const atEnd =
			speed < 0 ? win.scrollY <= 0 : win.scrollY >= page.scrollHeight - page.clientHeight - 0.5;
		if (speed === 0 || atEnd) {
			// Back inside, or at the page's end: starts again on the next move.
			return;
		}
		win.scrollBy({ top: speed, behavior: 'instant' });
		follow(at);
		frame = win.requestAnimationFrame(scrollFrame);
	};
	return {
		start: () => {
			if (!ended && frame === null && win !== null) {
				frame = win.requestAnimationFrame(scrollFrame);
			}
		},
		stop: () => {
			ended = true;
			if (frame !== null) {
				win?.cancelAnimationFrame(frame);
				frame = null;
			}
		}
	};
}

/**
 * A press on a selected item that can start moving it. See MOVING A SELECTED ITEM.
 * `video`: on a video's picture, which stays the player's until the pointer moves.
 */
type MovePress = {
	pos: number;
	end: number;
	box: DOMRect;
	picture: boolean;
	/** On one of the item's own buttons (ITS BUTTONS), whose click is its own. */
	button: boolean;
	video?: boolean;
	/** Not the selected item: one of its buttons, pressed (ANY ITEM BY ITS BUTTONS). */
	unselected?: boolean;
};

/**
 * The bottom of a video kept for its controls, in every engine (no engine check): the
 * larger of the bars measured, Chromium's 72px (buttons, then its timeline) and
 * Firefox's 40px. WebKit's could not be measured (Playwright's WebKit plays no video).
 */
export const VIDEO_CONTROLS_PX = 72;

/** Whether a press at height `y` on a video drawn from `top` to `bottom` is on its picture. */
export function onVideoPicture(top: number, bottom: number, y: number): boolean {
	return y >= top && y < bottom - VIDEO_CONTROLS_PX;
}

/**
 * The selected video under a press on its picture, if there is one: a video with a
 * picture (not a sound-only one), pressed above its controls. See A VIDEO'S PICTURE.
 */
function selectedPictureUnder(
	view: EditorView,
	target: EventTarget | null,
	y: number
): MovePress | null {
	const { selection } = view.state;
	if (
		!(selection instanceof NodeSelection) ||
		selection.node.type.name !== 'video' ||
		!(target instanceof Element)
	) {
		return null;
	}
	const figure = view.nodeDOM(selection.from);
	const video = target.closest('video');
	if (
		!(figure instanceof HTMLElement) ||
		video === null ||
		!figure.contains(video) ||
		video.classList.contains(SOUND_ONLY_CLASS)
	) {
		return null;
	}
	const box = video.getBoundingClientRect();
	if (!onVideoPicture(box.top, box.bottom, y)) {
		return null;
	}
	return {
		pos: selection.from,
		end: selection.to,
		box: figure.getBoundingClientRect(),
		picture: false,
		button: false,
		video: true
	};
}

/**
 * The parts of a selected item a press on which never moves it: the player (its own
 * drags move its timeline and volume; a video's picture is the exception, A VIDEO'S
 * PICTURE) and an upload's placeholder.
 */
const NOT_FOR_MOVING = 'video, audio, .entry-upload';

/**
 * The item's own buttons, which move it when dragged and keep their click: the
 * collapsed row (all there is of a collapsed item) and the corner button that
 * collapses it (decided 2026-11-10). See ITS BUTTONS.
 */
const ITEM_BUTTONS = '.entry-media-row, .entry-media-collapse';

/**
 * What a press on `target`, inside a selected item's figure, is for moving it: one of
 * the item's own buttons, the rest of the item, or `null` for what never moves it.
 */
export function movePressOn(target: Element): 'button' | 'item' | null {
	if (target.closest(NOT_FOR_MOVING) !== null) {
		return null;
	}
	return target.closest(ITEM_BUTTONS) !== null ? 'button' : 'item';
}

/** The selected item under a press, if the press can move it; `null` otherwise. */
function selectedItemUnder(view: EditorView, target: EventTarget | null): MovePress | null {
	const { selection } = view.state;
	if (
		!(selection instanceof NodeSelection) ||
		!isMediaNode(selection.node) ||
		!(target instanceof Element)
	) {
		return null;
	}
	const figure = view.nodeDOM(selection.from);
	const kind = movePressOn(target);
	if (!(figure instanceof HTMLElement) || !figure.contains(target) || kind === null) {
		return null;
	}
	return {
		pos: selection.from,
		end: selection.to,
		box: figure.getBoundingClientRect(),
		picture:
			selection.node.type.name === 'image' &&
			target.closest('.entry-media-body img, .entry-media-pending, .entry-media-missing') !== null,
		button: kind === 'button'
	};
}

/**
 * An item not selected, under a press on one of its own buttons, which moves it
 * whether or not it is selected (ANY ITEM BY ITS BUTTONS); `null` otherwise.
 */
function buttonItemUnder(view: EditorView, target: EventTarget | null): MovePress | null {
	if (!(target instanceof Element) || target.closest(NOT_FOR_MOVING) !== null) {
		return null;
	}
	const button = target.closest(ITEM_BUTTONS);
	const figure = button?.closest('figure') ?? null;
	const found = itemOf(view, figure);
	if (found === null) {
		return null;
	}
	return {
		pos: found.pos,
		end: found.pos + found.node.nodeSize,
		box: figure!.getBoundingClientRect(),
		picture: false,
		button: true,
		unselected: true
	};
}

/** How long a finger is held still on ⌃ before the item is picked up (A LONG PRESS ON ⌃). */
export const HOLD_MS = 500;

/** How far a held finger may wander and still be holding, not scrolling. */
export const HOLD_SLOP_PX = 10;

/** The buzz at a pick-up, where the phone can (`navigator.vibrate`). */
export const BUZZ_MS = 20;

/**
 * ⌃ and the collapsed row, the item's own buttons (`ITEM_BUTTONS`): a long press
 * anywhere else is the browser's own.
 */
const HOLD_BUTTON = ITEM_BUTTONS;

/** A finger held on ⌃, waiting to pick its item up, or holding it. */
type Hold = {
	finger: number;
	at: Point;
	button: Element;
	/** Picked up: the finger's moves are the item's now. */
	picked: boolean;
	timer: ReturnType<typeof setTimeout>;
};

/** The short buzz of a pick-up, where there is one; a phone without it is not an error. */
export function buzz(navigator: { vibrate?: (pattern: number) => boolean } | null): void {
	try {
		navigator?.vibrate?.(BUZZ_MS);
	} catch {
		// Refused (no user activation yet, or not allowed here): the ring still shows.
	}
}

/** Where the drop line for `place` is drawn: across the boundary between the blocks either side. */
function lineAt(
	view: EditorView,
	place: number
): { top: number; left: number; right: number } | null {
	const $place = view.state.doc.resolve(place);
	const before = $place.nodeBefore;
	const after = $place.nodeAfter;
	const above = before === null ? null : rectOf(view, place - before.nodeSize);
	const below = after === null ? null : rectOf(view, place);
	if (above === null && below === null) {
		return null;
	}
	const top =
		above !== null && below !== null
			? (above.bottom + below.top) / 2
			: (above?.bottom ?? below!.top);
	return {
		top,
		left: Math.min(above?.left ?? Infinity, below?.left ?? Infinity),
		right: Math.max(above?.right ?? -Infinity, below?.right ?? -Infinity)
	};
}

/** The place whose line is nearest the pointer's height; `null` with none. */
export function nearestPlace(
	lines: readonly { place: number; top: number }[],
	y: number
): number | null {
	let best: { place: number; top: number } | null = null;
	for (const line of lines) {
		if (best === null || Math.abs(line.top - y) < Math.abs(best.top - y)) {
			best = line;
		}
	}
	return best?.place ?? null;
}

/**
 * The place a drop lands at: the nearest whose line can be seen, between the pinned
 * row's bottom (`top`) and the window's (`bottom`), so it lands where the line was shown
 * and the line is never drawn under the row; the nearest of all if none can be seen.
 */
export function nearestSeenPlace(
	lines: readonly { place: number; top: number }[],
	y: number,
	top: number,
	bottom: number
): number | null {
	const seen = lines.filter((line) => line.top >= top && line.top <= bottom);
	return nearestPlace(seen.length > 0 ? seen : lines, y);
}

/**
 * Whether a release here drops in the entry: over the editor, below the pinned row.
 * Anywhere else (the title, the toolbar, the page beside the column) moves nothing.
 */
function overEditor(view: EditorView, at: Point): boolean {
	const box = view.dom.getBoundingClientRect();
	return (
		at.x >= box.left &&
		at.x <= box.right &&
		at.y >= Math.max(box.top, visibleTop(view)) &&
		at.y <= box.bottom
	);
}

/** On `<html>` while a move drag is under way: the move cursor (`layout.css`). */
export const MOVING_CLASS = 'entry-moving';

/** Swallows the click a release is about to make (an item's own button's, which toggles it). */
function swallowClick(document: Document): void {
	const swallow = (click: Event): void => {
		click.preventDefault();
		click.stopPropagation();
	};
	document.addEventListener('click', swallow, true);
	setTimeout(() => document.removeEventListener('click', swallow, true));
}

/**
 * How long after a finger is lifted the tap the browser makes of it may still come:
 * Chromium's came 3ms after `touchend`, as an event of its own (measured,
 * see docs/constraints.md, "A long press on ⌃"), so the next task is too soon to stop listening.
 */
const TAP_AFTER_LIFT_MS = 1000;

/**
 * Swallows the tap a lifted finger may still make where it was held (its `click`, which
 * would collapse the item): the next click near `at`, within `TAP_AFTER_LIFT_MS`, and
 * before the next finger lands. Android sends none after a long press, so a tap of
 * the next finger is that tap's own.
 */
function swallowTap(document: Document, at: Point): void {
	const swallow = (click: MouseEvent): void => {
		if (!withinClick(at.x, at.y, click.clientX, click.clientY)) {
			return;
		}
		click.preventDefault();
		click.stopPropagation();
		done();
	};
	const done = (): void => {
		clearTimeout(timer);
		document.removeEventListener('click', swallow, true);
		document.removeEventListener('touchstart', done, true);
	};
	document.addEventListener('click', swallow, true);
	document.addEventListener('touchstart', done, { capture: true, passive: true });
	const timer = setTimeout(done, TAP_AFTER_LIFT_MS);
}

function pointerPlugin(): Plugin {
	let drag: Drag | null = null;
	let press: Press | null = null;
	/** Ends what the last press started: a drag being followed, a release awaited, or both. */
	let stops: (() => void)[] = [];
	const stopAll = (): void => {
		const running = stops;
		stops = [];
		for (const stop of running) {
			stop();
		}
	};

	const followDrag = (view: EditorView, current: Drag, pointer: Point): void => {
		// See THE ANCHOR IS THE BROWSER'S CARET above.
		const anchor = (current.anchor ??= browserAnchor(view) ?? current.pressedAt);
		let { x, y } = pointer;
		/** Where the caret is looked for: the same point, kept inside the editor. */
		let caretY = y;
		if (current.own) {
			// Past an edge, or beside the column, what the pointer counts as over is the
			// nearest of the editor that can be seen. See SCROLLING AT THE EDGES above.
			const box = view.dom.getBoundingClientRect();
			y = visibleY(y, visibleTop(view), visibleBottom(view));
			x = Math.min(Math.max(x, box.left + 1), box.right - 1);
			caretY = Math.min(Math.max(y, box.top + 1), box.bottom - 1);
		}
		const head = headAt(spansOf(view), anchor, y);
		let target: number | null = head;
		if (head === null) {
			if (current.head === null && !current.own) {
				return;
			}
			// Back over text, where the browser may report nothing if its own selection
			// never moved while the head was decided here.
			target = view.posAtCoords({ left: x, top: caretY })?.pos ?? null;
		}
		// Decided here until now: given back, the page may still show the item.
		const handedBack = head === null && current.head !== null;
		current.head = current.own ? (target ?? current.head) : head;
		if (target === null) {
			return;
		}
		const selection = selectionBetween(view.state.doc, anchor, target);
		if (!selection.eq(view.state.selection)) {
			view.dispatch(view.state.tr.setSelection(selection).setMeta('pointer', true));
		}
		if ((head !== null || handedBack) && !current.own) {
			// See PAINTED AS HELD above.
			paintSelection(view);
		}
	};

	/** A press on an item released where it began: see A PRESS ON AN ITEM above. */
	const clickItem = (
		view: EditorView,
		item: ItemPress & { kind: 'item' },
		beside: number,
		shift: boolean
	): void => {
		const { doc } = view.state;
		const selection = item.picture
			? NodeSelection.create(doc, item.pos)
			: shift
				? selectionBetween(doc, view.state.selection.anchor, beside)
				: caretAt(doc, beside);
		if (!selection.eq(view.state.selection)) {
			view.dispatch(view.state.tr.setSelection(selection).setMeta('pointer', true));
		}
		view.focus();
	};

	const startDrag = (
		view: EditorView,
		event: MouseEvent,
		pressedAt: number,
		item: (ItemPress & { kind: 'item' }) | null = null
	): void => {
		const beside = item === null ? null : besideItem(item, event.clientY);
		const anchor = event.shiftKey ? view.state.selection.anchor : beside;
		const current: Drag = { anchor, pressedAt, head: null, own: item !== null };
		const pressed = { x: event.clientX, y: event.clientY };
		drag = current;
		let latest: MouseEvent | null = null;
		let ended = false;
		/** The pointer, once it has left the press: what the head follows as the page moves. */
		let pointer: Point | null = null;
		const win = view.dom.ownerDocument.defaultView;
		// See SCROLLING AT THE EDGES above. Only a drag the browser is kept out of.
		const edges = edgeScroller(
			view,
			() => pointer,
			(at) => followDrag(view, current, at)
		);
		const scrollAtEdge = (): void => {
			if (current.own && !ended) {
				edges.start();
			}
		};
		// Whatever moved the page, the pointer is over something else now.
		const scrolled = (): void => {
			if (!ended && pointer !== null && !view.isDestroyed) {
				followDrag(view, current, pointer);
			}
		};
		const follow = (moved: MouseEvent): void => {
			if (!leftThePress(pressed.x, pressed.y, moved.clientX, moved.clientY)) {
				return;
			}
			pointer = { x: moved.clientX, y: moved.clientY };
			followDrag(view, current, pointer);
			scrollAtEdge();
		};
		const move = (moved: MouseEvent): void => {
			if (moved.buttons === 0) {
				finish();
				return;
			}
			// Before the browser's own answer to the first move, which can move its anchor.
			// See THE ANCHOR IS THE BROWSER'S CARET above.
			current.anchor ??= browserAnchor(view) ?? current.pressedAt;
			const waiting = latest !== null;
			latest = moved;
			if (!waiting) {
				// After the browser's own answer to this move. See LEAVING THE BROWSER TO START.
				setTimeout(() => {
					const next = latest;
					latest = null;
					if (!ended && next !== null && !view.isDestroyed) {
						follow(next);
					}
				});
			}
		};
		const finish = (released?: Event): void => {
			ended = true;
			edges.stop();
			win?.removeEventListener('scroll', scrolled);
			view.root.removeEventListener('mousemove', move as EventListener, true);
			view.root.removeEventListener('mouseup', finish, true);
			// Wherever it ended, unless the browser never left the press.
			if (released instanceof MouseEvent && released.type === 'mouseup') {
				if (
					item !== null &&
					beside !== null &&
					withinClick(pressed.x, pressed.y, released.clientX, released.clientY)
				) {
					clickItem(view, item, beside, event.shiftKey);
				} else {
					follow(released);
				}
			}
			// Kept a moment: the browser's last report of the drag can still arrive.
			setTimeout(() => {
				if (drag === current) {
					drag = null;
				}
			}, AFTER_RELEASE_MS);
		};
		view.root.addEventListener('mousemove', move as EventListener, true);
		view.root.addEventListener('mouseup', finish, true);
		win?.addEventListener('scroll', scrolled, { passive: true });
		stops.push(() => finish());
	};

	const startPress = (view: EditorView, event: MouseEvent): void => {
		const current: Press = { x: event.clientX, y: event.clientY };
		press = current;
		const release = (released: Event): void => {
			view.root.removeEventListener('mouseup', release, true);
			if (press !== current) {
				return;
			}
			press = null;
			const { clientX, clientY } = released as MouseEvent;
			if (withinClick(current.x, current.y, clientX, clientY)) {
				// After ProseMirror's and the browser's own answers to the release.
				setTimeout(() => {
					if (!view.isDestroyed) {
						placeCaret(view, clientX, clientY);
					}
				});
			}
		};
		view.root.addEventListener('mouseup', release, true);
		stops.push(() => view.root.removeEventListener('mouseup', release, true));
	};

	/** See MOVING A SELECTED ITEM above. */
	const startMove = (
		view: EditorView,
		pressed: Point,
		item: MovePress,
		/** The move that started it, from a video's picture: already past the press. */
		begun: MouseEvent | null = null,
		/** Picked up by a finger (A LONG PRESS ON ⌃): its touch's identifier, whose moves drive it. */
		touch: number | null = null
	): void => {
		const document = view.dom.ownerDocument;
		const win = document.defaultView;
		// ANY ITEM BY ITS BUTTONS: an item not selected moves itself, not the selection.
		const moving = item.unselected === true ? item.pos : null;
		const found = dropPlaces(
			view.state,
			moving === null ? view.state.selection : NodeSelection.create(view.state.doc, moving)
		);
		const startDoc = view.state.doc;
		const beside = besideItem(item, pressed.y);
		/** The bottom a drag scrolls at: for a finger, above the on-screen keyboard. */
		const bottomOf = touch === null ? visibleBottom : touchBottom;
		/** The pointer, once it has left the press. */
		let pointer: Point | null = null;
		/** Gone further than a click's tolerance at some point: the release is a drop. */
		let travelled = false;
		let cancelled = false;
		let ended = false;
		let place: number | null = null;
		let line: HTMLElement | null = null;

		const show = (at: Point): void => {
			place = null;
			if (cancelled || found === null || view.state.doc !== startDoc || !overEditor(view, at)) {
				if (line !== null) {
					line.hidden = true;
				}
				return;
			}
			const top = visibleTop(view);
			const bottom = bottomOf(view);
			const y = visibleY(at.y, top, bottom);
			const lines = found.places.flatMap((at) => {
				const drawn = lineAt(view, at);
				return drawn === null ? [] : [{ place: at, ...drawn }];
			});
			place = nearestSeenPlace(lines, y, top, bottom);
			const drawn = lines.find((candidate) => candidate.place === place);
			if (drawn === undefined || ended) {
				return;
			}
			if (line === null) {
				line = document.createElement('div');
				line.className = 'entry-drop-line';
				line.setAttribute('aria-hidden', 'true');
				document.body.append(line);
			}
			line.hidden = false;
			line.style.top = `${drawn.top}px`;
			line.style.left = `${drawn.left}px`;
			line.style.width = `${drawn.right - drawn.left}px`;
		};
		const edges = edgeScroller(view, () => (cancelled ? null : pointer), show, bottomOf);

		const moveTo = (at: Point): void => {
			if (pointer === null && !leftThePress(pressed.x, pressed.y, at.x, at.y)) {
				return;
			}
			// On the item's own button, 6px makes a drag (ITS BUTTONS): its release must not
			// also collapse or expand it. Elsewhere, a click's tolerance, as ProseMirror's.
			if (item.button || !withinClick(pressed.x, pressed.y, at.x, at.y)) {
				travelled = true;
			}
			if (pointer === null) {
				// The drag has begun: the move cursor, until it ends.
				document.documentElement.classList.add(MOVING_CLASS);
			}
			pointer = at;
			show(pointer);
			if (!cancelled) {
				edges.start();
			}
		};
		const move = (moved: MouseEvent): void => {
			if (moved.buttons === 0) {
				// Released where no `mouseup` reached the page: nothing moves.
				cancelled = true;
				finish();
				return;
			}
			moveTo({ x: moved.clientX, y: moved.clientY });
		};
		/** The finger's own touch in `list`, if it is there. */
		const fingerIn = (list: TouchList): Point | null => {
			for (const one of Array.from(list)) {
				if (one.identifier === touch) {
					return { x: one.clientX, y: one.clientY };
				}
			}
			return null;
		};
		// A finger's moves and its lifting, read from touch events: Chrome on Android may
		// cancel the pointer at a long press (`ToastItem.svelte`), while the touch goes on.
		// The page is kept still by the button's own listener (`holdTheFinger`).
		const touchMove = (moved: TouchEvent): void => {
			const at = fingerIn(moved.changedTouches);
			if (at !== null) {
				moveTo(at);
			}
		};
		const touchEnd = (lifted: TouchEvent): void => {
			const at = fingerIn(lifted.changedTouches);
			if (at === null) {
				return;
			}
			if (lifted.type === 'touchcancel') {
				// Taken by the browser: nothing moves.
				cancelled = true;
			}
			end(lifted, at);
		};
		const scrolled = (): void => {
			if (pointer !== null && !ended) {
				show(pointer);
			}
		};
		const escape = (key: KeyboardEvent): void => {
			if (key.key !== 'Escape') {
				return;
			}
			key.preventDefault();
			key.stopPropagation();
			cancelled = true;
			edges.stop();
			document.documentElement.classList.remove(MOVING_CLASS);
			show(pointer ?? pressed);
		};
		const end = (released: Event | undefined, at: Point | null): void => {
			if (ended) {
				return;
			}
			ended = true;
			edges.stop();
			view.root.removeEventListener('mousemove', move as EventListener, true);
			view.root.removeEventListener('mouseup', finish, true);
			document.removeEventListener('touchmove', touchMove, true);
			document.removeEventListener('touchend', touchEnd, true);
			document.removeEventListener('touchcancel', touchEnd, true);
			document.removeEventListener('keydown', escape, true);
			document.removeEventListener('pointerup', keepFromPlayer, true);
			document.removeEventListener('click', finish, true);
			win?.removeEventListener('scroll', scrolled);
			line?.remove();
			document.documentElement.classList.remove(MOVING_CLASS);
			view.dom.querySelector(`.${LIFTED_CLASS}`)?.classList.remove(LIFTED_CLASS);
			if (item.video === true && released !== undefined) {
				// A VIDEO'S PICTURE: the release ends a drag, and is not the player's.
				keepFromPlayer(released);
			}
			if (at === null || view.isDestroyed) {
				return;
			}
			if (touch !== null) {
				// Whatever the lifting does next, it is not a tap on the button: Chromium
				// sends one for a finger lifted where it was held (A LONG PRESS ON ⌃).
				swallowTap(document, pressed);
			}
			if (!travelled && withinClick(pressed.x, pressed.y, at.x, at.y)) {
				// A click, as before: the item's own button's click collapses or expands it.
				if (!item.button) {
					clickItem(view, { kind: 'item', ...item }, beside, false);
				}
				return;
			}
			// A drag, not a click on the button.
			swallowClick(document);
			if (cancelled) {
				return;
			}
			show(at);
			if (place !== null && view.state.doc === startDoc && dropBlocks(view, place, moving)) {
				// Selected where it landed: the editor takes the keys for it. Not for a
				// finger: focus would open the on-screen keyboard (A LONG PRESS ON ⌃).
				if (moving !== null && touch === null) {
					view.focus();
				}
			}
		};
		const finish = (released?: Event): void => {
			end(
				released,
				released instanceof MouseEvent ? { x: released.clientX, y: released.clientY } : null
			);
		};
		if (touch === null) {
			view.root.addEventListener('mousemove', move as EventListener, true);
			view.root.addEventListener('mouseup', finish, true);
		} else {
			document.addEventListener('touchmove', touchMove, { capture: true, passive: true });
			document.addEventListener('touchend', touchEnd, true);
			document.addEventListener('touchcancel', touchEnd, true);
		}
		document.addEventListener('keydown', escape, true);
		win?.addEventListener('scroll', scrolled, { passive: true });
		stops.push(() => finish());
		if (begun !== null) {
			// From a video's picture: the press has been left already, so this is a drag
			// whatever happens next, and its release (`pointerup`, `mouseup`, `click`) is
			// kept from the player, which would play or pause on it.
			travelled = true;
			document.addEventListener('pointerup', keepFromPlayer, true);
			// Released over the video, Chromium sends no `mouseup` after the browser's own
			// drag was refused, only a `click`, which would play or pause it: that click is
			// the release (measured; see docs/constraints.md, "Dragging a selected item").
			document.addEventListener('click', finish, true);
			move(begun);
		}
	};

	/** Keeps a release from the player under it. See A VIDEO'S PICTURE above. */
	const keepFromPlayer = (event: Event): void => {
		event.preventDefault();
		event.stopPropagation();
	};

	/**
	 * A press on a selected video's picture: the player's (a click plays or pauses), until
	 * the pointer moves 6px or more with the button held, when it becomes a move drag.
	 */
	const watchPicture = (view: EditorView, event: MouseEvent, item: MovePress): void => {
		const pressed = { x: event.clientX, y: event.clientY };
		const stop = (): void => {
			view.root.removeEventListener('mousemove', moved as EventListener, true);
			view.root.removeEventListener('mouseup', stop, true);
		};
		const moved = (next: MouseEvent): void => {
			if (next.buttons === 0) {
				stop();
				return;
			}
			if (!leftThePress(pressed.x, pressed.y, next.clientX, next.clientY)) {
				return;
			}
			stop();
			startMove(view, pressed, item, next);
		};
		view.root.addEventListener('mousemove', moved as EventListener, true);
		view.root.addEventListener('mouseup', stop, true);
		stops.push(stop);
	};

	return new Plugin({
		key: new PluginKey('noteworthyPointer'),
		props: {
			createSelectionBetween(view) {
				if (drag === null || drag.head === null || drag.anchor === null) {
					return null;
				}
				return selectionBetween(view.state.doc, drag.anchor, drag.head);
			},
			handleDrop(view, event) {
				const current = press;
				if (current === null || !withinClick(current.x, current.y, event.clientX, event.clientY)) {
					return false;
				}
				press = null;
				placeCaret(view, event.clientX, event.clientY);
				return true;
			},
			handleDOMEvents: {
				mousedown(view, event) {
					stopAll();
					press = null;
					drag = null;
					const item = itemUnder(view, event.target);
					if (item?.kind === 'control') {
						return false;
					}
					if (item !== null) {
						// See A PRESS ON AN ITEM above. ProseMirror is kept out (it would
						// select the item, or start dragging it), and so is the browser.
						if (event.button === 0) {
							event.preventDefault();
							view.focus();
							startDrag(view, event, item.pos, item);
						}
						return true;
					}
					if (event.button !== 0 || event.detail > 1) {
						return false;
					}
					const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
					if (at === null) {
						return false;
					}
					const inside = !event.shiftKey && insideSelection(view.state, at.pos);
					if (inside) {
						startPress(view, event);
					}
					if (!inside || onSelectionEdge(view.state, at.pos)) {
						startDrag(view, event, at.pos);
					}
					return false;
				},
				dragstart(view, event) {
					// See MOVING A SELECTED ITEM above: never the browser's drag of a selected
					// item. A selected node's figure is `draggable` (ProseMirror's own
					// `selectNode`), and the page's selection holds it, so a press on a
					// selected video's picture started one (Chromium, Firefox), and a long
					// press can on a phone. A selection of text is the browser's, as ever.
					// Refused, the press goes on as a press: one on a video's picture is
					// still being watched (A VIDEO'S PICTURE), so nothing is stopped.
					const { selection } = view.state;
					const figure =
						selection instanceof NodeSelection && isMediaNode(selection.node)
							? view.nodeDOM(selection.from)
							: null;
					if (figure !== null && event.target instanceof Node && figure.contains(event.target)) {
						event.preventDefault();
						return true;
					}
					// The browser takes the release over: no `mouseup` will come.
					stopAll();
					return false;
				},
				dragend() {
					press = null;
					return false;
				}
			}
		},
		view(view) {
			const document = view.dom.ownerDocument;
			// See MOVING A SELECTED ITEM above. Read from the press's own `pointerdown`,
			// which comes first: a mouse (a touchpad is one) and nothing else.
			let pointerType: string | null = null;
			const pointerDown = (event: PointerEvent): void => {
				pointerType = event.pointerType;
			};
			// In the capture phase, before the item's own buttons (the collapsed row keeps
			// its press from ProseMirror) and before ProseMirror, which then stays out.
			// A second or third press of a run too (QUICK PRESSES): until it moves 6px it
			// is what it was.
			const pressMove = (event: MouseEvent): void => {
				if (event.button !== 0 || event.shiftKey || pointerType !== 'mouse' || !view.editable) {
					return;
				}
				const item = selectedItemUnder(view, event.target) ?? buttonItemUnder(view, event.target);
				if (item === null) {
					// A VIDEO'S PICTURE: left to the player (no `preventDefault`) until it moves.
					const picture = selectedPictureUnder(view, event.target, event.clientY);
					if (picture !== null) {
						stopAll();
						press = null;
						drag = null;
						watchPicture(view, event, picture);
					}
					return;
				}
				stopAll();
				press = null;
				drag = null;
				event.preventDefault();
				if (item.unselected !== true) {
					view.focus();
				}
				// An item not selected: its button's press as before (focus stays where it
				// is) until it is dragged, and focused once it lands (ANY ITEM BY ITS BUTTONS).
				startMove(view, { x: event.clientX, y: event.clientY }, item);
			};
			// See A LONG PRESS ON ⌃ above.
			let hold: Hold | null = null;
			const letGo = (): void => {
				if (hold !== null) {
					clearTimeout(hold.timer);
					hold = null;
				}
			};
			const holdStart = (event: TouchEvent): void => {
				letGo();
				const target = event.target;
				const button = target instanceof Element ? target.closest(HOLD_BUTTON) : null;
				const finger = event.changedTouches[0];
				if (
					button === null ||
					event.touches.length !== 1 ||
					finger === undefined ||
					!view.editable
				) {
					return;
				}
				const current: Hold = {
					finger: finger.identifier,
					at: { x: finger.clientX, y: finger.clientY },
					button,
					picked: false,
					timer: setTimeout(() => pickUp(current), HOLD_MS)
				};
				hold = current;
			};
			const pickUp = (current: Hold): void => {
				if (hold !== current || view.isDestroyed || !current.button.isConnected) {
					letGo();
					return;
				}
				const { selection } = view.state;
				const found = buttonItemUnder(view, current.button);
				if (found === null) {
					letGo();
					return;
				}
				const item =
					selection instanceof NodeSelection && selection.from === found.pos
						? { ...found, unselected: false }
						: found;
				current.picked = true;
				stopAll();
				press = null;
				drag = null;
				current.button.closest('figure')?.classList.add(LIFTED_CLASS);
				buzz(document.defaultView?.navigator ?? null);
				startMove(view, current.at, item, null, current.finger);
			};
			/** Before the pick-up, a finger that moves past the slop is scrolling the page. */
			const holdMove = (event: TouchEvent): void => {
				if (hold === null || hold.picked) {
					return;
				}
				for (const one of Array.from(event.changedTouches)) {
					if (
						one.identifier === hold.finger &&
						Math.hypot(one.clientX - hold.at.x, one.clientY - hold.at.y) > HOLD_SLOP_PX
					) {
						letGo();
						return;
					}
				}
			};
			const holdEnd = (event: TouchEvent): void => {
				const current = hold;
				if (
					current !== null &&
					Array.from(event.changedTouches).some((one) => one.identifier === current.finger)
				) {
					letGo();
				}
			};
			/** The page moved under a finger that has not picked anything up: it is scrolling. */
			const holdScrolled = (): void => {
				if (hold !== null && !hold.picked) {
					letGo();
				}
			};
			/** Android's own menu (and selection) at a long press, on the held button only, while held. */
			const noMenu = (event: Event): void => {
				if (hold !== null && event.target instanceof Node && hold.button.contains(event.target)) {
					event.preventDefault();
				}
			};
			view.dom.addEventListener('touchstart', holdStart, { capture: true, passive: true });
			document.addEventListener('touchmove', holdMove, { capture: true, passive: true });
			document.addEventListener('touchend', holdEnd, true);
			document.addEventListener('touchcancel', holdEnd, true);
			document.addEventListener('contextmenu', noMenu, true);
			document.defaultView?.addEventListener('scroll', holdScrolled, { passive: true });
			document.addEventListener('pointerdown', pointerDown, true);
			view.dom.addEventListener('mousedown', pressMove, true);
			// See A CLICK ON THE PAGE BACKGROUND above.
			const background = (event: MouseEvent): void => {
				const { target } = event;
				if (
					event.button !== 0 ||
					!(target instanceof Element) ||
					view.dom.contains(target) ||
					keepsSelection(target)
				) {
					return;
				}
				// After the browser's own answer to the press.
				setTimeout(() => {
					const { selection, doc } = view.state;
					if (
						view.isDestroyed ||
						selection.empty ||
						selection instanceof NodeSelection ||
						view.hasFocus() ||
						browserSelectionHere(view) ||
						!(document.activeElement === null || document.activeElement === document.body)
					) {
						return;
					}
					view.dispatch(
						view.state.tr.setSelection(caretAt(doc, selection.head)).setMeta('pointer', true)
					);
				});
			};
			document.addEventListener('mousedown', background, true);
			return {
				destroy() {
					stopAll();
					letGo();
					view.dom.removeEventListener('touchstart', holdStart, true);
					document.removeEventListener('touchmove', holdMove, true);
					document.removeEventListener('touchend', holdEnd, true);
					document.removeEventListener('touchcancel', holdEnd, true);
					document.removeEventListener('contextmenu', noMenu, true);
					document.defaultView?.removeEventListener('scroll', holdScrolled);
					document.removeEventListener('pointerdown', pointerDown, true);
					view.dom.removeEventListener('mousedown', pressMove, true);
					document.removeEventListener('mousedown', background, true);
				}
			};
		}
	});
}

/** For the editor's extension list. Holds no schema. */
export function pointerSelectionExtension(): Extension {
	return Extension.create({
		name: 'noteworthyPointerSelection',
		addProseMirrorPlugins() {
			return [pointerPlugin()];
		}
	});
}
