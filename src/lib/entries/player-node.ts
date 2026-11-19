/**
 * The `video` and `audio` nodes: a video or audio file in an entry, by its
 * storage path, played by the browser's own player.
 *
 * Only reached through `editor.ts`, and so only in the browser. Their
 * vocabulary — `path`, plus `width` and `height` for a video — is written down
 * for the server in `document.ts`, and `document.test.ts` fails if the two
 * drift. That file also says why these are two node types and not a kind on
 * one, and why the path has its own attribute.
 *
 * ---------------------------------------------------------------------------
 * THE VIEW, AND WHY PROSEMIRROR IS TOLD TO KEEP OUT OF IT
 * ---------------------------------------------------------------------------
 * The view is a `<figure>` holding a `<video>` or `<audio>` with `controls`,
 * given its link by the page's `MediaLinks` exactly as a photo is — a refresh is
 * a new source on the element, and `ignoreMutation` keeps that from being read
 * as an edit. `$lib/media/player` decides when a fresh link can go in without
 * interrupting playback, and supplies the keys.
 *
 * `stopEvent` answers yes for every event from inside the player and the
 * collapse controls. Without it ProseMirror would take a click on the player as
 * a click on the node and select it, and would take keys pressed while the
 * player has focus as editing keys: Backspace would delete the video somebody
 * was listening to. With it, the player is the player's, and the node is
 * selected and deleted the way any block is from the text around it — arrow
 * onto it, press Backspace. The rest of the figure (the blank space beside a
 * portrait video, the strip beside the audio player) is not claimed: a press
 * there is a press beside the item (`./pointer-selection`, A PRESS ON AN ITEM).
 * Until 2026-11-06 the whole figure was, and a click there reached nothing.
 *
 * Neither node is draggable, nor a photo. Dragging on a player is how its
 * timeline and volume are moved, and a draggable node would turn that gesture into
 * picking up the whole video. Until PRD 16 a *selected* video still could be, by
 * the browser's own drag from its picture (a selected node's figure is `draggable`
 * by ProseMirror's `selectNode`, and the page's selection holds it); that drag is
 * now refused (`./pointer-selection`, `dragstart`). A selected item of any kind
 * moves by the editor's own drag, pressed anywhere on it but the player and the
 * corner button (MOVING A SELECTED ITEM there), or by Alt+Shift+Up/Down.
 *
 * `preload="metadata"`: the player shows its length and first frame and fetches
 * nothing more until somebody plays it. Signed links are rarely cached, and the
 * free tier's bandwidth is 5 GB a month.
 *
 * ---------------------------------------------------------------------------
 * COLLAPSING
 * ---------------------------------------------------------------------------
 * As for a photo (`./image-node`), with two differences. The row shows an icon,
 * never a frame — pulling one would download part of the file — and a length
 * only once the player has read it from the metadata it loads anyway. And the
 * player is paused as it collapses: its controls go with it, and sound nobody
 * can see the source of is sound nobody can stop. The element itself stays in
 * the figure, hidden, so its link, its position and its keys are kept for when
 * it is expanded; hidden, it cannot have focus, so the player keys (`bindPlayerKeys`)
 * reach only an expanded player.
 *
 * ---------------------------------------------------------------------------
 * KEPT THROUGH A MOVE
 * ---------------------------------------------------------------------------
 * ProseMirror builds a new view for an item that ends up after the block it
 * swapped with, by keys, a drag, undo or redo (`./player-identity` has why). A new
 * view used to mean a new `<video>` or `<audio>`: back at the start, paused, its
 * file loaded again, with the spinner. So the element, its link and its listeners
 * are a `Player` of their own, kept per item (the number `./player-identity`
 * gives each video and audio node), and a view draws whichever player its item
 * has:
 *
 *   a view that goes lets its player go (`release`) without stopping it. A view
 *   built for the same item in the same redraw takes it over and moves the element
 *   into its own figure. ProseMirror builds and destroys views in one synchronous
 *   pass, sometimes the new one first (it then takes the player from the old one,
 *   whose end then leaves it alone), so the element is back on the page in the same
 *   task, and a media element put back before the task ends neither pauses nor
 *   loads again (measured in all three engines);
 *
 *   a player nobody has taken by the end of that pass (a microtask later: the
 *   redraw is synchronous) is stopped and let go, as a view's player always was.
 *
 * ONLY ONCE IT HAS READ. A player is taken over only once its element has read its
 * file (`readyState` 1 or more). Before that it has no place in the file to keep,
 * and a new one costs nothing anybody sees. It is also what keeps Playwright's
 * WebKit on Windows standing: it decodes no video, its `<video>` never reads, and
 * moving such an element into another figure crashed the page (3 runs in 5 of
 * "dragging up from below a video or audio item", 0 in 4 without the takeover;
 * docs/constraints.md, "Players kept through a move").
 *
 * If anything goes wrong in that — no number (the plugin absent), or a number with
 * no player — the view builds a new player, as before. A view handed a different
 * item by ProseMirror (`update` with another number) refuses it, so that item is
 * drawn afresh and takes its own player.
 *
 * ---------------------------------------------------------------------------
 * EDITOR KEYS FROM INSIDE A PLAYER
 * ---------------------------------------------------------------------------
 * A click on a player's controls leaves focus on the `<video>` or `<audio>` (Firefox
 * and WebKit put it there; Chromium's own buttons take it and `bindPlayerKeys` gives it
 * back). Its keys then never reach the editor's keymap: `stopEvent` claims them, as it
 * must for the player's own. So Alt+Shift+Up/Down (Control+Shift on a Mac) did
 * nothing, though the item kept its ring, and in Chromium they nudged the volume, its
 * player taking any arrow whatever the modifiers; Delete and Backspace were swallowed
 * (TYPING INSIDE THE EDITOR in `$lib/media/player`); Ctrl+Shift+Up/Down did not extend.
 * Measured in all three engines, 2026-11-12 (docs/constraints.md, "The move keys after
 * a click on a player").
 *
 * So a capture `keydown` on the figure, ahead of the player's keys, hands exactly these
 * on (`editorKeyFromPlayer`), each prevented on the way down so Chromium's player stands
 * aside (not stopped: `stopEvent` already keeps it from ProseMirror):
 *
 *   the move keys move the item, selecting it first if it is not the selection (focus in
 *   its player says which item is meant; decided 2026-11-12). Focus stays on
 *   the player: an item that ends up after the block it passed is moved into a new
 *   figure, which drops focus, so it is put back;
 *
 *   Delete and Backspace, while the item is the selection, and off a Mac Ctrl+Shift+
 *   Up/Down, are given to the editor's keymap (`handleKeyDown`, as ProseMirror's own
 *   keydown would), so they do exactly what they do from the editor, and focus goes back
 *   to the editor. With the item not selected they stay the player's.
 *
 * Every other key is the player's as before: Space, the plain arrows (seek, volume), the
 * letters, Enter, Tab; and on a Mac Option+Shift and Cmd+Shift.
 */
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { MEDIA_RATIO_PROPERTY, mediaRatio } from '$lib/media/collapsed';
import type { LinkState } from '$lib/media/links';
import { unplayableMessage } from '$lib/media/messages';
import {
	bindPlayerKeys,
	createPlayerSource,
	fitSoundOnlyVideo,
	type PlayerKind
} from '$lib/media/player';
import { collapsedIn, createFold, toggleMediaCollapsed } from './collapse';
import { acceptsPastedPath, dimensionOf, type ImageNodeOptions } from './image-node';
import { moveBlocks } from './move-blocks';
import { playerItemIn } from './player-identity';
import { editorKeyFromPlayer } from './text-keys';

