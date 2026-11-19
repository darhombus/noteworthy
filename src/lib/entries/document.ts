/**
 * The vocabulary an entry body is allowed to use, and the gate everything
 * arriving from a browser goes through.
 *
 * ---------------------------------------------------------------------------
 * WHY A SANITISER AND NOT A VALIDATOR
 * ---------------------------------------------------------------------------
 * The editor posts its document as JSON. The column's CHECK constraint asks
 * three questions of it — object, `type: "doc"`, `content` is an array — and
 * nothing else, so a payload that satisfies those three is stored whatever is
 * underneath. That is fine as a database invariant and useless as a trust
 * boundary, because four things read the document afterwards and each is hurt
 * differently by junk in it:
 *
 *   `fn_compute_word_count` and `extract_tiptap_text` walk for `type: "text"`
 *   nodes. Text carried anywhere else counts as zero words and is never found
 *   by search, and nothing on screen says so.
 *
 *   TipTap reopens it. A node its schema does not know is dropped on open, so
 *   a body could store one shape and edit as another.
 *
 *   The read view will eventually render it as HTML. An `href` is the one
 *   attribute in this whole vocabulary that becomes a URL the browser will
 *   follow, which makes `javascript:` a stored-XSS hole waiting for the render
 *   layer to arrive. It is refused here, now, rather than in whichever
 *   component ends up drawing the link.
 *
 * So this module rebuilds the document rather than approving it: it walks the
 * incoming tree, keeps the nodes, marks and attributes named below, and drops
 * everything else. In normal operation nothing is ever dropped — the editor's
 * schema is exactly this vocabulary, and `entryExtensions()` is checked against
 * it by `document.test.ts`. Anything this function removes came from a client
 * that was not the editor.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT IN THE VOCABULARY
 * ---------------------------------------------------------------------------
 * TipTap ships extensions for font family, font size, text colour, alignment,
 * underline, superscript, subscript and tables, and the previous version of
 * this app had all of them. None is here, and none should be added:
 *
 *   Per-entry fonts, sizes and colours make a journal look like eight different
 *   documents a year later, and they fight the app's own typography rather than
 *   adding to it.
 *   Alignment has no use in prose.
 *   Underline means "link" on the web. Offering it as a style teaches people to
 *   produce text that looks clickable and is not.
 *   Superscript, subscript and tables are here-because-the-library-offers-them.
 *   Nobody journals with them.
 *
 * `highlight` is a single mark with no `color` attribute, by the same reasoning:
 * a highlight button is one decision, a highlight colour picker is text colour
 * wearing a hat.
 *
 * Adding a node or mark means adding it in three places that must agree — here,
 * `entryExtensions()`, and the toolbar — and `document.test.ts` fails if the
 * first two drift apart. That is the intended amount of friction.
 *
 * ---------------------------------------------------------------------------
 * MEDIA, AND WHY THE SANITISER NOW NEEDS TO KNOW WHO IS WRITING
 * ---------------------------------------------------------------------------
 * A photo is an `image` node carrying a storage path — `<user id>/<uuid>.<ext>`
 * — in its own `path` attribute, and never a URL. There is deliberately no
 * `src`: a path that ended up in an attribute a browser treats as an address
 * would be a link to nowhere at best, and the one attribute an old renderer
 * might follow at worst. The page turns each path into a signed URL when it
 * renders (`$lib/media/sign.server`).
 *
 * The path must be in the writer's own folder, which is why `parseDocument`
 * takes the owner: an entry must not be able to point at somebody else's file,
 * or at anything outside the bucket. A node whose path fails is dropped whole,
 * like a link whose href fails is dropped as a mark — there is nothing left of
 * a photo without its file.
 *
 * Photo, video and audio are three node types — `image`, `video` and `audio` —
 * rather than one `media` node with a kind attribute. The reason is the
 * deploy. A tab still running the previous build opens a newer entry through
 * `forEditor`, whose stripping is keyed on node *types*: an unknown type is
 * taken out and the person is told. An unknown *attribute value* is not
 * something it can see, so a `media` node with `kind: "video"` would open in an
 * older tab as a broken photo, and its sanitiser would then drop or mangle it
 * without a word. With a type per kind, every new kind is announced by the
 * machinery that already exists. The renderers differ per kind anyway.
 *
 * `width` and `height` are the stored file's own pixel size, written once when
 * it is uploaded, so that the page can reserve the photo's or video's space
 * before it loads. They are not a display size — there is no choosing one — and
 * a node without them still renders, only without the reserved space. Audio has
 * no picture and carries neither.
 */
