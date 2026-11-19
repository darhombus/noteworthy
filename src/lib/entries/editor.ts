/**
 * The TipTap editor, configured.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE IS BROWSER-ONLY, AND THAT IS ENFORCED BY HOW IT IS IMPORTED
 * ---------------------------------------------------------------------------
 * `new Editor()` reaches for `document` while it is constructing, so it cannot
 * run during server rendering. Nothing here imports it eagerly: `EntryEditor.svelte`
 * reaches this module through a dynamic `import()` inside `onMount`, which never
 * executes on the server and lands the whole of TipTap and ProseMirror in a
 * chunk the edit route asks for rather than in the bundle every page pays for.
 *
 * A static import would very probably also have worked — ProseMirror's
 * module-level code guards its own `navigator` and `document` reads, and this
 * file's extension list loads in bare Node today, which is exactly what
 * `document.test.ts` relies on. "Probably works" is the part that was not worth
 * having: it is a property of somebody else's package, it would change without
 * announcement in a patch release, and the failure mode is a 500 on the edit
 * page rather than anything a type checker would notice.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ENABLED, AND WHY THE LIST IS SHORT
 * ---------------------------------------------------------------------------
 * The extensions below are the toolbar's set and nothing else: undo, redo,
 * headings, bold, italic, strikethrough, highlight, bullet list, numbered list,
 * blockquote, link, and the photo, video and audio the Add media button inserts.
 * `$lib/entries/document.ts` holds the same vocabulary as plain data for the
 * server to check incoming documents against, and carries the reasoning for
 * every extension that is deliberately absent — read it there before adding one
 * here. `document.test.ts` builds the schema this file produces and fails if the
 * two lists disagree.
 *
 * The photo node is `./image-node`, the video and audio nodes are
 * `./player-node`, and the machinery that puts one there —
 * the queue, the placeholders, the paste and drop handling — is `./uploads`.
 * Both are only ever reached through this module, so they are in the chunk the
 * edit route loads and not in the bundle every page pays for.
 *
 * Four of StarterKit's own extensions are switched off:
 *
 *   `underline`  — new in StarterKit v3, and the one exclusion that would
 *                  otherwise arrive by upgrade rather than by decision.
 *   `code` and `codeBlock` — a journal is prose. More to the point, both are
 *                  reachable by input rule (`` `x` ``, ```` ```x ````) and
 *                  neither has a toolbar button, so somebody who triggered one
 *                  by accident would have no way to switch it off again.
 *   `horizontalRule` — same trap: `---` on its own line produces a node the
 *                  toolbar cannot remove.
 *
 * What stays without being in the toolbar is infrastructure rather than
 * formatting: `document`, `paragraph`, `text`, `hardBreak` (Shift+Enter),
 * `dropcursor`, `gapcursor`, `listKeymap` and `trailingNode`. None of them adds
 * a way to style a word.
 */
import {
	Editor,
	Extension,
	getSchema,
	rewriteUnknownContent,
	type ChainedCommands,
	type Extensions,
	type JSONContent
} from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import StarterKit from '@tiptap/starter-kit';
import type { MediaLinks } from '$lib/media/links';
import { betweenBlocksExtension } from './between-blocks';
import { collapseExtension, collapseSummary } from './collapse';
import { HEADING_LEVELS, parseDocument } from './document';
import { gapCursorExtension } from './gap-cursor';
import { ImageNode, type ImageNodeOptions } from './image-node';
import { playerIdentityExtension } from './player-identity';
import { AudioNode, VideoNode } from './player-node';
import { pointerSelectionExtension } from './pointer-selection';
import { selectionTintExtension } from './selection-tint';
import { textEditingKeys } from './text-keys';
import { createUploads, uploadsExtension, type Anchor, type Uploads } from './uploads';
import type { ToolbarState, WordMark } from './toolbar';
import type { Json } from '$lib/types/database';

/**
 * Mod-K, which is the one shortcut in the toolbar that TipTap does not ship.
 *
 * It cannot be a command, because there is nothing for a command to do: a link
 * needs a URL, and asking for one is a dialog. So the extension's only job is to
 * swallow the key and call back out to whoever opened the editor. Returning
 * `true` is what stops the browser acting on it — Ctrl+K focuses the address bar
 * in Chrome and opens search in Firefox, and a person who pressed it meaning to
 * make a link would otherwise lose the page.
 *
 * Built per editor rather than as a module-level constant because it closes over
 * that editor's callback.
 */
