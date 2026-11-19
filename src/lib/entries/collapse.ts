/**
 * Collapsing media in the editor: which items are collapsed, the controls that
 * collapse and expand them, and keeping the page still while they do.
 *
 * Browser only in practice — reached through `editor.ts` and the node views —
 * though nothing here touches the DOM until a node view is built.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS STORED
 * ---------------------------------------------------------------------------
 * Collapsed is a way of looking at the entry while it is open, not part of the
 * entry. So it is not a node attribute: the document, the sanitiser's
 * vocabulary and the drift test are untouched, autosave has nothing new to send,
 * and an old tab saving the entry cannot lose it — there is nothing to lose.
 * Everything is expanded each time the editor opens.
 *
 * It lives in a plugin instead, as a node decoration on each collapsed item.
 * Decorations are mapped through every change to the document, so a collapsed
 * photo stays collapsed while somebody types above it, and one that is deleted
 * takes its decoration with it. The node views read their decorations, which
 * is how they learn they are collapsed.
 *
 * Collapsing and expanding are transactions with no steps: nothing in the
 * document changes, so TipTap's `update`
 * does not fire, autosave sees nothing, and undo has no step to take back. An
 * item deleted and brought back by undo comes back expanded — it is a new node
 * as far as the decorations are concerned.
 *
 * ---------------------------------------------------------------------------
 * KEEPING THE PAGE STILL
 * ---------------------------------------------------------------------------
 * Collapsing a photo above the caret takes most of a screen out of the page
 * above the line being written, and that line would jump up by as much. The
 * browser's scroll anchoring cannot be relied on to hold it: it picks its own
 * anchor, which need not be the caret's line, and Safari has none. So the thing
 * that must hold still is measured before the change and again after it, and
 * the window is scrolled by the difference, in the same task, before anything
 * is painted:
 *
 *   from the toolbar, the caret's line — when it is on screen. Somebody who
 *   has scrolled away from their caret is reading, not writing, and is left to
 *   the browser;
 *
 *   from an item's own control, the item — which is where the pointer, or the
 *   focus, is.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
	NodeSelection,
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { collapsedParts, FOLD_ICONS, KIND_NAMES } from '$lib/media/collapsed';
import type { MediaKind } from '$lib/media/types';
import { MEDIA_NODE_TYPES } from './media';

/** A change to what is collapsed: one item, by its position, or every item. */
export type CollapseChange = { kind: 'toggle'; pos: number } | { kind: 'all'; collapsed: boolean };

const collapseKey = new PluginKey<DecorationSet>('noteworthyCollapse');

/** `node` is the item's node, for finding it again when a step puts it back (MOVED). */
type CollapsedSpec = { collapsed: true; node: ProseMirrorNode };

function isMediaNode(node: ProseMirrorNode): boolean {
	return (MEDIA_NODE_TYPES as readonly string[]).includes(node.type.name);
}

/** Every media node in the document, with its position. Text is not walked. */
function mediaNodes(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode }[] {
	const found: { pos: number; node: ProseMirrorNode }[] = [];
	doc.descendants((node, pos) => {
		if (isMediaNode(node)) {
			found.push({ pos, node });
			return false;
		}
		return !node.isTextblock;
	});
	return found;
}

function collapsedDecoration(pos: number, node: ProseMirrorNode): Decoration {
	return Decoration.node(pos, pos + node.nodeSize, {}, {
		collapsed: true,
		node
	} satisfies CollapsedSpec);
}

/**
 * MOVED. A step that takes an item out and puts the same node back elsewhere, as
 * moving blocks does to the block it moves past (and to the moved one on undo), drops
 * its decoration in the mapping. Within that one transaction the node is still in the
 * document, so it is found again and stays collapsed. An item deleted and brought back
 * by a later undo is two transactions, and comes back expanded, as before.
 */
function mapCollapsed(set: DecorationSet, tr: Transaction): DecorationSet {
	const lost: ProseMirrorNode[] = [];
	const mapped = set.map(tr.mapping, tr.doc, {
		onRemove: (spec: Partial<CollapsedSpec>) => {
			if (spec.collapsed === true && spec.node !== undefined) {
				lost.push(spec.node);
			}
		}
	});
	if (lost.length === 0) {
		return mapped;
	}
	const found = mediaNodes(tr.doc).filter(
		({ pos, node }) => lost.includes(node) && decorationAt(mapped, pos).length === 0
	);
	return found.length === 0
		? mapped
		: mapped.add(
				tr.doc,
				found.map(({ pos, node }) => collapsedDecoration(pos, node))
			);
}

