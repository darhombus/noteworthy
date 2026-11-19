/**
 * The `image` node: a photo in an entry, by its storage path.
 *
 * Only reached through `editor.ts`, and so only in the browser. The node's
 * vocabulary — `path`, `width`, `height`, and nothing else — is written down for
 * the server in `document.ts`, and `document.test.ts` fails if the two drift.
 * That file also says why the path has its own attribute and there is no `src`.
 *
 * ---------------------------------------------------------------------------
 * THE VIEW
 * ---------------------------------------------------------------------------
 * The document holds a path; the `<img>` needs a URL. The view asks the page's
 * `MediaLinks` for one and subscribes, so a refreshed link arrives as a new
 * `src` on the element and nothing more. ProseMirror is told to ignore every
 * mutation inside the view (`ignoreMutation`), which is what keeps that change
 * from being read back as an edit: no transaction, no autosave, no undo step.
 *
 * The photo is an atom: it is selected and deleted whole, and deleting it
 * is undoable like any other edit. It is not draggable (since 2026-11-06): a
 * press on it starts a selection, as on a video or audio item
 * (`./pointer-selection`, A PRESS ON AN ITEM). Once selected (its ring), a press
 * on it and a drag moves it (MOVING A SELECTED ITEM there), as do
 * Alt+Shift+Up/Down; see docs/constraints.md, "Photos in entries". The file itself is not touched — undo has to
 * be able to bring it back — and one no entry refers to any more is cleared
 * later by a scheduled job.
 *
 * ---------------------------------------------------------------------------
 * COLLAPSING
 * ---------------------------------------------------------------------------
 * The figure holds a button in its corner that collapses the photo to a row,
 * and the row, which expands it again (`createFold` in `./collapse`). Whether
 * it is collapsed arrives as a decoration, never as an attribute: see NOTHING
 * IS STORED there. The row's thumbnail is the photo's own link, so it costs
 * nothing the photo had not already fetched. A collapsed photo is still the
 * same atom — arrowed onto, selected, deleted and undone like any other block.
 *
 * ---------------------------------------------------------------------------
 * PASTE
 * ---------------------------------------------------------------------------
 * ProseMirror copies a selection as HTML, through `renderHTML`, and pastes by
 * parsing HTML, through `parseHTML`. The one rule here matches only what
 * `renderHTML` writes: a `<figure>` carrying `data-media-path`, holding a path in
 * the writer's own folder. So a photo copied from one entry pastes into another,
 * and an `<img src="https://…">` copied from a web page matches nothing and is
 * dropped — a link to somebody else's server is not a photo in this journal.
 */
import { mergeAttributes, Node } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { MEDIA_RATIO_PROPERTY, mediaRatio } from '$lib/media/collapsed';
import type { LinkState, MediaLinks } from '$lib/media/links';
import { hasExtensionFor, isMediaPath } from '$lib/media/paths';
import type { MediaKind } from '$lib/media/types';
import { collapsedIn, createFold, toggleMediaCollapsed } from './collapse';
import { isOwnPathFor, MAX_DIMENSION } from './document';

export type ImageNodeOptions = {
	/** The page's links. Absent when the extension only builds a schema. */
	links: MediaLinks | null;
	/** Whose folder a pasted photo must be in. Absent when only building a schema. */
	owner: string | null;
};

/** A figure's stored pixel size attribute, or `null`. Shared with the player nodes. */
export function dimensionOf(element: HTMLElement, name: string): number | null {
	const value = Number(element.getAttribute(name));
	return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION ? value : null;
}

/** Whether a pasted figure's path is one this writer may put in an entry as `kind`. */
export function acceptsPastedPath(
	path: string | null,
	owner: string | null,
	kind: MediaKind = 'image'
): boolean {
	if (path === null) {
		return false;
	}
	return owner === null
		? isMediaPath(path) && hasExtensionFor(path, kind)
		: isOwnPathFor(kind, path, owner);
}

