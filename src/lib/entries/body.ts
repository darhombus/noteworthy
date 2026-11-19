/**
 * An entry's body, between the textarea and the column.
 *
 * ---------------------------------------------------------------------------
 * THE BODY IS ALREADY STRUCTURED JSON, WHETHER OR NOT THE EDITOR IS
 * ---------------------------------------------------------------------------
 * `entries.content` is `jsonb` and carries a CHECK constraint:
 *
 *   entries_content_is_tiptap_doc CHECK (
 *     jsonb_typeof(content) = 'object'
 *     AND content->>'type' = 'doc'
 *     AND jsonb_typeof(content->'content') = 'array'
 *   )
 *
 * So a plain string is not storable. Writing one fails at the database, not in
 * review. Two more things read the same shape: `search_text` is a generated
 * column built from `extract_tiptap_text(content)`, and `word_count` is set by a
 * trigger calling `fn_compute_word_count(content)`. Both walk the document for
 * nodes with `type: "text"` and read their `text`. A body stored in any other
 * shape would be unsearchable and counted as zero words, silently.
 *
 * What this module does, therefore, is not "store plain text". It writes the
 * narrowest valid document — one paragraph per line — and reads any document
 * back as lines. The textarea is the interface; TipTap's shape is the format,
 * already, today.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MEANS FOR THE RICH EDITOR
 * ---------------------------------------------------------------------------
 * Nothing had to be migrated when it landed. Every entry written through this
 * module is a document TipTap opens. `toLines` is deliberately generic — it
 * gathers text from any node type, at any depth — so it keeps working on
 * headings, lists and marks it has never heard of, rendering them as flat
 * paragraphs rather than as nothing. It degrades; it does not break.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE IS FOR NOW THAT THE READ VIEW HAS ITS OWN RENDERER
 * ---------------------------------------------------------------------------
 * `$lib/entries/render` turns a stored body into a typed tree of blocks and
 * marks, and the read view draws that. This module is what remains: the jobs
 * where an entry genuinely has to become plain text.
 *
 *   `toBody` — the fallback in both entry actions, new and edit, for a submit
 *   carrying the textarea's text rather than a document, which is what arrives
 *   before TipTap has loaded and with no JavaScript at all. See
 *   `EntryEditor.svelte` and `submittedBody` in `./edit`.
 *   `toPlainText` — that same textarea, filled from a stored document.
 *   `toExcerpt` — the journal list, where a list really does have to flatten
 *   into a sentence.
 *
 * `toLines` used to return one line per *top-level* block, which meant a bullet
 * list collapsed into a single line and — because `textOf` joins with `''` —
 * "porridge" and "a long walk" read as "porridgea long walk". Telling a block
 * that holds text from one that holds other blocks is exactly the structural
 * knowledge the render tree added, so the fix landed with it rather than before.
 * The `''` join stays: it is right for the case it exists for, a paragraph split
 * across several text nodes by marks, where "Really glad" plus "." must not
 * become "Really glad .".
 */
import type { Database, Json } from '$lib/types/database';
import { hasMedia } from './media';

/**
 * What `entries.content` holds. The column is NOT NULL, so this is `Json`
 * without `null`, and a function that returns `EntryBody | null` can use `null`
 * to mean "no body" without it also meaning a JSON null document.
 */
export type EntryBody = Database['public']['Tables']['entries']['Row']['content'];

/** Matches the column default, for an entry saved with no body. */
export function emptyBody(): EntryBody {
	return { type: 'doc', content: [] };
}

/**
 * The blocks that hold text directly, rather than holding other blocks.
 *
 * A paragraph and a heading carry inline nodes; a blockquote, a list and a list
 * item carry blocks. One line per *leaf* block is what makes a two-item list two
 * lines — the distinction this module could not draw until the render tree
 * existed, and the reason "porridge" and "a long walk" used to read as
 * "porridgea long walk".
 */