/**
 * The decoration on the item that starts at `pos`, if any. `find` returns
 * everything touching the position, which includes an item ending exactly
 * there, so the start is checked too.
 */
function decorationAt(set: DecorationSet, pos: number): Decoration[] {
	return set
		.find(pos, pos, (spec: Partial<CollapsedSpec>) => spec.collapsed === true)
		.filter((decoration) => decoration.from === pos);
}

/** Whether a node view's decorations say it is collapsed. */
export function collapsedIn(decorations: readonly Decoration[]): boolean {
	return decorations.some((decoration) => (decoration.spec as Partial<CollapsedSpec>).collapsed);
}

export type CollapseSummary = { media: number; collapsed: number };

let summarised: { doc: ProseMirrorNode; set: DecorationSet; summary: CollapseSummary } | null =
	null;

/**
 * How many media items there are, and how many are collapsed, for the
 * toolbar's button. Read on every transaction, so the last answer is kept
 * while neither the document nor the collapsed set has changed — which is
 * every caret move.
 */
export function collapseSummary(state: EditorState): CollapseSummary {
	const set = collapseKey.getState(state) ?? DecorationSet.empty;
	if (summarised !== null && summarised.doc === state.doc && summarised.set === set) {
		return summarised.summary;
	}
	const items = mediaNodes(state.doc);
	const summary = {
		media: items.length,
		collapsed: items.filter(({ pos }) => decorationAt(set, pos).length > 0).length
	};
	summarised = { doc: state.doc, set, summary };
	return summary;
}

/** The plugin itself. Exported for `collapse.test.ts`, which runs it without a view. */
export function collapsePlugin(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: collapseKey,
		state: {
			init: () => DecorationSet.empty,
			apply(tr, set) {
				const mapped = tr.docChanged ? mapCollapsed(set, tr) : set;
				const meta = tr.getMeta(collapseKey) as CollapseChange | undefined;
				if (meta === undefined) {
					return mapped;
				}
				if (meta.kind === 'all') {
					return meta.collapsed
						? DecorationSet.create(
								tr.doc,
								mediaNodes(tr.doc).map(({ pos, node }) => collapsedDecoration(pos, node))
							)
						: DecorationSet.empty;
				}
				const node = tr.doc.nodeAt(meta.pos);
				if (node === null || !isMediaNode(node)) {
					return mapped;
				}
				const existing = decorationAt(mapped, meta.pos);
				return existing.length > 0
					? mapped.remove(existing)
					: mapped.add(tr.doc, [collapsedDecoration(meta.pos, node)]);
			}
		},
		props: {
			decorations: (state) => collapseKey.getState(state)
		}
	});
}

/** The plugin, for the editor's extension list. Holds no schema. */
export function collapseExtension(): Extension {
	return Extension.create({
		name: 'noteworthyCollapse',
		addProseMirrorPlugins() {
			return [collapsePlugin()];
		}
	});
}

/**
 * A change to what is collapsed, as a transaction. Not an edit: it has no steps,
 * and ProseMirror's history records nothing for a transaction without steps —
 * `collapse.test.ts` holds the undo depth to that, so no `addToHistory` is set.
 */
export function collapseTransaction(state: EditorState, change: CollapseChange): Transaction {
	return state.tr.setMeta(collapseKey, change);
}

/** Whether the item at `pos` is collapsed. */
export function isCollapsedAt(state: EditorState, pos: number): boolean {
	return decorationAt(collapseKey.getState(state) ?? DecorationSet.empty, pos).length > 0;
}

function send(view: EditorView, change: CollapseChange): void {
	view.dispatch(collapseTransaction(view.state, change));
}

/**
 * Runs `change`, then scrolls the window so that whatever `measure` measures
 * is where it was. `measure` returning `null` beforehand means there is
 * nothing to hold, and the page is left to the browser.
 */
function holdStill(measure: () => number | null, change: () => void): void {
	const before = measure();
	change();
	if (before === null) {
		return;
	}
	const after = measure();
	if (after !== null && Math.abs(after - before) >= 0.5) {
		window.scrollBy({ top: after - before, behavior: 'instant' });
	}
}