export const ImageNode = Node.create<ImageNodeOptions>({
	name: 'image',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: false,

	addOptions() {
		return { links: null, owner: null };
	},

	addAttributes() {
		return {
			path: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-media-path'),
				renderHTML: (attributes) => ({ 'data-media-path': attributes.path })
			},
			width: {
				default: null,
				parseHTML: (element) => dimensionOf(element, 'data-width'),
				renderHTML: (attributes) =>
					attributes.width === null ? {} : { 'data-width': attributes.width }
			},
			height: {
				default: null,
				parseHTML: (element) => dimensionOf(element, 'data-height'),
				renderHTML: (attributes) =>
					attributes.height === null ? {} : { 'data-height': attributes.height }
			}
		};
	},

	parseHTML() {
		const owner = this.options.owner;
		return [
			{
				tag: 'figure[data-media-path]',
				getAttrs: (element) =>
					acceptsPastedPath(element.getAttribute('data-media-path'), owner) ? null : false
			}
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['figure', mergeAttributes({ class: 'entry-media' }, HTMLAttributes)];
	},

	addNodeView() {
		const links = this.options.links;

		return ({ node, view, getPos, decorations }) => {
			const dom = document.createElement('figure');
			dom.className = 'entry-media';
			dom.contentEditable = 'false';

			/** The link the photo is showing, when it has one, for the collapsed row. */
			let thumbnail: string | null = null;

			// See COLLAPSING above.
			const fold = createFold(dom, {
				kind: 'image',
				onToggle: () => {
					const pos = getPos();
					if (pos !== undefined) {
						toggleMediaCollapsed(view, pos);
					}
				},
				thumbnail: () => thumbnail,
				onThumbnailError: (url) => links?.failed(path(), url)
			});

			const image = document.createElement('img');
			image.alt = 'Photo';
			image.loading = 'lazy';
			image.decoding = 'async';
			// The image's own drag would carry its URL out of the page.
			image.draggable = false;

			const pending = document.createElement('div');
			pending.className = 'entry-media-pending';
			pending.setAttribute('aria-hidden', 'true');

			const missing = document.createElement('p');
			missing.className = 'entry-media-missing';
			missing.textContent = 'This photo couldn’t be loaded.';

			let current: ProseMirrorNode = node;
			let shown: string | null = null;
			let unsubscribe: () => void = () => {};

			const size = (): void => {
				const { width, height } = current.attrs as { width: number | null; height: number | null };
				const ratio = mediaRatio(width, height);
				if (width !== null && height !== null && ratio !== null) {
					image.width = width;
					image.height = height;
					pending.style.aspectRatio = `${width} / ${height}`;
					dom.style.setProperty(MEDIA_RATIO_PROPERTY, ratio);
				} else {
					image.removeAttribute('width');
					image.removeAttribute('height');
					pending.style.removeProperty('aspect-ratio');
					dom.style.removeProperty(MEDIA_RATIO_PROPERTY);
				}
			};

			const show = (state: LinkState): void => {
				if (state.status === 'ready') {
					if (shown !== state.url) {
						shown = state.url;
						image.src = state.url;
					}
					fold.body.replaceChildren(image);
				} else if (state.status === 'pending') {
					fold.body.replaceChildren(pending);
				} else {
					fold.body.replaceChildren(missing);
				}
				thumbnail = state.status === 'ready' ? state.url : null;
				fold.refresh();
			};

			const path = (): string => String(current.attrs.path ?? '');

			image.addEventListener('load', () => links?.loaded(path()));
			image.addEventListener('error', () => {
				if (shown !== null) {
					links?.failed(path(), shown);
				}
			});

			const subscribe = (): void => {
				unsubscribe();
				shown = null;
				dom.dataset.mediaPath = path();
				unsubscribe = links === null ? () => {} : links.subscribe(path(), (state) => show(state));
				if (links === null) {
					show({ status: 'missing' });
				}
			};

			size();
			subscribe();
			fold.set(collapsedIn(decorations));

			return {
				dom,
				update: (updated, next) => {
					if (updated.type !== current.type) {
						return false;
					}
					const moved = updated.attrs.path !== current.attrs.path;
					current = updated;
					size();
					if (moved) {
						subscribe();
					}
					fold.set(collapsedIn(next));
					return true;
				},
				// The collapse and expand buttons are this view's own. Left to
				// ProseMirror, a press on one would select the photo instead of
				// pressing the button.
				stopEvent: (event) =>
					event.target instanceof globalThis.Node &&
					fold.controls.some((control) => control.contains(event.target as globalThis.Node)),
				// A refreshed `src`, the swaps between image, pending and missing, and
				// collapsing, are this view's business alone. See THE VIEW above.
				ignoreMutation: () => true,
				destroy: () => unsubscribe()
			};
		};
	}
});
