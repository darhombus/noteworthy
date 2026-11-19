/**
 * Files being added to an entry: where they will go, what stands in for them
 * while they upload, and how the photo finally gets into the document.
 *
 * Browser only — reached through `editor.ts`, which `EntryEditor.svelte` imports
 * dynamically.
 *
 * ---------------------------------------------------------------------------
 * A PLACEHOLDER IS NOT IN THE DOCUMENT
 * ---------------------------------------------------------------------------
 * An upload in progress must never be saved into the entry: the file may fail,
 * and half a photo is not something to store, autosave, or undo through. So a
 * placeholder is a ProseMirror *decoration* — a widget the editor draws at a
 * position, which the document does not contain. Nothing about adding, updating
 * or removing one is a document change: `getJSON()` never sees it, autosave
 * never sends it, and undo never steps over it. The photo becomes a node in one
 * transaction, when its file is stored.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE PHOTO GOES, AND WHERE IT STAYS
 * ---------------------------------------------------------------------------
 * A photo is a block, so it goes between blocks: after the paragraph the cursor
 * is in, or before it when the cursor is at its start or the paragraph is empty
 * — which is what makes "new line, add photo" put the photo above the line the
 * cursor is on and leave somewhere to keep typing.
 *
 * The anchor is kept as the position *before that block*, not as the boundary
 * itself, and mapped through every transaction. That is what keeps a photo where
 * it was asked for while somebody carries on writing: typing into the paragraph
 * moves the boundary after it but not the position before it, and pressing Enter
 * at the end of that paragraph makes a new one after it rather than pushing the
 * pending photo down past it.
 *
 * Several files picked at once share an anchor. As each one lands, the rest are
 * re-anchored to just after the photo that just went in, so they keep the order
 * they were picked in.
 */
import type { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Mappable } from '@tiptap/pm/transform';
import {
	NodeSelection,
	Plugin,
	PluginKey,
	type EditorState,
	type Transaction
} from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { MEDIA_RATIO_PROPERTY, mediaRatio } from '$lib/media/collapsed';
import { ImageRefused } from '$lib/media/image';
import { intake, type Intake, type IntakeOptions } from '$lib/media/intake';
import type { MediaKind } from '$lib/media/types';
import { notAddedMessage } from '$lib/media/messages';
import { prepareMedia } from '$lib/media/prepare';
import type { MediaLinks } from '$lib/media/links';
import {
	createUploadQueue,
	type StoredFile,
	type UploadQueue,
	type UploadView
} from '$lib/media/upload-queue';
import { remainingAllowance, storePrepared } from '$lib/media/upload';
import { countMedia } from './media';
import { BLOCK_MOVE_META, movedPosition, type BlockMove } from './move-blocks';

export type Anchor = { pos: number; place: 'before' | 'after' };

type Placeholder = { id: string; anchor: Anchor; seq: number };

type PluginState = { placeholders: Placeholder[] };

type Meta =
	| { kind: 'add'; placeholders: Placeholder[] }
	| { kind: 'remove'; ids: string[] }
	/** One landed: drop it, and move the rest of its group after the new photo. */
	| { kind: 'stored'; id: string; at: number };

const uploadsKey = new PluginKey<PluginState>('noteworthyUploads');

/**
 * The document position a placeholder draws at, and the photo is inserted at:
 * the boundary before or after the block its anchor points into.
 *
 * Works from whatever the anchor mapped to, however the document changed under
 * it — a joined paragraph can leave it inside a textblock, and a deleted one
 * between blocks.
 */
export function boundaryOf(doc: ProseMirrorNode, anchor: Anchor): number {
	const pos = Math.max(0, Math.min(anchor.pos, doc.content.size));
	const $pos = doc.resolve(pos);

	if ($pos.parent.isTextblock && $pos.depth > 0) {
		const start = $pos.before();
		return anchor.place === 'before' ? start : start + $pos.parent.nodeSize;
	}

	const after = $pos.nodeAfter;
	return anchor.place === 'after' && after !== null ? pos + after.nodeSize : pos;
}