function windowHeight(): number {
	return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * The caret's line on screen. A selected item counts as the caret's line,
 * measured from its start: its end moves when it collapses.
 */
function caretLine(view: EditorView): { top: number; bottom: number } {
	const { selection } = view.state;
	const pos = selection instanceof NodeSelection ? selection.from : selection.head;
	return view.coordsAtPos(pos);
}

/**
 * Collapses or expands every media item, holding the caret's line where it is
 * on screen. See KEEPING THE PAGE STILL.
 */
export function setAllMediaCollapsed(view: EditorView, collapsed: boolean): void {
	const caret = caretLine(view);
	const onScreen = caret.bottom > 0 && caret.top < windowHeight();
	holdStill(
		() => (onScreen ? caretLine(view).top : null),
		() => send(view, { kind: 'all', collapsed })
	);
}

/** Collapses or expands one item, holding it where it is on screen. */
export function toggleMediaCollapsed(view: EditorView, pos: number): void {
	const node = view.state.doc.nodeAt(pos);
	if (node === null || !isMediaNode(node)) {
		return;
	}
	holdStill(
		() => {
			const dom = view.nodeDOM(pos);
			return dom instanceof HTMLElement ? dom.getBoundingClientRect().top : null;
		},
		() => send(view, { kind: 'toggle', pos })
	);
}

// ---------------------------------------------------------------------------
// The controls
// ---------------------------------------------------------------------------

const SVG = 'http://www.w3.org/2000/svg';

/** The paths live in `$lib/media/collapsed`, so the edit page can draw them before this module loads. */
const ICONS = FOLD_ICONS;

function icon(paths: readonly string[], className: string): SVGSVGElement {
	const svg = document.createElementNS(SVG, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '1.75');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('class', className);
	for (const d of paths) {
		const path = document.createElementNS(SVG, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}

/**
 * Keys pressed on one of these buttons that would type, or delete, if they
 * reached the text around them. WebKit takes such a key on a focused element
 * inside the editor as typing into the entry, as it does on a player (see
 * TYPING INSIDE THE EDITOR in `$lib/media/player`). Enter and Space press the
 * button, and everything else — Tab, the arrows — carries on as it would.
 */
function swallowTyping(event: KeyboardEvent): void {
	if (event.ctrlKey || event.metaKey || event.altKey || event.key === ' ') {
		return;
	}
	if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') {
		event.preventDefault();
		event.stopPropagation();
	}
}

function controlButton(className: string, onPress: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	// Inside the entry's <form>: a button with no type submits it.
	button.type = 'button';
	button.className = className;
	// A click leaves focus, and the caret, in the text — as the toolbar's
	// buttons do. The keyboard still reaches these by Tab.
	button.addEventListener('mousedown', (event) => event.preventDefault());
	button.addEventListener('keydown', swallowTyping);
	button.addEventListener('click', onPress);
	return button;
}

/**
 * On a figure while its item is picked up by a long press on its corner button or
 * its collapsed row (`$lib/entries/pointer-selection`, A LONG PRESS ON ⌃): drawn with
 * the ring a selected item has (`layout.css`), and the finger's moves are its, not
 * the page's.
 */
export const LIFTED_CLASS = 'entry-media-lifted';

/**
 * A finger's move that started on the corner button or the collapsed row scrolls the
 * page, as anywhere, until the item is picked up; from then on it moves the item, so
 * it is prevented. Not passive, and on the buttons from the start: whether the browser
 * waits for the page before scrolling is decided when the finger lands, by what
 * listens where it lands. Only the buttons, so a scroll that starts anywhere else
 * never waits.
 */
function holdTheFinger(event: TouchEvent): void {
	const button = event.currentTarget;
	if (
		button instanceof Element &&
		button.closest(`.${LIFTED_CLASS}`) !== null &&
		event.cancelable
	) {
		event.preventDefault();
	}
}

export type Fold = {
	/** Where the node view puts the photo or player. Hidden while collapsed. */
	body: HTMLElement;
	/** The buttons, for the node view's `stopEvent`. */
	controls: readonly HTMLElement[];
	set: (collapsed: boolean) => void;
	/** Redraws the row: a length has arrived, or the photo's link has changed. */
	refresh: () => void;
};

/**
 * The controls around one item, built into its figure: a button in the corner
 * of the expanded item that collapses it, and the row that stands in for it
 * while collapsed, which expands it.
 *
 * The row is a real button with `aria-expanded="false"`, named by what it
 * shows — "Photo", "Video, 0:42", the "·" the eye gets being a pause for a
 * screen reader — and the corner one has `aria-expanded="true"`. Only one of
 * the two is ever shown. Focus follows the change when it was on the item:
 * collapsing moves it to the row; expanding moves it to the player, whose keys
 * then work at once, or for a photo — which has nothing else to focus — to the
 * corner button. The corner button comes after the player in the DOM, so Tab
 * from the text still reaches the player first, as it always has
 * (`e2e/entry-media.e2e.ts`). A click leaves focus in the text.
 *
 * The row's words are written only while it is collapsed, and its name is an
 * attribute. They are text nodes inside the editor's element, and while an
 * item is expanded nothing on screen should add words to what the page holds
 * between one paragraph and the next — for anything that reads the editor's
 * text off the page, the specs' caret placement included.
 */
export function createFold(
	figure: HTMLElement,
	options: {
		kind: MediaKind;
		onToggle: () => void;
		/** The player's length, if it has reported one. */
		duration?: () => number | null;
		/** The photo's current link, for the thumbnail. */
		thumbnail?: () => string | null;
		onThumbnailError?: (url: string) => void;
		/** Called as the item collapses: a player stops, its controls going with it. */
		onCollapse?: () => void;
		/** Where focus goes when the item is expanded from its row: the player. */
		expandFocus?: () => HTMLElement | null;
	}
): Fold {
	const noun = KIND_NAMES[options.kind].toLowerCase();

	const collapse = controlButton('entry-media-collapse', options.onToggle);
	collapse.setAttribute('aria-expanded', 'true');
	collapse.setAttribute('aria-label', `Collapse ${noun}`);
	collapse.title = `Collapse ${noun}`;
	collapse.append(icon(ICONS.collapse, 'entry-media-collapse-icon'));
	collapse.addEventListener('touchmove', holdTheFinger, { passive: false });

	const body = document.createElement('div');
	body.className = 'entry-media-body';

	const row = controlButton('entry-media-row', options.onToggle);
	row.addEventListener('touchmove', holdTheFinger, { passive: false });
	row.setAttribute('aria-expanded', 'false');
	row.title = 'Expand';
	row.hidden = true;

	const badge = document.createElement('span');
	badge.className = 'entry-media-row-badge';
	const kindIcon = icon(ICONS[options.kind], 'entry-media-row-icon');
	const thumb = document.createElement('img');
	thumb.className = 'entry-media-thumb';
	thumb.alt = '';
	thumb.loading = 'lazy';
	thumb.decoding = 'async';
	thumb.draggable = false;
	thumb.addEventListener('error', () => {
		const url = thumb.getAttribute('src');
		badge.replaceChildren(kindIcon);
		if (url !== null) {
			options.onThumbnailError?.(url);
		}
	});

	const label = document.createElement('span');
	label.className = 'entry-media-row-label';
	const length = document.createElement('span');
	length.className = 'entry-media-row-length';

	row.append(badge, label, icon(ICONS.expand, 'entry-media-row-chevron'));
	figure.classList.add('entry-media-foldable');
	figure.append(body, collapse, row);

	let collapsed = false;

	const refresh = (): void => {
		if (!collapsed) {
			label.replaceChildren();
			return;
		}
		const parts = collapsedParts(options.kind, options.duration?.() ?? null);
		if (parts.length === null) {
			row.setAttribute('aria-label', parts.name);
			label.replaceChildren(parts.name);
		} else {
			row.setAttribute('aria-label', `${parts.name}, ${parts.length}`);
			length.textContent = parts.length;
			label.replaceChildren(`${parts.name} · `, length);
		}
		const url = options.thumbnail?.() ?? null;
		if (url === null) {
			thumb.removeAttribute('src');
			badge.replaceChildren(kindIcon);
		} else if (thumb.getAttribute('src') !== url || !badge.contains(thumb)) {
			thumb.src = url;
			badge.replaceChildren(thumb);
		}
	};

	const set = (next: boolean): void => {
		if (next === collapsed) {
			return;
		}
		const active = figure.ownerDocument.activeElement;
		const focusInside = active !== null && figure.contains(active);
		collapsed = next;
		if (next) {
			options.onCollapse?.();
		}
		refresh();
		body.hidden = next;
		collapse.hidden = next;
		row.hidden = !next;
		figure.classList.toggle('entry-media-collapsed', next);
		if (focusInside) {
			const target = next ? row : (options.expandFocus?.() ?? collapse);
			(target.isConnected && !target.closest('[hidden]') ? target : collapse).focus({
				preventScroll: true
			});
		}
	};

	refresh();

	return { body, controls: [collapse, row], set, refresh };
}