export type PlayerNodeOptions = ImageNodeOptions;

/** What a player's figure is marked with, so a pasted one is told from a photo. */
export const KIND_ATTRIBUTE = 'data-media-kind';

/** What a node view lends a player: its figure. */
type Host = {
	/** Puts the element, or what stands in for it, where the link's state says. */
	place: (media: HTMLMediaElement, state: LinkState) => void;
	/** The collapsed row: a length has arrived. */
	refresh: () => void;
	/** The player is leaving this view: its keys come off the figure. */
	release: () => void;
};

/**
 * One item's player: its element, its link and what listens to it, apart from the
 * view drawing it, so that a view built for the same item can take it over
 * (KEPT THROUGH A MOVE).
 */
type Player = {
	kind: PlayerKind;
	item: number | null;
	media: HTMLMediaElement;
	/** The view drawing it, or `null` between one view's end and the next's start. */
	host: Host | null;
	path: string | null;
	/** The link's last state, for a view that takes the player over. */
	state: LinkState | null;
	subscribe: (path: string) => void;
	destroy: () => void;
};

/** Each editor's players, by item. */
const editorPlayers = new WeakMap<object, Map<number, Player>>();

function playersOf(view: object): Map<number, Player> {
	let players = editorPlayers.get(view);
	if (players === undefined) {
		players = new Map();
		editorPlayers.set(view, players);
	}
	return players;
}