/** Where a photo asked for at `pos` should go. See WHERE THE PHOTO GOES above. */
export function anchorAt(doc: ProseMirrorNode, pos: number): Anchor {
	const at = Math.max(0, Math.min(pos, doc.content.size));
	const $pos = doc.resolve(at);
	if ($pos.parent.isTextblock && $pos.depth > 0) {
		const empty = $pos.parent.content.size === 0;
		return { pos: $pos.before(), place: empty || $pos.parentOffset === 0 ? 'before' : 'after' };
	}
	return { pos: at, place: 'before' };
}

/**
 * An anchor carried through a change to the document.
 *
 * `-1` is the whole of it: content inserted at exactly this position belongs
 * *after* the pending photo, not before it. Pressing Enter at the end of the
 * paragraph a photo was asked from makes a new paragraph after that paragraph,
 * and the photo still belongs between them rather than below whatever gets
 * written next.
 *
 * Its own function so the plugin and `uploads.test.ts` cannot disagree about
 * which side the anchor sticks to.
 */
export function mapAnchor(anchor: Anchor, mapping: Mappable): Anchor {
	return { ...anchor, pos: mapping.map(anchor.pos, -1) };
}

/**
 * An anchor carried through a transaction. A move of blocks (`./move-blocks`) puts one
 * of its two runs of blocks back, which mapping cannot follow; its meta says where each
 * position went, so a placeholder stays beside the block it was asked from.
 */
export function carryAnchor(anchor: Anchor, tr: Transaction): Anchor {
	const move = tr.getMeta(BLOCK_MOVE_META) as BlockMove | undefined;
	const pos = move === undefined ? null : movedPosition(move, anchor.pos);
	return pos === null ? mapAnchor(anchor, tr.mapping) : { ...anchor, pos };
}

export function anchorForSelection(state: EditorState): Anchor {
	const { selection } = state;
	// A selected photo: the next one goes after it, not on top of it.
	if (selection instanceof NodeSelection) {
		return { pos: selection.from, place: 'after' };
	}
	return anchorAt(state.doc, selection.from);
}

/**
 * Files on the clipboard worth taking as an upload.
 *
 * A pasted screenshot arrives as a file and nothing else. Pasted *text* from a
 * word processor arrives as text, HTML — and, on Windows, a picture of the text
 * as well, which is not what anybody meant to paste. So files are taken only
 * when there is no text beside them, or when the only text is the file's own
 * name, which is what copying a file in a file manager puts there.
 */
export function pastedFiles(data: DataTransfer | null): File[] {
	const files = [...(data?.files ?? [])];
	if (files.length === 0) {
		return [];
	}
	const text = data?.getData('text/plain')?.trim() ?? '';
	if (text.length > 0 && !files.some((file) => file.name === text)) {
		return [];
	}
	return files;
}

type PlaceholderElement = { dom: HTMLElement; update: (view: UploadView) => void };

/**
 * The box that stands where the photo, video or audio will be. Plain DOM: it
 * lives inside ProseMirror.
 *
 * An audio file's is the height of the audio player it becomes, so nothing
 * moves when it lands. That height is the browser's own, so it is not written
 * down anywhere: the box holds an empty `<audio controls>`, invisible and out
 * of reach, which the browser draws at exactly the size it will draw the real
 * one, and the name and status sit on one line over it. See `.entry-upload-audio`
 * in `layout.css`.
 */
