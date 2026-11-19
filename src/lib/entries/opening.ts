/**
 * What the editor will open with, worked out without the editor.
 *
 * ---------------------------------------------------------------------------
 * WHY THE EDIT PAGE NEEDS THIS
 * ---------------------------------------------------------------------------
 * TipTap arrives as its own chunk, after the page is drawn, and until then the
 * edit page draws the entry the way the editor is about to (`EntryEditor`, THE
 * WAIT). For that to be the same picture and not merely a similar one, the page
 * has to know four things the editor only learns once it is running:
 *
 *   the document it will open: `forEditor` in `./editor` takes out what the
 *   schema has no extension for and then runs `parseDocument`, with the
 *   writer's own folder, over what is left. The schema and `NODES` are the same
 *   vocabulary (`document.test.ts`), so `parseDocument` alone opens the same
 *   document, and `opening.test.ts` holds the two to it;
 *
 *   what the toolbar will show pressed. The editor opens with ProseMirror's
 *   default selection, `Selection.atStart`: a cursor at the start of the first
 *   textblock, or the first media item selected whole when one comes before any
 *   text. Bold is lit if the first word is bold, Heading 1 if the entry opens
 *   on one, and so on — so the row would change as the editor took over unless
 *   it was drawn lit from the start. `opening.browser.test.ts` compares this
 *   against `readToolbarState` on a real editor;
 *
 *   whether that first item is selected, which draws a ring round it;
 *
 *   which node and mark types the editor will leave out, for the notice above
 *   the form, so that the notice is there from the first frame rather than
 *   pushing the whole form down when the editor reports it.
 *
 * Nothing here imports TipTap, and nothing here is in the editor's chunk.
 */
import { MARKS, NODES, parseDocument } from './document';
import { MEDIA_NODE_TYPES } from './media';
import { toRenderTree, type RenderBlock } from './render';
import { EMPTY_TOOLBAR_STATE, type ToolbarState } from './toolbar';
import type { Json } from '$lib/types/database';

export type Opening = {
	/** The body as the editor will draw it, for `EntryBlocks`. */
	blocks: RenderBlock[];
	/** The toolbar's state on the editor's first transaction. */
	toolbar: ToolbarState;
	/** The media item the editor opens with selected, if it opens on one. */
	selected: RenderBlock | null;
	/** Node and mark types the editor will leave out. Empty in every ordinary case. */
	dropped: string[];
};

/** What the editor opens when the stored body leaves nothing to open: one empty paragraph. */
const BLANK: RenderBlock[] = [{ kind: 'paragraph', inline: [] }];

const MEDIA_KINDS: readonly string[] = MEDIA_NODE_TYPES;

function isNode(value: Json | undefined): value is { [key: string]: Json | undefined } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every node and mark type in a stored body that the vocabulary does not have,
 * sorted and once each — `forEditor`'s `dropped`.
 *
 * Inside an unknown node too: the editor drops the node whole, but TipTap's
 * `rewriteUnknownContent` reports what was inside it as well, and the notice
 * names whatever that reports.
 */
export function unknownTypes(body: Json): string[] {
	const found = new Set<string>();

	const walk = (node: Json | undefined): void => {
		if (!isNode(node) || typeof node.type !== 'string') {
			return;
		}
		if (!(node.type in NODES)) {
			found.add(node.type);
		}
		if (Array.isArray(node.marks)) {
			for (const mark of node.marks) {
				if (isNode(mark) && typeof mark.type === 'string' && !(mark.type in MARKS)) {
					found.add(mark.type);
				}
			}
		}
		if (Array.isArray(node.content)) {
			node.content.forEach(walk);
		}
	};

	walk(body);
	return [...found].sort();
}

/** Where `Selection.atStart` lands: the first textblock, or a media item before any text. */
type Start = { block: RenderBlock; within: RenderBlock['kind'][] };

function startIn(blocks: RenderBlock[], within: RenderBlock['kind'][]): Start | null {
	for (const block of blocks) {
		switch (block.kind) {
			case 'paragraph':
			case 'heading':
			case 'image':
			case 'video':
			case 'audio':
				return { block, within };
			case 'blockquote': {
				const found = startIn(block.blocks, [...within, block.kind]);
				if (found !== null) {
					return found;
				}
				break;
			}
			case 'bulletList':
			case 'orderedList':
				for (const item of block.items) {
					const found = startIn(item, [...within, block.kind]);
					if (found !== null) {
						return found;
					}
				}
				break;
		}
	}
	return null;
}

function countIn(blocks: RenderBlock[]): number {
	return blocks.reduce((sum, block) => {
		switch (block.kind) {
			case 'image':
			case 'video':
			case 'audio':
				return sum + 1;
			case 'blockquote':
				return sum + countIn(block.blocks);
			case 'bulletList':
			case 'orderedList':
				return sum + block.items.reduce((inner, item) => inner + countIn(item), 0);
			default:
				return sum;
		}
	}, 0);
}

/**
 * The toolbar on the editor's first transaction.
 *
 * At a cursor, TipTap's `isActive` asks about the marks ProseMirror would give
 * the next character typed there — at the start of a textblock, those of its
 * first inline node — and about every node the cursor is inside. With a media
 * item selected there is no text in the selection, so no mark is lit, and the
 * nodes are the ones round it. Undo and Redo have no history yet.
 */
function toolbarAt(start: Start | null, media: number): ToolbarState {
	const state: ToolbarState = { ...EMPTY_TOOLBAR_STATE, media: media > 0 };
	if (start === null) {
		return state;
	}
	state.bulletList = start.within.includes('bulletList');
	state.orderedList = start.within.includes('orderedList');
	state.blockquote = start.within.includes('blockquote');

	const { block } = start;
	if (block.kind !== 'paragraph' && block.kind !== 'heading') {
		return state;
	}
	if (block.kind === 'heading') {
		state.heading1 = block.level === 1;
		state.heading2 = block.level === 2;
	}
	const first = block.inline[0];
	if (first?.kind === 'text') {
		for (const mark of first.marks) {
			state[mark.type] = true;
		}
	}
	return state;
}

/** The body the editor will open, and how it will open it. See the note at the top. */
export function openingOf(body: Json, owner: string): Opening {
	const parsed = isNode(body) ? parseDocument(JSON.stringify(body), { owner }) : null;
	const tree = parsed === null ? [] : toRenderTree(parsed);
	const blocks = tree.length === 0 ? BLANK : tree;
	const start = startIn(blocks, []);
	return {
		blocks,
		toolbar: toolbarAt(start, countIn(blocks)),
		selected: start !== null && MEDIA_KINDS.includes(start.block.kind) ? start.block : null,
		dropped: unknownTypes(body)
	};
}