function createPlayer(
	kind: PlayerKind,
	links: PlayerNodeOptions['links'],
	item: number | null
): Player {
	const media = document.createElement(kind);
	media.controls = true;
	media.preload = 'metadata';
	// Focusable by click and by Tab in every engine; WebKit does not make
	// a media element focusable on its own.
	media.tabIndex = 0;
	media.setAttribute('aria-label', kind === 'video' ? 'Video' : 'Audio');

	let unsubscribe: () => void = () => {};
	let source = createPlayerSource(media, { loaded: () => {}, failed: () => {} });
	let destroyed = false;

	const player: Player = {
		kind,
		item,
		media,
		host: null,
		path: null,
		state: null,
		subscribe: (path) => {
			unsubscribe();
			source.destroy();
			media.removeAttribute('src');
			player.path = path;
			player.state = null;
			source = createPlayerSource(media, {
				loaded: () => links?.loaded(path),
				failed: (url) => links?.failed(path, url)
			});
			unsubscribe = links === null ? () => {} : links.subscribe(path, show);
			if (links === null) {
				show({ status: 'missing' });
			}
		},
		destroy: () => {
			if (destroyed) {
				return;
			}
			destroyed = true;
			unsubscribe();
			source.destroy();
			unfit();
			media.removeEventListener('loadedmetadata', refreshRow);
			media.removeEventListener('durationchange', refreshRow);
			media.pause();
			media.removeAttribute('src');
			media.load();
		}
	};

	function show(state: LinkState): void {
		player.state = state;
		if (state.status === 'ready') {
			source.set(state.url);
		} else if (state.status !== 'pending') {
			media.pause();
		}
		player.host?.place(media, state);
	}

	const refreshRow = (): void => player.host?.refresh();
	media.addEventListener('loadedmetadata', refreshRow);
	media.addEventListener('durationchange', refreshRow);
	const unfit = media instanceof HTMLVideoElement ? fitSoundOnlyVideo(media) : () => {};

	return player;
}

/**
 * A view has let its player go. Another view may take it in the same redraw (a
 * moved item: KEPT THROUGH A MOVE); if none has by the time the redraw is over, it
 * is stopped and let go, as every player was when its view went.
 */
function release(view: object, player: Player): void {
	player.host = null;
	const end = (): void => {
		if (player.host !== null) {
			return;
		}
		const players = editorPlayers.get(view);
		if (player.item !== null && players?.get(player.item) === player) {
			players.delete(player.item);
		}
		player.destroy();
	};
	if (player.item === null) {
		end();
	} else {
		queueMicrotask(end);
	}
}