function linkShortcut(onRequestLink: () => void): Extension {
	return Extension.create({
		name: 'noteworthyLinkShortcut',
		addKeyboardShortcuts() {
			return {
				'Mod-k': () => {
					onRequestLink();
					return true;
				}
			};
		}
	});
}

/** Characters a word is made of. Letters and digits in any script, plus the
 * three marks that sit *inside* words rather than ending them: an apostrophe in
 * "don't", a curly one in "don’t", and the hyphen in "well-known". A full stop
 * is not here, so the cursor in "morning." bolds the word and not the stop. */
const WORD_CHARACTER = /[\p{L}\p{N}_'’-]/u;

/** At least one letter or digit, so a stray hyphen is not treated as a word. */
const HAS_SUBSTANCE = /[\p{L}\p{N}]/u;

/**
 * The word surrounding `offset` in `text`, as a half-open range, or `null`.
 *
 * Pure and exported so it can be tested against the awkward positions directly
 * — between two words, at either end of the text, on punctuation — rather than
 * only through an editor.
 *
 * ---------------------------------------------------------------------------
 * STRICTLY INSIDE, AND THAT BOUNDARY WAS PAID FOR
 * ---------------------------------------------------------------------------
 * There has to be a word character on *both* sides of the caret. "mor|ning" is
 * inside the word; "|morning" and "morning|" are not, and neither is a caret on
 * a space.
 *
 * The first attempt counted a caret touching a word on either side, which is
 * what Word does and reads as the more generous rule. It breaks the commonest
 * gesture there is. Press Bold, type "important", press Bold again to stop —
 * that second press lands at the end of the word just typed, and the generous
 * rule takes it to mean "unbold important" rather than "stop bolding". Three
 * separate tests written long before this change all failed on exactly that, in
 * sequences that had looked entirely ordinary.
 *
 * Requiring both sides keeps the two gestures apart, because they never happen
 * at the same caret: formatting an existing word puts the caret in the middle of
 * it, and arming the next keystroke puts the caret where there is no word yet.
 * The cost is that clicking exactly at a word's edge and pressing Bold does
 * nothing to the word — one arrow key away from working, and the safer failure.
 */
export function wordAround(text: string, offset: number): { from: number; to: number } | null {
	if (offset <= 0 || offset >= text.length) {
		return null;
	}

	if (!WORD_CHARACTER.test(text[offset - 1]) || !WORD_CHARACTER.test(text[offset])) {
		return null;
	}

	let from = offset;
	let to = offset;
	while (from > 0 && WORD_CHARACTER.test(text[from - 1])) {
		from -= 1;
	}
	while (to < text.length && WORD_CHARACTER.test(text[to])) {
		to += 1;
	}

	return from !== to && HAS_SUBSTANCE.test(text.slice(from, to)) ? { from, to } : null;
}

/**
 * The document range of the word the cursor is in, or `null` if it is not in one.
 *
 * The text is taken with `textBetween(..., '\n', '\n')` rather than off
 * `parent.textContent`, and the leaf argument is the reason. A `hardBreak` is a
 * node one position wide that contributes nothing to `textContent`, so in a
 * paragraph containing one, character offsets and document positions drift apart
 * by one from the break onwards — and every range computed after it would be off
 * by a character. Giving each leaf a single `\n` keeps the two in step, and `\n`
 * is not a word character, so a break also correctly ends a word.
 */
function wordRangeAt(editor: Editor): { from: number; to: number } | null {
	const { $from, from } = editor.state.selection;
	if (!$from.parent.isTextblock) {
		return null;
	}

	const start = $from.start();
	const text = editor.state.doc.textBetween(start, $from.end(), '\n', '\n');
	const word = wordAround(text, from - start);

	return word === null ? null : { from: start + word.from, to: start + word.to };
}

const TOGGLE: Record<WordMark, (chain: ChainedCommands) => ChainedCommands> = {
	bold: (chain) => chain.toggleBold(),
	italic: (chain) => chain.toggleItalic(),
	strike: (chain) => chain.toggleStrike(),
	highlight: (chain) => chain.toggleHighlight()
};

/**
 * Turns a mark on or off over the word the cursor is in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN `chain().toggleBold()`
 * ---------------------------------------------------------------------------
 * ProseMirror's `toggleMark` acts on the selection, and a collapsed cursor
 * selects nothing. What it does instead is set a *stored mark*, which changes
 * the formatting of the next character typed and leaves the text alone. So with
 * the cursor inside a word, pressing Bold appeared to do nothing — and pressing
 * it again on already-bold text appeared to do nothing either, because removing
 * a mark from an empty range is just as empty. The toolbar was reading the state
 * correctly the whole time; only the commands were not acting on anything.
 *
 * So when the selection is collapsed, the word under the cursor is selected, the
 * toggle runs against that, and the cursor is put back where it was. Both
 * directions come free: `toggleMark` over a range that is entirely marked
 * removes the mark, and over one that is not, adds it.
 *
 * The cursor is restored rather than left holding the word. Positions cannot
 * have moved — a mark changes no lengths — so the old offset is still the same
 * place, and somebody who pressed Bold mid-sentence gets to keep typing from
 * where they were.
 *
 * With the cursor somewhere that is not a word — on a space, on an empty line —
 * there is nothing to act on, and the stored-mark behaviour is exactly right:
 * that is the "press Bold, then type" gesture, and it still works.
 */
export function toggleMarkAcrossWord(editor: Editor, name: WordMark): void {
	const { selection } = editor.state;
	const word = selection.empty ? wordRangeAt(editor) : null;

	if (word === null) {
		TOGGLE[name](editor.chain().focus()).run();
		return;
	}

	TOGGLE[name](editor.chain().focus().setTextSelection(word))
		.setTextSelection(selection.from)
		.run();
}

/**
 * The same four toggles, bound to the keys TipTap already binds them to.
 *
 * Without this, Ctrl+B and the Bold button would disagree the moment the cursor
 * was collapsed — the button acting on the word and the shortcut still only
 * setting a stored mark. One command, two doors.
 *
 * `priority` above the default 100 is what makes these win: each extension gets
 * its own keymap plugin, ProseMirror asks them in order, and the first to handle
 * a key keeps it.
 *
 * ---------------------------------------------------------------------------
 * WHY BLOCKQUOTE IS IN THIS LIST
 * ---------------------------------------------------------------------------
 * It looks like it does not belong, and leaving it out breaks Ctrl+Shift+B.
 *
 * prosemirror-keymap does not only look up the combination that was pressed. For
 * a single-character key with Shift held it tries the binding *without* Shift as
 * a fallback, because on many layouts the shifted character is how you type the
 * unshifted one. So Ctrl+Shift+B is looked up as `Ctrl-Shift-b` first and then
 * as `Ctrl-b` — and `Ctrl-b` is precisely what `Mod-b` binds here. Being first
 * in the order, this keymap answered Ctrl+Shift+B with Bold and Blockquote never
 * saw the key.
 *
 * Both lookups happen inside one plugin, and the fallback runs whether or not
 * the first lookup existed — so a `Mod-Shift-b` binding that returned `false` to
 * pass the key along would simply fall through to Bold in the next line. The
 * only way to keep the key is to take it and do the right thing with it.
 *
 * So: whichever keymap owns `Mod-b` must also own `Mod-Shift-b`. Nothing else in
 * the toolbar has this problem, because no other pair of its shortcuts differ by
 * Shift alone. `e2e/entry-toolbar.e2e.ts` presses both and would catch it again.
 */
function wordMarkShortcuts(): Extension {
	return Extension.create({
		name: 'noteworthyWordMarks',
		priority: 1000,
		addKeyboardShortcuts() {
			const bind = (name: WordMark) => (): boolean => {
				toggleMarkAcrossWord(this.editor, name);
				return true;
			};

			return {
				'Mod-b': bind('bold'),
				'Mod-i': bind('italic'),
				'Mod-Shift-s': bind('strike'),
				'Mod-Shift-h': bind('highlight'),

				// Not a mark, and not optional — see above.
				'Mod-Shift-b': () => this.editor.chain().focus().toggleBlockquote().run()
			};
		}
	});
}

/**
 * The extension list, separately from the editor, so that a test can build the
 * ProseMirror schema from it in Node without constructing an editor.
 *
 * `linkShortcut` is deliberately not in here: it contributes nothing to the
 * schema, and keeping it out means this function stays callable with no
 * arguments and no editor, which is what `document.test.ts` needs. The same is
 * true of the media options: they change how a photo is *drawn* and which
 * pasted paths are accepted, and nothing about the schema, so the drift check
 * can build one without a page.
 */
export function entryExtensions(media: Partial<ImageNodeOptions> = {}): Extensions {
	const options = { links: media.links ?? null, owner: media.owner ?? null };
	return [
		ImageNode.configure(options),
		VideoNode.configure(options),
		AudioNode.configure(options),
		StarterKit.configure({
			heading: { levels: [...HEADING_LEVELS] },
			code: false,
			codeBlock: false,
			horizontalRule: false,
			underline: false,
			link: {
				// The editor is for editing. A click inside it places the cursor;
				// following the link is what the read view is for.
				openOnClick: false,

				// Typing a URL and then a space turns it into a link. On, because a
				// URL in the middle of a sentence is a link whether or not anybody
				// reached for the toolbar, and because it is undoable: Mod-Z
				// immediately after the space takes the link off and leaves the text.
				autolink: true,

				// THE ANSWER TO "does pasting a URL over selected text link it?":
				// yes. Selecting "the forecast", pasting a URL and getting a link
				// on those words is what every editor does and what people expect;
				// the alternative is replacing the words they selected with a raw
				// URL, which is almost never the intent and is more work to undo.
				// With nothing selected, a pasted URL still pastes as text and
				// `autolink` picks it up.
				linkOnPaste: true,

				// `target` and `rel` are set on the rendered anchor and are not kept
				// in the stored document — the server's sanitiser keeps `href` and
				// nothing else, so how a link opens stays a decision of whatever
				// renders it rather than a value frozen into every old entry.
				HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
			}
		}),
		// `multicolor` is left off, which is what makes this a highlight rather
		// than a colour picker: the mark carries no `color` attribute at all.
		Highlight
	];
}

/** One empty paragraph: what the editor would have made of nothing anyway. */
const BLANK: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/** Built once. `getSchema` walks every extension, and nothing about it varies. */
let cachedSchema: ReturnType<typeof getSchema> | null = null;

function entrySchema(): ReturnType<typeof getSchema> {
	cachedSchema ??= getSchema(entryExtensions());
	return cachedSchema;
}

export type OpenedDocument = {
	/** What to hand TipTap. */
	content: JSONContent;
	/**
	 * Node and mark types removed because this build has no extension for them.
	 * Empty in every ordinary case; non-empty means somebody has to be told.
	 */
	dropped: string[];
};

/**
 * A stored body as TipTap wants to receive it, with anything it cannot represent
 * taken out first.
 *
 * ---------------------------------------------------------------------------
 * WHY THE STRIPPING IS DONE HERE AND NOT BY enableContentCheck
 * ---------------------------------------------------------------------------
 * A row can hold a node this build has no extension for. `entries.content` is
 * writable by its owner through PostgREST, and — the case that will actually
 * happen — the vocabulary changes over time: the moment an image node exists, an
 * entry containing one opened by a tab still running the previous build is a
 * document the schema cannot parse.
 *
 * Handed such a document, `schema.nodeFromJSON` throws. TipTap catches that and,
 * in 3.31, recovers by calling `createNodeFromContent("")` — an *empty string* —
 * so the editor opens completely blank. Every paragraph the schema understood
 * perfectly well goes with the one it did not. `enableContentCheck: true` does
 * not change this: it makes the throw observable through `onContentError`, but
 * the fallback document it then builds comes from the same call, so the person
 * is told about a document that is empty either way. That was checked against
 * the installed version rather than taken from the guide, which describes the
 * fallback as stripped.
 *
 * So the stripping happens before TipTap sees the content, in two passes:
 *
 *   `rewriteUnknownContent` is TipTap's own, keyed off the real schema, and it
 *   reports what it removed — which is the half this needs that a hand-written
 *   walk would have to reinvent. It is given a clone, because it rewrites in
 *   place.
 *
 *   `parseDocument` then repairs what stripping can break. Removing the only
 *   `listItem` from a list leaves a `bulletList` with no children, which is not
 *   a valid document and would put us straight back where we started. That
 *   function already drops containers left empty, and already defines this app's
 *   vocabulary — `document.test.ts` asserts it matches the schema exactly. On an
 *   undamaged document it changes nothing.
 *
 * `fallbackToParagraph` is off. Left on, an unknown node carrying block children
 * becomes a paragraph holding those children — a paragraph containing list items,
 * which is invalid in a different way. Dropping the node whole is both the safe
 * reading and the literal one: keep what the schema recognises, lose what it
 * does not.
 */
export function forEditor(body: Json, owner: string): OpenedDocument {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return { content: BLANK, dropped: [] };
	}

	const { json, rewrittenContent } = rewriteUnknownContent(
		structuredClone(body) as JSONContent,
		entrySchema(),
		{ fallbackToParagraph: false }
	);

	const dropped = [...new Set(rewrittenContent.map((entry) => entry.unsupported))].sort();

	// `json` is null only when the document node itself was unrecognised, which
	// cannot happen for a row that passed the column's CHECK — but it is typed
	// as nullable and an empty editor is the right answer if it ever is.
	// The same vocabulary the server keeps, including whose photos may be in it:
	// what the editor opens is then exactly what a save would store.
	const repaired = json === null ? null : parseDocument(JSON.stringify(json), { owner });
	const blocks = repaired === null ? null : (repaired as { content?: Json }).content;

	if (!Array.isArray(blocks) || blocks.length === 0) {
		return { content: BLANK, dropped };
	}

	return { content: repaired as JSONContent, dropped };
}