import { hasExtensionFor, isOwnMediaPath } from '$lib/media/paths';
import type { MediaKind } from '$lib/media/types';
import type { Json } from '$lib/types/database';
import type { EntryBody } from './body';

/**
 * What the sanitiser has to know about whoever is writing.
 *
 * `owner` is the writer's user id — `event.locals.user.id` on the server, and
 * the same id handed to the editor in the browser. Required rather than
 * optional, so that no call site can forget it and quietly accept anybody's
 * paths.
 */
export type SanitizeContext = { owner: string };

/**
 * A ceiling on the JSON, measured before parsing.
 *
 * Roughly a quarter of a megabyte, which is some tens of thousands of words of
 * prose once TipTap's structure is counted — far past any entry somebody writes
 * and far short of anything that makes the parse itself the problem. Checked on
 * the string rather than after `JSON.parse`, so a payload designed to be
 * expensive to parse is refused without being parsed.
 */
export const MAX_DOCUMENT_CHARS = 262_144;

/**
 * How deep the tree may nest before the walk stops descending.
 *
 * Lists inside lists inside blockquotes are the only real source of depth here
 * and bottom out in single figures. The limit exists so that a hand-made
 * payload cannot make the recursion itself the attack.
 */
const MAX_DEPTH = 24;

/** The protocols a link may use. Everything else — `javascript:` above all. */
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Normalises one attribute value, or returns `undefined` to drop it.
 *
 * Dropping rather than rejecting the whole node is deliberate: an attribute
 * this function refuses is a detail of presentation, and losing the sentence it
 * was attached to would be a far worse outcome than losing the heading level.
 * The one attribute that cannot simply be dropped is `href`, and `MARKS` says
 * so separately.
 */
type AttrRule = (value: unknown, context: SanitizeContext) => Json | undefined;

/**
 * Headings run h1–h2, and the toolbar offers exactly those two.
 *
 * Three was the first guess and two is the answer. A heading in a journal entry
 * separates "the morning" from "the evening"; a third level is document
 * structure, and an entry that needs document structure is really several
 * entries. Two also keeps the toolbar's heading control to two buttons, which is
 * what lets the whole row fit a phone.
 */
export const HEADING_LEVELS = [1, 2] as const;

/**
 * Clamped into range rather than reset.
 *
 * A level 4 heading pasted in from somewhere with deeper outlines is still a
 * heading, and the nearest thing this vocabulary has to it is the deepest one it
 * offers. Sending it back to h1 would promote a sub-sub-heading above the
 * heading it sits under, which reads as a mistake rather than as a simplification.
 */
const headingLevel: AttrRule = (value) => {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return HEADING_LEVELS[0];
	}
	return Math.min(Math.max(value, HEADING_LEVELS[0]), HEADING_LEVELS[HEADING_LEVELS.length - 1]);
};

const listStart: AttrRule = (value) =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1_000_000
		? value
		: 1;

/**
 * An absolute http, https or mailto URL, or `null`.
 *
 * `new URL()` without a base throws on a relative reference, which is the right
 * answer here — a link in a journal entry points out at the web, and a relative
 * one would resolve against whatever page happened to render it. Reading
 * `.protocol` off the parsed URL rather than matching the string is what makes
 * `java\tscript:` and friends uninteresting: the parser has already resolved
 * the escapes by the time the protocol is read.
 *
 * Exported because the link dialog asks the same question before it offers to
 * save a URL. One definition, so that what the toolbar accepts and what the
 * server keeps cannot drift into disagreeing — a dialog that accepted a href
 * the sanitiser then silently dropped would look like the link had been made
 * and lost.
 *
 * Note that this is the strict half. Typing "example.com" into the dialog is
 * meant to work, and making it work is the dialog's job: it adds a scheme and
 * asks again. Guessing schemes inside a trust boundary is how `javascript:`
 * becomes `https://javascript:`, or worse, gets waved through.
 */