function placeholderElement(
	actions: {
		retry: () => void;
		remove: () => void;
	},
	kind: MediaKind | null
): PlaceholderElement {
	const dom = document.createElement('div');
	dom.className = 'entry-upload';
	dom.contentEditable = 'false';

	const name = document.createElement('p');
	name.className = 'entry-upload-name';

	const message = document.createElement('p');
	message.className = 'entry-upload-status';

	const buttons = document.createElement('div');
	buttons.className = 'entry-upload-actions';

	let line: HTMLElement | null = null;
	if (kind === 'audio') {
		dom.classList.add('entry-upload-audio');
		const sizer = document.createElement('audio');
		sizer.controls = true;
		// Out of reach by `visibility: hidden` and `tabindex`, and not `inert`:
		// Firefox draws an inert `<audio>` as a bare 300×150 box, not its player.
		sizer.tabIndex = -1;
		sizer.setAttribute('aria-hidden', 'true');
		sizer.className = 'entry-upload-sizer';
		line = document.createElement('div');
		line.className = 'entry-upload-line';
		line.append(name, message);
		dom.append(sizer);
	}

	const button = (label: string, onClick: () => void): HTMLButtonElement => {
		const element = document.createElement('button');
		// Inside the entry's <form>: a button with no type submits it.
		element.type = 'button';
		element.className = 'entry-upload-button';
		element.textContent = label;
		element.addEventListener('click', onClick);
		return element;
	};

	const retry = button('Try again', actions.retry);
	const remove = button('Remove', actions.remove);

	if (line === null) {
		dom.append(name, message, buttons);
	} else {
		dom.append(line, buttons);
	}

	/**
	 * A photo or video takes the shape it will land in as soon as the queue has
	 * prepared it and knows its size — capped as the landed one is, so a tall
	 * photo does not reserve a page and then shrink to the cap. See
	 * `.entry-upload-sized` in `layout.css`. Until then, and on failure, it is
	 * the ordinary box.
	 */
	const shape = (view: UploadView): void => {
		const ratio = kind === 'image' || kind === 'video' ? mediaRatio(view.width, view.height) : null;
		if (ratio !== null && view.status !== 'failed') {
			dom.classList.add('entry-upload-sized');
			dom.style.setProperty(MEDIA_RATIO_PROPERTY, ratio);
			dom.style.aspectRatio = `${view.width} / ${view.height}`;
		} else {
			dom.classList.remove('entry-upload-sized');
			dom.style.removeProperty(MEDIA_RATIO_PROPERTY);
			dom.style.removeProperty('aspect-ratio');
		}
	};

	return {
		dom,
		update(view) {
			name.textContent = view.name;
			shape(view);
			if (view.status === 'failed') {
				// An alert, which interrupts: nobody is waiting on a placeholder, and
				// the only thing that will say the photo did not go in is this.
				message.setAttribute('role', 'alert');
				message.setAttribute('aria-live', 'assertive');
				message.textContent = view.message ?? 'This file could not be added.';
				dom.classList.add('entry-upload-failed');
				buttons.replaceChildren(...(view.retryable ? [retry, remove] : [remove]));
			} else {
				// Progress is polite, and deliberately *not* `role="status"`: the save
				// status in the toolbar is the page's one status region, and a second
				// one would be two answers to "is this entry saved".
				message.removeAttribute('role');
				message.setAttribute('aria-live', 'polite');
				message.textContent = view.status === 'waiting' ? 'Waiting…' : 'Uploading…';
				dom.classList.remove('entry-upload-failed');
				buttons.replaceChildren();
			}
		}
	};
}