/**
 * The toolbar's state as plain booleans, read fresh off the editor.
 *
 * A snapshot rather than a live handle because TipTap's `isActive()` is a method
 * call against a mutable editor — nothing about it is reactive, so a Svelte
 * template calling it would render once and then never change again. The shape
 * itself lives in `./toolbar`, which has no imports; the note there explains why
 * that separation is load-bearing rather than tidiness.
 */
export function readToolbarState(editor: Editor): ToolbarState {
	const media = collapseSummary(editor.state);
	return {
		// `can()` runs the command against a throwaway transaction and reports
		// whether it would have done anything, which is how the two history
		// buttons know to look spent.
		canUndo: editor.can().undo(),
		canRedo: editor.can().redo(),
		heading1: editor.isActive('heading', { level: 1 }),
		heading2: editor.isActive('heading', { level: 2 }),
		bold: editor.isActive('bold'),
		italic: editor.isActive('italic'),
		strike: editor.isActive('strike'),
		highlight: editor.isActive('highlight'),
		bulletList: editor.isActive('bulletList'),
		orderedList: editor.isActive('orderedList'),
		blockquote: editor.isActive('blockquote'),
		link: editor.isActive('link'),
		media: media.media > 0,
		allCollapsed: media.media > 0 && media.collapsed === media.media
	};
}