export function normalizeHref(value: unknown): string | null {
	if (typeof value !== 'string') {
		return null;
	}

	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 2048) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}

	return LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
}

const linkHref: AttrRule = (value) => normalizeHref(value) ?? undefined;

/**
 * A storage path for a file of `kind`: the one shape, in the writer's own
 * folder, and with an extension that kind is stored under. Exported so the
 * editor's paste rules ask the same question.
 *
 * The extension check is per node type, so a `video` node cannot point at a
 * photo, nor an `audio` node at a `.mov`. `webm` passes for both video and
 * audio, because it holds either; the node type is what says which it is.
 */
export function isOwnPathFor(kind: MediaKind, value: unknown, owner: string): value is string {
	return typeof value === 'string' && isOwnMediaPath(value, owner) && hasExtensionFor(value, kind);
}

/** A photo's path. The name the image node's paste rule has always used. */
export function isOwnImagePath(value: unknown, owner: string): value is string {
	return isOwnPathFor('image', value, owner);
}

const pathOf =
	(kind: MediaKind): AttrRule =>
	(value, { owner }) =>
		isOwnPathFor(kind, value, owner) ? value : undefined;

/**
 * The largest pixel size a stored photo may claim.
 *
 * GIF's own ceiling: a GIF is stored exactly as it arrived, and its header
 * cannot describe anything wider than 65,535. Everything else is re-encoded to
 * 2048 on its long side, so nothing this app writes comes near it.
 *
 * Exported because two other places read these attributes — the read view's
 * `render.ts` and the editor's node view — and three copies of a bound is three
 * chances for one of them to drift.
 */
export const MAX_DIMENSION = 65_535;

const dimension: AttrRule = (value) =>
	typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION
		? value
		: undefined;

type NodeRule = {
	attrs?: Record<string, AttrRule>;
	/** Attributes without which the node is not worth keeping. */
	requires?: readonly string[];
	/**
	 * `required` means the node is meaningless without children and is dropped
	 * when it sanitises to none — an empty `bulletList` is not a valid document
	 * and TipTap would refuse to reopen it. `optional` covers the nodes whose
	 * emptiness is content: a blank paragraph is a blank line somebody typed.
	 */
	children: 'none' | 'optional' | 'required';
};

/**
 * Every node type an entry body may contain.
 *
 * `text` is here so that this record is the whole vocabulary and the schema
 * check in `document.test.ts` can compare against it directly; the walk
 * handles it separately, because it is the only node carrying a string rather
 * than children.
 */
export const NODES: Readonly<Record<string, NodeRule>> = {
	doc: { children: 'optional' },
	paragraph: { children: 'optional' },
	heading: { attrs: { level: headingLevel }, children: 'optional' },
	blockquote: { children: 'required' },
	bulletList: { children: 'required' },
	orderedList: { attrs: { start: listStart }, children: 'required' },
	listItem: { children: 'required' },
	hardBreak: { children: 'none' },
	text: { children: 'none' },
	image: {
		attrs: { path: pathOf('image'), width: dimension, height: dimension },
		requires: ['path'],
		children: 'none'
	},
	/** `width` and `height` as for a photo: the picture's own size, when it could be read. */
	video: {
		attrs: { path: pathOf('video'), width: dimension, height: dimension },
		requires: ['path'],
		children: 'none'
	},
	/** No picture, so no size: a path and nothing else. */
	audio: {
		attrs: { path: pathOf('audio') },
		requires: ['path'],
		children: 'none'
	}
};

type MarkRule = {
	attrs?: Record<string, AttrRule>;
	/** Attributes without which the mark is not worth keeping. */
	requires?: readonly string[];
};

/** Every mark a text node may carry. */
export const MARKS: Readonly<Record<string, MarkRule>> = {
	bold: {},
	italic: {},
	strike: {},
	highlight: {},
	link: { attrs: { href: linkHref }, requires: ['href'] }
};

function sanitizeAttrs(
	value: unknown,
	rules: Record<string, AttrRule>,
	context: SanitizeContext
): Record<string, Json> | undefined {
	const raw =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};

	const kept: Record<string, Json> = {};
	for (const [name, rule] of Object.entries(rules)) {
		const normalised = rule(raw[name], context);
		if (normalised !== undefined) {
			kept[name] = normalised;
		}
	}

	return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * The marks on one text node, deduplicated.
 *
 * Two `bold` marks on the same node is not something TipTap produces and not
 * something the schema allows, so the first of each type wins rather than the
 * list being refused.
 */
