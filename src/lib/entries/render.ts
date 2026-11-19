/**
 * A stored body, turned into something a template can walk.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT AN HTML STRING
 * ---------------------------------------------------------------------------
 * The obvious way to render a TipTap document on a page is TipTap's own
 * `generateHTML`, which returns markup, which then has to reach the page through
 * `{@html}`. That is the one construct in Svelte with no escaping, and an entry
 * body is user input — so taking that route means the safety of the whole read
 * view rests on a sanitiser being correct, being kept correct, and being applied
 * at every call site forever.
 *
 * This module takes the other route. It converts the document into a closed set
 * of typed nodes, and `EntryBody.svelte` renders them as ordinary Svelte
 * elements. Every piece of text arrives as `{node.text}`, which Svelte escapes,
 * so a body containing `<script>alert(1)</script>` renders those characters on
 * screen and nothing else. There is no `{@html}` in this app, and no sanitiser
 * to keep correct, because no markup is ever constructed from the document.
 *
 * That leaves exactly one value in a body that the browser will act on rather
 * than display: a link's `href`. It is checked here, again, with the same
 * `normalizeHref` the server's sanitiser uses — see the note on `link` below.
 *
 * ---------------------------------------------------------------------------
 * WHY IT RE-CHECKS WHAT parseDocument ALREADY CHECKED
 * ---------------------------------------------------------------------------
 * `parseDocument` runs on the way in and keeps only the allowed vocabulary, so
 * in principle every row is already clean. In principle is not the same as in
 * fact, for three reasons that all apply to this app today:
 *
 *   Rows written before that sanitiser existed were written by `toBody`, and
 *   rows can be written by anything else that can reach the table. The column's
 *   own CHECK asks three questions and no more.
 *
 *   `entries.content` is writable by the owner through PostgREST. Anybody with
 *   their own token can PATCH a document straight past the form action, which
 *   is the realistic version of the attack and the one `e2e/entry-read.e2e.ts`
 *   actually performs.
 *
 *   Rendering is where a bad value becomes a live thing rather than a stored
 *   one, so it is the last place that can refuse it and the only place that
 *   knows it is about to matter.
 *
 * Unknown nodes and marks are dropped rather than rendered as their contents:
 * the vocabulary is the vocabulary, and a node this module has never heard of
 * is something the editor cannot produce.
 */
import { hasExtensionFor, isMediaPath } from '$lib/media/paths';
import type { MediaKind } from '$lib/media/types';
import { HEADING_LEVELS, MAX_DIMENSION, normalizeHref } from './document';
import type { Json } from '$lib/types/database';

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export type RenderMark =
	| { type: 'bold' }
	| { type: 'italic' }
	| { type: 'strike' }
	| { type: 'highlight' }
	| { type: 'link'; href: string };

export type RenderInline = { kind: 'text'; text: string; marks: RenderMark[] } | { kind: 'break' };

export type RenderBlock =
	| { kind: 'paragraph'; inline: RenderInline[] }
	| { kind: 'heading'; level: HeadingLevel; inline: RenderInline[] }
	| { kind: 'blockquote'; blocks: RenderBlock[] }
	| { kind: 'bulletList'; items: RenderBlock[][] }
	| { kind: 'orderedList'; start: number; items: RenderBlock[][] }
	/**
	 * A photo, by its storage path. Never a URL: the page signs the path, and a
	 * path in somebody else's folder is simply never signed, so it renders as a
	 * photo that could not be loaded rather than as somebody else's photo.
	 */
	| { kind: 'image'; path: string; width: number | null; height: number | null }
	/** A video, by its path as a photo is, with its picture's size when known. */
	| { kind: 'video'; path: string; width: number | null; height: number | null }
	/** An audio file, by its path. No picture, so no size. */
	| { kind: 'audio'; path: string };

/** Matches the walk in `document.ts`, for the same reason it has one. */
const MAX_DEPTH = 24;