const LEAF_BLOCKS = new Set(['paragraph', 'heading']);

/** Every `type: "text"` node below this one, joined — whatever is in between. */
function textOf(node: Json | undefined): string {
	if (node === undefined || node === null) {
		return '';
	}

	if (Array.isArray(node)) {
		return node.map(textOf).join('');
	}

	if (typeof node !== 'object') {
		return '';
	}

	if (node.type === 'text' && typeof node.text === 'string') {
		return node.text;
	}

	return textOf(node.content);
}

/** Depth-first, appending one line per leaf block and descending through the rest. */
function collectLines(nodes: Json, into: string[]): void {
	if (!Array.isArray(nodes)) {
		return;
	}

	for (const node of nodes) {
		if (typeof node !== 'object' || node === null || Array.isArray(node)) {
			continue;
		}

		if (typeof node.type === 'string' && LEAF_BLOCKS.has(node.type)) {
			into.push(textOf(node.content));
		} else {
			// A container — or a node type this module has never heard of, which is
			// treated as one so that its text is reached rather than lost.
			collectLines(node.content ?? [], into);
		}
	}
}

/**
 * One line per block that holds text.
 *
 * Blocks rather than text nodes, so a blank line the person typed comes back as
 * a blank line instead of disappearing into a join. Note that the database's own
 * two readers join *all* text with a single space and lose this structure — that
 * is right for searching and counting words, and wrong for showing somebody what
 * they wrote, which is why this exists separately rather than reusing them.
 *
 * This is no longer what the read view uses — `$lib/entries/render` is, and it
 * keeps the structure instead of flattening it. What is left here is the
 * plain-text jobs: the textarea fallback on the edit page, and `toExcerpt` for
 * the journal list, where a list really does have to become a sentence.
 */
export function toLines(body: Json): string[] {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return [];
	}

	const lines: string[] = [];
	collectLines(body.content ?? [], lines);
	return lines;
}

/** The body as a textarea would hold it. */
export function toPlainText(body: Json): string {
	return toLines(body).join('\n');
}

/**
 * A document holding exactly what was typed, and nothing the person cannot see.
 *
 * Each line becomes a paragraph; an empty line becomes an empty paragraph, which
 * is how TipTap represents one too. Leading and trailing whitespace across the
 * whole body is dropped — a diary entry that ends in four stray newlines should
 * not render as four stray paragraphs — but whitespace inside a line is kept,
 * because indentation can be deliberate.
 */
export function toBody(text: string): EntryBody {
	const trimmed = text.replace(/\r\n/g, '\n').trim();

	if (trimmed.length === 0) {
		return emptyBody();
	}

	return {
		type: 'doc',
		content: trimmed
			.split('\n')
			.map((line) =>
				line.length === 0
					? { type: 'paragraph' }
					: { type: 'paragraph', content: [{ type: 'text', text: line }] }
			)
	};
}

/**
 * True when there is nothing in the body at all: no text, however many blocks
 * it has, and no photo.
 *
 * Media counts as content. Every rule that asks "is there anything here" asks
 * this — the new-entry page before it creates a row, and both actions and the
 * autosave endpoint before they write one — so an entry holding only a photo is
 * created and saved like any other, instead of being thrown away as empty.
 */
export function isBlank(body: Json): boolean {
	return !hasMedia(body) && toLines(body).every((line) => line.trim().length === 0);
}

/**
 * The first `limit` characters or so, for a list.
 *
 * Cut at a word boundary when one is close enough to the limit to be worth
 * having; otherwise cut mid-word rather than throwing most of the excerpt away
 * on a single very long word.
 */
export function toExcerpt(body: Json, limit = 180): string {
	const text = toLines(body).join(' ').replace(/\s+/g, ' ').trim();

	if (text.length <= limit) {
		return text;
	}

	const cut = text.slice(0, limit);
	const lastSpace = cut.lastIndexOf(' ');
	const kept = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
	return `${kept.trimEnd()}…`;
}