export { setAllMediaCollapsed } from './collapse';

/**
 * Replaces the whole document with `content` and forgets the undo history, so
 * undo cannot bring back what was replaced: "Use the saved version".
 *
 * One transaction, kept out of the history, so the uploads plugin and the rest
 * map their state through it as through any edit. That alone still leaves the
 * earlier steps in the history: measured against the installed ProseMirror,
 * undo then did nothing visible but still used up a press, and the depth stayed
 * at 1. So the history plugin is then taken out of the state and put back,
 * which `reconfigure` does by dropping its state and making it afresh: depth
 * 0. Every other plugin keeps its state across a `reconfigure`.
 *
 * `updateState` is not a transaction, so TipTap reports nothing for it; the
 * caller reads the document afterwards.
 */
export function replaceDocument(editor: Editor, content: JSONContent): void {
	const { state } = editor;
	const doc = state.schema.nodeFromJSON(content);
	editor.view.dispatch(
		state.tr.replaceWith(0, state.doc.content.size, doc.content).setMeta('addToHistory', false)
	);
	const plugins = editor.state.plugins;
	// `history()` from prosemirror-history is keyed `history$`. A plugin's key
	// string is not in ProseMirror's types, so it is read as what it is at run
	// time; `editor.test.ts` checks the depth comes out at 0, so a ProseMirror
	// that changed this would fail there rather than quietly keep the history.
	const withoutHistory = plugins.filter(
		(plugin) => !(plugin as unknown as { key: string }).key.startsWith('history$')
	);
	editor.view.updateState(
		editor.state.reconfigure({ plugins: withoutHistory }).reconfigure({ plugins })
	);
}