function placeholdersExtension(deps: {
	element: (id: string) => HTMLElement | null;
	onFiles: (files: File[], anchor: Anchor) => void;
}): Extension {
	return Extension.create({
		name: 'noteworthyUploads',
		addProseMirrorPlugins() {
			return [
				new Plugin<PluginState>({
					key: uploadsKey,
					state: {
						init: () => ({ placeholders: [] }),
						apply(tr, value) {
							let placeholders = value.placeholders;

							if (tr.docChanged) {
								placeholders = placeholders.map((placeholder) => ({
									...placeholder,
									anchor: carryAnchor(placeholder.anchor, tr)
								}));
							}

							const meta = tr.getMeta(uploadsKey) as Meta | undefined;
							if (meta?.kind === 'add') {
								placeholders = [...placeholders, ...meta.placeholders];
							} else if (meta?.kind === 'remove') {
								placeholders = placeholders.filter(
									(placeholder) => !meta.ids.includes(placeholder.id)
								);
							} else if (meta?.kind === 'stored') {
								const stored = placeholders.find((placeholder) => placeholder.id === meta.id);
								placeholders = placeholders
									.filter((placeholder) => placeholder.id !== meta.id)
									.map((placeholder) =>
										stored !== undefined &&
										placeholder.anchor.pos === stored.anchor.pos &&
										placeholder.anchor.place === stored.anchor.place
											? { ...placeholder, anchor: { pos: meta.at, place: 'after' } }
											: placeholder
									);
							}

							return placeholders === value.placeholders ? value : { placeholders };
						}
					},
					props: {
						decorations(state) {
							const { placeholders } = uploadsKey.getState(state) ?? { placeholders: [] };
							if (placeholders.length === 0) {
								return DecorationSet.empty;
							}
							return DecorationSet.create(
								state.doc,
								placeholders.flatMap((placeholder) => {
									const dom = deps.element(placeholder.id);
									if (dom === null) {
										return [];
									}
									return [
										Decoration.widget(boundaryOf(state.doc, placeholder.anchor), dom, {
											// The key keeps one element across redraws, so a
											// placeholder is not rebuilt on every keystroke, and
											// `seq` orders several at the same spot.
											key: placeholder.id,
											side: placeholder.seq,
											ignoreSelection: true,
											stopEvent: () => true
										})
									];
								})
							);
						},

						handlePaste(view, event) {
							const files = pastedFiles(event.clipboardData);
							if (files.length === 0) {
								return false;
							}
							deps.onFiles(files, anchorForSelection(view.state));
							return true;
						},

						handleDrop(view, event, _slice, moved) {
							// `moved` is the editor's own content being dragged about.
							if (moved) {
								return false;
							}
							const files = [...(event.dataTransfer?.files ?? [])];
							if (files.length === 0) {
								return false;
							}
							const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
							deps.onFiles(
								files,
								at === null ? anchorForSelection(view.state) : anchorAt(view.state.doc, at.pos)
							);
							event.preventDefault();
							return true;
						}
					}
				})
			];
		}
	});
}

export type UploadsOptions = {
	links: MediaLinks;
	/** Told whenever anything is waiting or uploading, for the page's leave guard. */
	onBusy: (busy: boolean) => void;
	/** Told the allowance whenever the queue learns it, for the Add media menu. */
	onRemaining: (bytes: number) => void;
};

export type Uploads = {
	/**
	 * Takes files from the picker, a paste or a drop. `options.audio` says they
	 * were picked through *Audio file* (see `$lib/media/intake`).
	 */
	add: (files: File[], anchor?: Anchor, options?: IntakeOptions) => void;
	/** The placeholder element for a queued file, for the plugin to draw. */
	element: (id: string) => HTMLElement | null;
	busy: () => boolean;
	/** Every file waiting, under way or failed is dropped, and its placeholder with it. */
	cancel: () => void;
	destroy: () => void;
};

/** How many photos, videos and recordings the document holds right now. */
function heldBy(editor: Editor): number {
	return countMedia(editor.getJSON() as never);
}

/**
 * The node a stored file becomes: its kind names the node type, and a photo or
 * video carries its picture's size when there is one. Audio has none, and its
 * node has no attributes for it — ProseMirror would refuse ones it does not
 * declare.
 */
export function mediaNodeFor(file: Pick<StoredFile, 'kind' | 'path' | 'width' | 'height'>): {
	type: StoredFile['kind'];
	attrs: Record<string, string | number | null>;
} {
	if (file.kind === 'audio') {
		return { type: 'audio', attrs: { path: file.path } };
	}
	return { type: file.kind, attrs: { path: file.path, width: file.width, height: file.height } };
}

/**
 * Puts the stored photo, video or audio into the document, in one transaction,
 * at the placeholder's position.
 *
 * `replaceRangeWith` rather than `insert`, because the position may be one a
 * photo cannot go — the start of a list item, which has to begin with a
 * paragraph — and it moves outwards to one that works rather than refusing.
 * `closeHistory` keeps the insertion as an undo step of its own instead of
 * merging into whatever was being typed a moment before.
 */