function isNode(value: Json | undefined): value is { [key: string]: Json | undefined } {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childrenOf(node: { [key: string]: Json | undefined }): Json[] {
	const content = node.content;
	return Array.isArray(content) ? content : [];
}

function headingLevel(value: Json | undefined): HeadingLevel {
	const level = isNode(value) ? value.level : undefined;
	if (typeof level !== 'number') {
		return HEADING_LEVELS[0];
	}
	// Clamped rather than defaulted, as on the way in — a row written before the
	// vocabulary narrowed to two levels can still hold a three.
	const last = HEADING_LEVELS[HEADING_LEVELS.length - 1];
	return Math.min(Math.max(Math.round(level), HEADING_LEVELS[0]), last) as HeadingLevel;
}

/**
 * A stored pixel size, or `null` for anything that is not one.
 *
 * The same bounds the sanitiser keeps, because a row can hold whatever its
 * owner wrote through PostgREST. `null` is not a failure: the photo renders
 * without reserving its space, which is also what a node written before the
 * size was recorded gets.
 */
function dimension(value: Json | undefined): number | null {
	return typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= MAX_DIMENSION
		? value
		: null;
}

/**
 * A photo or video node as a block, or `null` when its path is not a path for
 * that kind at all.
 *
 * Shape only, and no owner: the read view is only ever shown to the entry's
 * owner, and what can be *signed* is the server's decision, made against the
 * owner's own session. A path that fails here is not something a signer could
 * ever turn into a link, so there is nothing to draw.
 */
function mediaOf(node: { [key: string]: Json | undefined }, kind: MediaKind): RenderBlock | null {
	const attrs = isNode(node.attrs) ? node.attrs : {};
	const path = attrs.path;
	if (typeof path !== 'string' || !isMediaPath(path) || !hasExtensionFor(path, kind)) {
		return null;
	}
	if (kind === 'audio') {
		return { kind, path };
	}
	return { kind, path, width: dimension(attrs.width), height: dimension(attrs.height) };
}

function listStart(value: Json | undefined): number {
	const start = isNode(value) ? value.start : undefined;
	return typeof start === 'number' && Number.isInteger(start) && start >= 1 ? start : 1;
}

/**
 * The marks on one text node, in the order they will nest.
 *
 * `link` is pulled to the front so that it becomes the outermost element: a link
 * containing bold text is a link, where bold text containing a link is a bold
 * run that happens to have an anchor inside it — and only the first is
 * clickable across its whole width. The rest keep the order TipTap stored.
 */
function marksOf(node: { [key: string]: Json | undefined }): RenderMark[] {
	const raw = node.marks;
	if (!Array.isArray(raw)) {
		return [];
	}

	const kept: RenderMark[] = [];
	const seen = new Set<string>();

	for (const entry of raw) {
		if (!isNode(entry) || typeof entry.type !== 'string' || seen.has(entry.type)) {
			continue;
		}

		switch (entry.type) {
			case 'bold':
			case 'italic':
			case 'strike':
			case 'highlight':
				seen.add(entry.type);
				kept.push({ type: entry.type });
				break;
			case 'link': {
				// The whole security question, in one call.
				//
				// `normalizeHref` parses the value and reads `.protocol` off the
				// result, so `javascript:`, `data:` and `vbscript:` are refused however
				// they are spelled — the parser has resolved the escapes before the
				// check happens. A refusal drops the mark and keeps the text, which is
				// what makes a hostile link render as the words somebody wrote rather
				// than as nothing at all or as a live anchor.
				const href = normalizeHref(isNode(entry.attrs) ? entry.attrs.href : undefined);
				if (href !== null) {
					seen.add('link');
					kept.push({ type: 'link', href });
				}
				break;
			}
			default:
				break;
		}
	}

	kept.sort((a, b) => Number(b.type === 'link') - Number(a.type === 'link'));
	return kept;
}

function inlineOf(nodes: Json[]): RenderInline[] {
	const kept: RenderInline[] = [];

	for (const raw of nodes) {
		if (!isNode(raw)) {
			continue;
		}

		if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.length > 0) {
			kept.push({ kind: 'text', text: raw.text, marks: marksOf(raw) });
		} else if (raw.type === 'hardBreak') {
			kept.push({ kind: 'break' });
		}
	}

	return kept;
}

function blocksOf(nodes: Json[], depth: number): RenderBlock[] {
	if (depth > MAX_DEPTH) {
		return [];
	}

	const kept: RenderBlock[] = [];

	for (const raw of nodes) {
		if (!isNode(raw) || typeof raw.type !== 'string') {
			continue;
		}

		switch (raw.type) {
			case 'paragraph':
				kept.push({ kind: 'paragraph', inline: inlineOf(childrenOf(raw)) });
				break;
			case 'heading':
				kept.push({
					kind: 'heading',
					level: headingLevel(raw.attrs),
					inline: inlineOf(childrenOf(raw))
				});
				break;
			case 'blockquote': {
				const blocks = blocksOf(childrenOf(raw), depth + 1);
				if (blocks.length > 0) {
					kept.push({ kind: 'blockquote', blocks });
				}
				break;
			}
			case 'bulletList': {
				const items = itemsOf(childrenOf(raw), depth + 1);
				if (items.length > 0) {
					kept.push({ kind: 'bulletList', items });
				}
				break;
			}
			case 'orderedList': {
				const items = itemsOf(childrenOf(raw), depth + 1);
				if (items.length > 0) {
					kept.push({ kind: 'orderedList', start: listStart(raw.attrs), items });
				}
				break;
			}
			case 'image':
			case 'video':
			case 'audio': {
				const media = mediaOf(raw, raw.type);
				if (media !== null) {
					kept.push(media);
				}
				break;
			}
			default:
				break;
		}
	}

	return kept;
}

/** The `listItem` layer, which carries blocks rather than text of its own. */
function itemsOf(nodes: Json[], depth: number): RenderBlock[][] {
	const kept: RenderBlock[][] = [];

	for (const raw of nodes) {
		if (!isNode(raw) || raw.type !== 'listItem') {
			continue;
		}
		kept.push(blocksOf(childrenOf(raw), depth + 1));
	}

	return kept;
}

/** A stored body as blocks to render. An unusable document comes back empty. */
export function toRenderTree(body: Json): RenderBlock[] {
	if (!isNode(body) || body.type !== 'doc') {
		return [];
	}
	return blocksOf(childrenOf(body), 1);
}

/** True when there is nothing to draw — no blocks, or blocks holding no text. */
export function isRenderEmpty(blocks: RenderBlock[]): boolean {
	return blocks.every((block) => {
		switch (block.kind) {
			case 'paragraph':
			case 'heading':
				return block.inline.every((node) => node.kind !== 'text' || node.text.trim().length === 0);
			case 'blockquote':
				return isRenderEmpty(block.blocks);
			case 'bulletList':
			case 'orderedList':
				return block.items.every(isRenderEmpty);
			case 'image':
			case 'video':
			case 'audio':
				// Media on its own is an entry, as `isBlank` says on the way in.
				return false;
		}
	});
}