export type EntryEditorOptions = {
	element: HTMLElement;
	/** Set on the editable element, for the toolbar's `aria-controls`. */
	elementId: string;
	content: JSONContent;
	/** The id of the field's `<label>`, since a contenteditable has no `for`. */
	labelledBy: string;
	describedBy?: string;
	invalid?: boolean;
	onUpdate: (doc: JSONContent) => void;
	/** Every transaction, including ones that only moved the cursor. */
	onTransaction: (editor: Editor) => void;
	/** Mod-K, and anything else that needs a dialog rather than a command. */
	onRequestLink: () => void;
	/** Whose paths may be pasted. The server makes the paths uploads go to. */
	owner: string;
	/** The page's signed links, which the photo views read and refresh. */
	links: MediaLinks;
	/** True while a file is waiting or uploading: leaving the page would lose it. */
	onUploadsBusy: (busy: boolean) => void;
	/** The allowance, whenever an upload learns it, for the Add media menu. */
	onRemaining: (bytes: number) => void;
};

export type EntryEditorHandle = {
	editor: Editor;
	/** Files on their way in: the picker, a paste and a drop all end up here. */
	uploads: Uploads;
};

export function createEntryEditor(options: EntryEditorOptions): EntryEditorHandle {
	// The plugin has to be in the extension list before the editor exists, and the
	// queue needs the editor to insert into, so the two meet through this: the
	// plugin asks for whatever `uploads` is when it draws or takes a drop.
	let uploads: Uploads | null = null;

	const editor = new Editor({
		element: options.element,
		extensions: [
			...entryExtensions({ links: options.links, owner: options.owner }),
			wordMarkShortcuts(),
			linkShortcut(options.onRequestLink),
			// Ctrl+Left/Right beside media, Ctrl+Up/Down by paragraph, Ctrl+Home to media.
			textEditingKeys(),
			// The gap cursor's caret, and Enter and Backspace at it.
			gapCursorExtension(),
			// A selection ending beside media, kept through undo and document changes.
			betweenBlocksExtension(),
			// A drag over media, and a click on a selection.
			pointerSelectionExtension(),
			uploadsExtension({
				onFiles: (files: File[], anchor: Anchor) => uploads?.add(files, anchor),
				element: (id: string) => uploads?.element(id) ?? null
			}),
			// Which media is collapsed. Not in `entryExtensions`: it adds nothing to
			// the schema, and nothing about it is stored (see `./collapse`).
			collapseExtension(),
			// Which video or audio item is which, so a moved player keeps its element
			// (see `./player-identity`).
			playerIdentityExtension(),
			// Media inside a text selection or a select-all, tinted (see `./selection-tint`).
			selectionTintExtension()
		],
		content: options.content,
		editorProps: {
			attributes: {
				// ProseMirror's own element is the thing a person focuses and types
				// into, so the labelling has to live on it rather than on a wrapper.
				// `contenteditable` alone is announced as an editing region with no
				// name; `role="textbox"` plus `aria-labelledby` makes it the "Entry"
				// field, which is also what lets the e2e specs find it by its label.
				id: options.elementId,
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-labelledby': options.labelledBy,
				...(options.describedBy === undefined ? {} : { 'aria-describedby': options.describedBy }),
				...(options.invalid === true ? { 'aria-invalid': 'true' } : {}),
				class: 'entry-prose entry-edit prose max-w-none focus:outline-none'
			}
		},
		onUpdate: ({ editor }) => options.onUpdate(editor.getJSON()),
		onTransaction: ({ editor }) => options.onTransaction(editor)
	});

	uploads = createUploads(editor, {
		links: options.links,
		onBusy: options.onUploadsBusy,
		onRemaining: options.onRemaining
	});

	return { editor, uploads };
}