function insertStored(view: EditorView, id: string, file: StoredFile): void {
	const state = view.state;
	const placeholder = (uploadsKey.getState(state)?.placeholders ?? []).find(
		(candidate) => candidate.id === id
	);
	const { type, attrs } = mediaNodeFor(file);
	const node = state.schema.nodes[type].create(attrs);
	const at =
		placeholder === undefined ? state.doc.content.size : boundaryOf(state.doc, placeholder.anchor);

	const tr = state.tr;
	closeHistory(tr);
	tr.replaceRangeWith(at, at, node);

	// Where it actually landed, read back from the document rather than assumed:
	// `replaceRangeWith` may have moved outwards. Paths are unique, so this finds
	// exactly the photo just inserted.
	let inserted = at;
	tr.doc.descendants((child, pos) => {
		if (child.type === node.type && child.attrs.path === file.path) {
			inserted = pos;
			return false;
		}
		return true;
	});

	tr.setMeta(uploadsKey, { kind: 'stored', id, at: inserted } satisfies Meta);
	view.dispatch(tr);
}

/**
 * Wires an editor to a queue: placeholders in the document's margins, uploads
 * one at a time, and a photo inserted when each one is stored.
 *
 * Called by `createEntryEditor`, which also puts the plugin in the editor's
 * extensions — the plugin has to exist when the editor is built, and the queue
 * only once there is an editor to insert into.
 */
export function createUploads(editor: Editor, options: UploadsOptions): Uploads {
	const elements = new Map<string, PlaceholderElement>();
	let busy = false;

	const drop = (ids: string[]): void => {
		for (const id of ids) {
			elements.delete(id);
		}
		const tr = editor.state.tr.setMeta(uploadsKey, { kind: 'remove', ids } satisfies Meta);
		tr.setMeta('addToHistory', false);
		editor.view.dispatch(tr);
	};

	const queue: UploadQueue = createUploadQueue({
		prepare: prepareMedia,
		remaining: remainingAllowance,
		store: storePrepared,
		held: () => heldBy(editor),
		onStored: (id, file) => {
			// Shown from the browser's own copy, so the photo appears the moment it
			// is stored rather than after another round trip to sign it.
			options.links.local(file.path, URL.createObjectURL(file.blob));
			insertStored(editor.view, id, file);
			elements.delete(id);
		},
		onChange: (views) => {
			for (const view of views) {
				elements.get(view.id)?.update(view);
			}
			const next = queue.busy();
			if (next !== busy) {
				busy = next;
				options.onBusy(busy);
			}
		},
		onRemaining: options.onRemaining,
		describe: (thrown, noun) =>
			thrown instanceof ImageRefused
				? thrown.message
				: notAddedMessage(noun, thrown instanceof Error ? thrown.message : String(thrown))
	});

	const add = (files: File[], anchor?: Anchor, intakeOptions: IntakeOptions = {}): void => {
		if (files.length === 0) {
			return;
		}
		const where = anchor ?? anchorForSelection(editor.state);
		const intakes: Intake[] = files.map((file) =>
			intake({ name: file.name, type: file.type, size: file.size }, intakeOptions)
		);
		const ids = queue.add(files, intakes);

		const placeholders = ids.map((id, index) => {
			const accepted = intakes[index];
			const element = placeholderElement(
				{
					retry: () => queue.retry(id),
					remove: () => {
						queue.remove(id);
						drop([id]);
					}
				},
				accepted.ok ? accepted.kind : null
			);
			elements.set(id, element);
			return { id, anchor: where, seq: index + 1 };
		});

		// Drawn before they are put on the page: the queue announced their first
		// state inside `add`, when these elements did not exist yet.
		for (const view of queue.views()) {
			elements.get(view.id)?.update(view);
		}

		const tr = editor.state.tr.setMeta(uploadsKey, { kind: 'add', placeholders } satisfies Meta);
		// No steps, and not an undo step either: a placeholder is not an edit.
		tr.setMeta('addToHistory', false);
		editor.view.dispatch(tr);
	};

	return {
		add,
		element: (id) => elements.get(id)?.dom ?? null,
		busy: () => queue.busy(),
		cancel: () => {
			const ids = queue.views().map((view) => view.id);
			queue.cancel();
			if (ids.length > 0) {
				drop(ids);
			}
		},
		destroy: () => {
			queue.destroy();
			elements.clear();
		}
	};
}

/** The extension half, for the editor's extension list. */
export function uploadsExtension(deps: {
	onFiles: (files: File[], anchor: Anchor) => void;
	element: (id: string) => HTMLElement | null;
}): Extension {
	return placeholdersExtension(deps);
}
