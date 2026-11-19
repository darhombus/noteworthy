/**
 * Which video or audio item is which, while the editor is open: a number for
 * each, kept through every change, so a moved player keeps its element.
 *
 * Browser only in practice (the node views read it), though the plugin runs
 * without a view: `player-identity.test.ts` drives it on a bare state.
 *
 * ---------------------------------------------------------------------------
 * WHY A MOVED PLAYER WAS BUILT AGAIN
 * ---------------------------------------------------------------------------
 * Measured in PRD 16 Section 3 (docs/constraints.md, "Players kept through a
 * move"). ProseMirror's view redraws a parent's children by walking the new
 * children in order and, for each, looking a few old views ahead for one that
 * `matchesNode`: equal by `node.eq` (structure, not identity) with the same
 * decorations. A match destroys every old view it skipped. So when an item and
 * the block after it swap, the block matches first, the item's view is skipped
 * and destroyed, and the item is drawn afresh: a new `<video>` or `<audio>`,
 * back at 0:00, paused, loading again. Moved up, it is the block that is drawn
 * again, and the player plays on. Every move does this, by keys, by a drag, by
 * undo or redo, in every engine.
 *
 * And because the match is by `eq`, two items naming the same file are, to the
 * view, the same: moving one past the other changed no element at all (the
 * playing one stayed where it was, now standing for the other), and moving one
 * past a line to just above its twin handed it the twin's element.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBER
 * ---------------------------------------------------------------------------
 * Each `video` and `audio` node carries a node decoration whose spec holds its
 * number (`playerItem`). Decorations are mapped through every step, so the number
 * follows its node wherever ProseMirror's mapping can follow it: typing around it,
 * and the moved run itself, which a move's `ReplaceAroundStep` keeps as its gap.
 * The node view reads it, and a view keeps a player only for the same number
 * (`./player-node`, KEPT THROUGH A MOVE).
 *
 * A step that takes a node out and puts it back drops its decoration: the block a
 * move passes is put back from the step's slice, and undo and redo put back
 * whichever side the step's slice held. So, within the one transaction, a number
 * lost goes to a node without one that is equal to the node it was on (`eq`), both
 * taken in document order: a step puts its slice back in its own order, so the
 * k-th lost item of a kind and file is the k-th put back. It is also the pairing
 * ProseMirror's own view made, and it is what keeps a player through "Use the
 * saved version" (`replaceDocument`), which builds every node anew. (Matching the
 * very same node object first, as `mapCollapsed` in `./collapse` does, was built
 * and taken out: every step the app makes puts its slice back in order, so it
 * found nothing this does not.) Anything still without a number gets a new one,
 * and so a new element: an item deleted and brought back by a later undo is two
 * transactions, and is built again, as an upload that lands is.
 *
 * The decorations differ from item to item, so two items naming the same file no
 * longer match each other's views: each keeps its own element.
 *
 * Photos carry none. A moved photo's `<img>` is built again too, but it shows the
 * same link, decoded from the browser's cache, with no reload anybody sees.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** The node types that have a player to keep. */
export const PLAYER_NODE_TYPES = ['video', 'audio'] as const;

type ItemSpec = { playerItem: number };

export const playerIdentityKey = new PluginKey<DecorationSet>('noteworthyPlayerIdentity');

/** Shared by every editor on the page, so a number is never reused anywhere. */
let lastItem = 0;

function isPlayerNode(node: ProseMirrorNode): boolean {
	return (PLAYER_NODE_TYPES as readonly string[]).includes(node.type.name);
}

/** Every player node in the document, in order. Text is not walked. */
function playerNodes(doc: ProseMirrorNode): { pos: number; node: ProseMirrorNode }[] {
	const found: { pos: number; node: ProseMirrorNode }[] = [];
	doc.descendants((node, pos) => {
		if (isPlayerNode(node)) {
			found.push({ pos, node });
			return false;
		}
		return !node.isTextblock;
	});
	return found;
}

function itemDecoration(pos: number, node: ProseMirrorNode, item: number): Decoration {
	return Decoration.node(pos, pos + node.nodeSize, {}, { playerItem: item } satisfies ItemSpec);
}

function itemOf(decoration: Decoration): number | null {
	const item = (decoration.spec as Partial<ItemSpec>).playerItem;
	return typeof item === 'number' ? item : null;
}

/** Each numbered item in `set`, by where it starts in `doc`. */
function numbered(set: DecorationSet, doc: ProseMirrorNode): Map<number, number> {
	const at = new Map<number, number>();
	for (const decoration of set.find(0, doc.content.size)) {
		const item = itemOf(decoration);
		if (item !== null) {
			at.set(decoration.from, item);
		}
	}
	return at;
}

function fresh(doc: ProseMirrorNode): DecorationSet {
	return DecorationSet.create(
		doc,
		playerNodes(doc).map(({ pos, node }) => itemDecoration(pos, node, (lastItem += 1)))
	);
}

/** See THE NUMBER above. Exported for its unit tests. */
export function mapItems(set: DecorationSet, tr: Transaction): DecorationSet {
	const before = numbered(set, tr.before);
	const mapped = set.map(tr.mapping, tr.doc);
	const keptAt = numbered(mapped, tr.doc);
	const kept = new Set(keptAt.values());

	const lost: { item: number; node: ProseMirrorNode }[] = [];
	for (const [pos, item] of [...before].sort(([a], [b]) => a - b)) {
		const node = tr.before.nodeAt(pos);
		if (!kept.has(item) && node !== null) {
			lost.push({ item, node });
		}
	}
	const unnumbered = playerNodes(tr.doc).filter(({ pos }) => !keptAt.has(pos));
	if (unnumbered.length === 0) {
		return mapped;
	}

	// Put back: an equal node, both in document order.
	const given = new Map<number, number>();
	const taken = new Set<number>();
	for (const place of unnumbered) {
		const match = lost.find(({ item, node }) => !taken.has(item) && node.eq(place.node));
		if (match !== undefined) {
			given.set(place.pos, match.item);
			taken.add(match.item);
		}
	}

	return mapped.add(
		tr.doc,
		unnumbered.map(({ pos, node }) => itemDecoration(pos, node, given.get(pos) ?? (lastItem += 1)))
	);
}

/** The item a node view's decorations say it is, or `null` with none (no plugin). */
export function playerItemIn(decorations: readonly Decoration[]): number | null {
	for (const decoration of decorations) {
		const item = itemOf(decoration);
		if (item !== null) {
			return item;
		}
	}
	return null;
}

/** The plugin itself. Exported for `player-identity.test.ts`, which runs it without a view. */
export function playerIdentityPlugin(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: playerIdentityKey,
		state: {
			init: (_, state) => fresh(state.doc),
			apply: (tr, set) => (tr.docChanged ? mapItems(set, tr) : set)
		},
		props: {
			decorations: (state) => playerIdentityKey.getState(state)
		}
	});
}

/** The plugin, for the editor's extension list. Holds no schema and stores nothing. */
export function playerIdentityExtension(): Extension {
	return Extension.create({
		name: 'noteworthyPlayerIdentity',
		addProseMirrorPlugins() {
			return [playerIdentityPlugin()];
		}
	});
}