function sanitizeMarks(value: unknown, context: SanitizeContext): Json[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const kept: Json[] = [];
	const seen = new Set<string>();

	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
			continue;
		}

		const raw = entry as Record<string, unknown>;
		const type = raw.type;
		if (typeof type !== 'string' || seen.has(type)) {
			continue;
		}

		const rule = MARKS[type];
		if (rule === undefined) {
			continue;
		}

		if (rule.attrs === undefined) {
			seen.add(type);
			kept.push({ type });
			continue;
		}

		const attrs = sanitizeAttrs(raw.attrs, rule.attrs, context);
		const satisfied = (rule.requires ?? []).every((name) => attrs?.[name] !== undefined);
		if (!satisfied) {
			// A link whose href did not survive is dropped as a mark; the text it
			// was wrapped around stays, unmarked. Losing the link is the point.
			continue;
		}

		seen.add(type);
		kept.push(attrs === undefined ? { type } : { type, attrs });
	}

	return kept;
}

function sanitizeNode(value: unknown, depth: number, context: SanitizeContext): Json | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return undefined;
	}

	const raw = value as Record<string, unknown>;
	const type = raw.type;
	if (typeof type !== 'string') {
		return undefined;
	}

	if (type === 'text') {
		const text = raw.text;
		// An empty text node is not a legal ProseMirror node and would stop the
		// document reopening, so it is dropped rather than carried.
		if (typeof text !== 'string' || text.length === 0) {
			return undefined;
		}
		const marks = sanitizeMarks(raw.marks, context);
		return marks.length > 0 ? { type: 'text', marks, text } : { type: 'text', text };
	}

	const rule = NODES[type];
	if (rule === undefined) {
		return undefined;
	}

	const node: Record<string, Json> = { type };

	if (rule.attrs !== undefined) {
		const attrs = sanitizeAttrs(raw.attrs, rule.attrs, context);
		if (attrs !== undefined) {
			node.attrs = attrs;
		}
		// A photo whose path did not survive is dropped whole. See MEDIA above.
		if (!(rule.requires ?? []).every((name) => attrs?.[name] !== undefined)) {
			return undefined;
		}
	}

	if (rule.children !== 'none') {
		const content = sanitizeChildren(raw.content, depth + 1, context);
		if (content.length === 0 && rule.children === 'required') {
			return undefined;
		}
		if (content.length > 0) {
			node.content = content;
		}
	}

	return node;
}

function sanitizeChildren(value: unknown, depth: number, context: SanitizeContext): Json[] {
	if (!Array.isArray(value) || depth > MAX_DEPTH) {
		return [];
	}

	const kept: Json[] = [];
	for (const child of value) {
		const node = sanitizeNode(child, depth, context);
		if (node !== undefined) {
			kept.push(node);
		}
	}
	return kept;
}

/**
 * A posted document, rebuilt from only what the vocabulary allows.
 *
 * Returns `null` when the payload is not a document at all — unparseable, too
 * large, or not shaped like one — which the caller turns into a form error. It
 * does not return `null` for a document that merely lost something to the walk:
 * that case is indistinguishable from a client that was not the editor, and the
 * right answer is to save what was legible rather than to refuse the save and
 * lose the rest. A document that sanitises down to nothing at all comes back as
 * an empty doc and is caught by the caller's own "write something" check, which
 * already runs on every save.
 *
 * Nor does it count media: the per-entry cap is `submittedBody`'s rule, applied
 * to what comes out of here. This function also repairs documents on their way
 * *into* the editor (`forEditor`), and an entry somebody pushed past the cap by
 * writing to the table directly should open with all its photos, not blank.
 */
export function parseDocument(raw: string, context: SanitizeContext): EntryBody | null {
	if (raw.length > MAX_DOCUMENT_CHARS) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return null;
	}

	const doc = parsed as Record<string, unknown>;
	if (doc.type !== 'doc' || !Array.isArray(doc.content)) {
		return null;
	}

	return { type: 'doc', content: sanitizeChildren(doc.content, 1, context) };
}
