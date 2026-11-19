/**
 * Media inside a text selection, marked. See docs/constraints.md, "Text-editing
 * keys", "Media in a selection", for each engine's own behaviour and the
 * measurements behind this.
 *
 * ---------------------------------------------------------------------------
 * WHY THE BROWSER DOES NOT MARK IT
 * ---------------------------------------------------------------------------
 * A photo, video or audio item between two paragraphs is inside a selection
 * that runs from one to the other (ProseMirror's and the browser's both), but
 * its figure is `contenteditable="false"`, and Chromium paints no selection
 * over anything in such an island: the same figure without the attribute is
 * tinted. Firefox tints a photo but not a player; WebKit tints all three. So
 * the engines' own marking is switched off on the figures (`layout.css`), and
 * this marks them alike everywhere.
 *
 * ---------------------------------------------------------------------------
 * HOW
 * ---------------------------------------------------------------------------
 * A node decoration with a class, on every media node wholly inside a text
 * selection or a select-all — however it was made, since only the selection
 * is read. ProseMirror adds the class to the figure the node view already has
 * and calls the view's `update`, which keeps it (the node is unchanged), so
 * nothing is redrawn and the `<img>`, `<video>` or `<audio>` is the same
 * element throughout. A node selection is left alone: it keeps its own ring
 * (`ProseMirror-selectednode`). The collapse plugin's decorations sit on the
 * same nodes and are told apart by their spec (`collapsedIn` in `./collapse`).
 *
 * ---------------------------------------------------------------------------
 * WHEN THE EDITOR LOSES FOCUS
 * ---------------------------------------------------------------------------
 * ProseMirror keeps its selection when the editor loses focus; the browser may
 * not. Focus moved by Tab or to a button leaves the browser's selection in the
 * editor, and all three engines go on painting it as before; a click elsewhere
 * on the page moves it away, and the text is no longer drawn selected. So the
 * tint is shown only while the browser's own selection is still in the editor
 * and not collapsed, which the editor's element says with a class.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { MEDIA_NODE_TYPES } from './media';

/** On a figure wholly inside the selection. */
export const IN_SELECTION_CLASS = 'entry-media-in-selection';

/** On the editor while it is blurred and the browser's selection is no longer in it. */
export const SELECTION_ELSEWHERE_CLASS = 'entry-selection-elsewhere';

const tintKey = new PluginKey<DecorationSet>('noteworthySelectionTint');

function isMediaNode(node: ProseMirrorNode): boolean {
	return (MEDIA_NODE_TYPES as readonly string[]).includes(node.type.name);
}

/** The media wholly inside the selection, as decorations. Exported for the unit test. */
export function selectedMedia(state: EditorState): DecorationSet {
	const { selection, doc } = state;
	if (selection.empty || selection instanceof NodeSelection) {
		return DecorationSet.empty;
	}
	const { from, to } = selection;
	const found: Decoration[] = [];
	doc.nodesBetween(from, to, (node, pos) => {
		if (isMediaNode(node)) {
			if (pos >= from && pos + node.nodeSize <= to) {
				found.push(Decoration.node(pos, pos + node.nodeSize, { class: IN_SELECTION_CLASS }));
			}
			return false;
		}
		return !node.isTextblock;
	});
	return found.length === 0 ? DecorationSet.empty : DecorationSet.create(doc, found);
}

/** Whether the browser's own selection is a range inside the editor. */
export function browserSelectionHere(view: EditorView): boolean {
	const selection = view.dom.ownerDocument.getSelection();
	return (
		selection !== null &&
		selection.rangeCount > 0 &&
		!selection.isCollapsed &&
		view.dom.contains(selection.anchorNode) &&
		view.dom.contains(selection.focusNode)
	);
}

export function selectionTintPlugin(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: tintKey,
		state: {
			init: (_, state) => selectedMedia(state),
			apply: (tr, set, _old, state) =>
				tr.docChanged || tr.selectionSet ? selectedMedia(state) : set
		},
		props: {
			decorations: (state) => tintKey.getState(state)
		},
		view(view) {
			const document = view.dom.ownerDocument;
			const check = (): void => {
				view.dom.classList.toggle(
					SELECTION_ELSEWHERE_CLASS,
					!view.hasFocus() && !browserSelectionHere(view)
				);
			};
			document.addEventListener('selectionchange', check);
			check();
			return {
				update: check,
				destroy: () => document.removeEventListener('selectionchange', check)
			};
		}
	});
}

/** The plugin, for the editor's extension list. Holds no schema. */
export function selectionTintExtension(): Extension {
	return Extension.create({
		name: 'noteworthySelectionTint',
		addProseMirrorPlugins() {
			return [selectionTintPlugin()];
		}
	});
}