function playerNode(kind: PlayerKind) {
	const sized = kind === 'video';

	return Node.create<PlayerNodeOptions>({
		name: kind,
		group: 'block',
		atom: true,
		selectable: true,
		draggable: false,

		addOptions() {
			return { links: null, owner: null };
		},

		addAttributes() {
			const path = {
				default: null,
				parseHTML: (element: HTMLElement) => element.getAttribute('data-media-path'),
				renderHTML: (attributes: Record<string, unknown>) => ({
					'data-media-path': attributes.path
				})
			};
			if (!sized) {
				return { path };
			}
			const size = (name: 'width' | 'height') => ({
				default: null,
				parseHTML: (element: HTMLElement) => dimensionOf(element, `data-${name}`),
				renderHTML: (attributes: Record<string, unknown>) =>
					attributes[name] === null ? {} : { [`data-${name}`]: attributes[name] }
			});
			return { path, width: size('width'), height: size('height') };
		},

		parseHTML() {
			const owner = this.options.owner;
			return [
				{
					tag: `figure[data-media-path][${KIND_ATTRIBUTE}="${kind}"]`,
					// Ahead of the photo's rule, which matches any figure with a path.
					priority: 60,
					getAttrs: (element) =>
						acceptsPastedPath(element.getAttribute('data-media-path'), owner, kind) ? null : false
				}
			];
		},

		renderHTML({ HTMLAttributes }) {
			return [
				'figure',
				mergeAttributes({ class: 'entry-media', [KIND_ATTRIBUTE]: kind }, HTMLAttributes)
			];
		},

		addNodeView() {
			const links = this.options.links;

			return ({ node, view, getPos, decorations }) => {
				const dom = document.createElement('figure');
				dom.className = 'entry-media';
				dom.contentEditable = 'false';
				dom.setAttribute(KIND_ATTRIBUTE, kind);

				/** The player this view draws. Another view may take it (KEPT THROUGH A MOVE). */
				let player: Player | null = null;
				let unbindKeys: () => void = () => {};

				// See COLLAPSING above.
				const fold = createFold(dom, {
					kind,
					onToggle: () => {
						const pos = getPos();
						if (pos !== undefined) {
							toggleMediaCollapsed(view, pos);
						}
					},
					duration: () =>
						player !== null && player.media.readyState >= 1 ? player.media.duration : null,
					onCollapse: () => player?.media.pause(),
					// Once it is on the page: a missing file has no player to focus.
					expandFocus: () =>
						player === null || player.media.parentNode === null ? null : player.media
				});

				const pending = document.createElement('div');
				pending.className = 'entry-media-pending';
				pending.setAttribute('aria-hidden', 'true');

				const missing = document.createElement('p');
				missing.className = 'entry-media-missing';
				missing.textContent = unplayableMessage(kind);

				let current: ProseMirrorNode = node;
				// A view is for one item: `update` refuses another (KEPT THROUGH A MOVE).
				const item = playerItemIn(decorations);

				const path = (): string => String(current.attrs.path ?? '');

				const size = (media: HTMLMediaElement): void => {
					if (!(media instanceof HTMLVideoElement)) {
						return;
					}
					const { width, height } = current.attrs as {
						width: number | null;
						height: number | null;
					};
					const ratio = mediaRatio(width, height);
					if (width !== null && height !== null && ratio !== null) {
						media.width = width;
						media.height = height;
						pending.style.aspectRatio = `${width} / ${height}`;
						dom.style.setProperty(MEDIA_RATIO_PROPERTY, ratio);
					} else {
						media.removeAttribute('width');
						media.removeAttribute('height');
						pending.style.removeProperty('aspect-ratio');
						dom.style.removeProperty(MEDIA_RATIO_PROPERTY);
					}
				};

				const host: Host = {
					place: (media, state) => {
						if (state.status === 'ready') {
							// Kept in the figure rather than rebuilt, so a refresh never
							// replaces the element somebody is listening to.
							if (media.parentNode !== fold.body) {
								fold.body.replaceChildren(media);
							}
						} else if (state.status === 'pending') {
							// Audio waits as its own player, controls greyed out, at the height
							// the browser draws it — so nothing moves when the link arrives. A
							// video waits as a grey box of its own shape.
							if (media.getAttribute('src') === null) {
								fold.body.replaceChildren(kind === 'audio' ? media : pending);
							}
						} else {
							fold.body.replaceChildren(missing);
						}
						fold.refresh();
					},
					refresh: () => fold.refresh(),
					release: () => {
						unbindKeys();
						unbindKeys = () => {};
						player = null;
					}
				};

				/** Draws this item's player here: the one it already has, or a new one. */
				const take = (): void => {
					const players = playersOf(view);
					const found = item === null ? undefined : players.get(item);
					let taken: Player;
					if (found !== undefined && found.kind === kind && found.media.readyState >= 1) {
						if (found.host !== null && found.host !== host) {
							// Built before the view it leaves is destroyed, in the same redraw.
							found.host.release();
						}
						taken = found;
					} else {
						// Nothing read yet, so nothing to keep: a new one (ONLY ONCE IT HAS READ).
						if (found !== undefined) {
							found.host?.release();
							found.host = null;
							found.destroy();
						}
						taken = createPlayer(kind, links, item);
						if (item !== null) {
							players.set(item, taken);
						}
					}
					player = taken;
					taken.host = host;
					dom.dataset.mediaPath = path();
					size(taken.media);
					unbindKeys = bindPlayerKeys(dom, taken.media, kind, { editable: true });
					if (taken.path !== path()) {
						taken.subscribe(path());
					} else if (taken.state !== null) {
						host.place(taken.media, taken.state);
					}
				};

				// See EDITOR KEYS FROM INSIDE A PLAYER.
				const onEditorKey = (event: KeyboardEvent): void => {
					const media = player?.media;
					if (
						media === undefined ||
						!(event.target instanceof globalThis.Node) ||
						!media.contains(event.target)
					) {
						return;
					}
					const key = editorKeyFromPlayer(event);
					const pos = getPos();
					if (key === null || pos === undefined) {
						return;
					}
					const { selection } = view.state;
					const selected = selection instanceof NodeSelection && selection.from === pos;
					if (key.take === 'move') {
						event.preventDefault();
						const doc = media.ownerDocument;
						const focused = doc.activeElement === media;
						if (!selected) {
							view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
						}
						moveBlocks(view, key.dir);
						if (focused && media.isConnected && doc.activeElement !== media) {
							media.focus({ preventScroll: true });
						}
						return;
					}
					if (!selected) {
						return;
					}
					event.preventDefault();
					view.someProp('handleKeyDown', (handle) => handle(view, event));
					view.focus();
				};
				dom.addEventListener('keydown', onEditorKey, true);

				// Collapsed first, with no player yet: setting it pauses the player.
				fold.set(collapsedIn(decorations));
				take();

				return {
					dom,
					update: (updated, next) => {
						if (updated.type !== current.type) {
							return false;
						}
						// Another item handed to this view: it is drawn afresh, and keeps
						// its own player that way (KEPT THROUGH A MOVE).
						const nextItem = playerItemIn(next);
						if (nextItem !== item) {
							return false;
						}
						current = updated;
						if (player === null || player.host !== host) {
							host.release();
							take();
						} else {
							dom.dataset.mediaPath = path();
							size(player.media);
							if (player.path !== path()) {
								player.subscribe(path());
							}
						}
						fold.set(collapsedIn(next));
						return true;
					},
					// See THE VIEW above. Drags and drops are the exception: a file
					// dropped onto a player still goes to the upload handler, where
					// otherwise the browser would open it in place of the page.
					stopEvent: (event) =>
						!event.type.startsWith('drag') &&
						event.type !== 'drop' &&
						event.target instanceof globalThis.Node &&
						((player?.media.contains(event.target) ?? false) ||
							fold.controls.some((control) => control.contains(event.target as globalThis.Node))),
					ignoreMutation: () => true,
					destroy: () => {
						dom.removeEventListener('keydown', onEditorKey, true);
						const left = player;
						host.release();
						if (left !== null && left.host === host) {
							release(view, left);
						}
					}
				};
			};
		}
	});
}

export const VideoNode = playerNode('video');
export const AudioNode = playerNode('audio');
