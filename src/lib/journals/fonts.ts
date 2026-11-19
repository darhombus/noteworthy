/**
 * A journal's font and text size: the keys, what they mean, and which of a
 * font's faces an entry page draws (PRD 14; docs/constraints.md, "Journal
 * fonts").
 *
 * `journals.font` and `journals.text_size` hold keys, as `color` and `icon`
 * do. The database CHECKs the lists below; the app still maps anything it does
 * not know onto Default and Normal (`toFont`, `toTextSize`), for the reason
 * `appearance.ts` gives: a row is somebody's journal, and drawing it in the
 * default is right where failing the page is not.
 *
 * ---------------------------------------------------------------------------
 * WHERE EACH PART LIVES
 * ---------------------------------------------------------------------------
 * - The faces (`@font-face`, one per font, style and subset): `fonts.css`,
 *   generated from the Fontsource packages.
 * - The family each key draws in, its fallback, the sizes, and which elements
 *   take them: `layout.css`, ENTRY FONTS, keyed on `data-entry-font` and
 *   `data-entry-size`, which `entryType` writes on the element around an entry.
 * - The files a page preloads: `$lib/server/font-files`, from `facesDrawn`.
 *
 * Default is the entry font the app always had (`var(--font-serif)`; Georgia,
 * or New York on Apple devices) and downloads nothing. Default and Normal set
 * no custom property at all, so an entry in them is drawn by exactly the rules
 * that drew every entry before this file existed.
 */
import type { RenderBlock, RenderInline } from '$lib/entries/render';

export const JOURNAL_FONTS = [
	'default',
	'inter',
	'atkinson-hyperlegible',
	'opendyslexic',
	'lora',
	'merriweather',
	'literata',
	'eb-garamond',
	'jetbrains-mono',
	'caveat',
	'dancing-script'
] as const;

export type JournalFont = (typeof JOURNAL_FONTS)[number];

export const TEXT_SIZES = ['small', 'normal', 'big'] as const;

export type TextSize = (typeof TEXT_SIZES)[number];

/** Match the column defaults, so a row and a fresh form agree. */
export const DEFAULT_FONT: JournalFont = 'default';
export const DEFAULT_TEXT_SIZE: TextSize = 'normal';

export const FONT_LABELS: Record<JournalFont, string> = {
	default: 'Default',
	inter: 'Inter',
	'atkinson-hyperlegible': 'Atkinson Hyperlegible',
	opendyslexic: 'OpenDyslexic',
	lora: 'Lora',
	merriweather: 'Merriweather',
	literata: 'Literata',
	'eb-garamond': 'EB Garamond',
	'jetbrains-mono': 'JetBrains Mono',
	caveat: 'Caveat',
	'dancing-script': 'Dancing Script'
};

/**
 * The family each font's faces are declared under in `fonts.css`, for the
 * picker's preview, which asks for a font's faces by name
 * (`$lib/journals/font-preview`). The entry pages never read this: they draw
 * through `layout.css`, ENTRY FONTS, and `fonts.test.ts` holds the two to the
 * same names.
 */
export const FONT_FAMILY: Record<Exclude<JournalFont, 'default'>, string> = {
	inter: 'NW Inter',
	'atkinson-hyperlegible': 'NW Atkinson Hyperlegible Next',
	opendyslexic: 'NW OpenDyslexic',
	lora: 'NW Lora',
	merriweather: 'NW Merriweather',
	literata: 'NW Literata',
	'eb-garamond': 'NW EB Garamond',
	'jetbrains-mono': 'NW JetBrains Mono',
	caveat: 'NW Caveat',
	'dancing-script': 'NW Dancing Script'
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
	small: 'Small',
	normal: 'Normal',
	big: 'Big'
};

/**
 * The body's size in pixels. Everything else on the entry follows it: the
 * headings, spacing and figure margins are in `em`, the read-page title is
 * 30 × size / 18, the editor's minimum height is 16 lines of it.
 */
export const TEXT_SIZE_PX: Record<TextSize, number> = { small: 16, normal: 18, big: 20 };

/**
 * The title field on the edit and new-entry pages. Never under 16px: iOS Safari
 * zooms the page into any field smaller than that when it is focused.
 */
export const TITLE_FIELD_PX: Record<TextSize, number> = { small: 16, normal: 16, big: 18 };

export function isJournalFont(value: string): value is JournalFont {
	return (JOURNAL_FONTS as readonly string[]).includes(value);
}

export function isTextSize(value: string): value is TextSize {
	return (TEXT_SIZES as readonly string[]).includes(value);
}

/** A stored font, or Default if it is not one this app knows about. */
export function toFont(value: string | null | undefined): JournalFont {
	return typeof value === 'string' && isJournalFont(value) ? value : DEFAULT_FONT;
}

/** A stored size, or Normal if it is not one this app knows about. */
export function toTextSize(value: string | null | undefined): TextSize {
	return typeof value === 'string' && isTextSize(value) ? value : DEFAULT_TEXT_SIZE;
}

/**
 * The attributes for the element around an entry (the read page's `<article>`,
 * the edit and new-entry pages' form). `layout.css` does the rest.
 */
export function entryType(journal: { font: string; text_size: string }): {
	'data-entry-font': JournalFont;
	'data-entry-size': TextSize;
} {
	return {
		'data-entry-font': toFont(journal.font),
		'data-entry-size': toTextSize(journal.text_size)
	};
}

/**
 * The two character subsets shipped, exactly as each Fontsource package writes
 * them (`fonts.test.ts` checks every rule in `fonts.css` against these). A
 * browser downloads a subset's file only when a character in its range is
 * drawn, so Latin Extended — Kikuyu's ĩ and ũ, Polish ł, Turkish ş — costs
 * nothing until somebody writes one.
 */
export const LATIN_RANGE =
	'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
export const LATIN_EXT_RANGE =
	'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

function parseRange(range: string): [number, number][] {
	return range.split(',').map((part) => {
		const [from, to = from] = part.replace('U+', '').split('-');
		return [parseInt(from, 16), parseInt(to, 16)];
	});
}

const LATIN = parseRange(LATIN_RANGE);
const LATIN_EXT = parseRange(LATIN_EXT_RANGE);

function inRange(code: number, ranges: [number, number][]): boolean {
	return ranges.some(([from, to]) => code >= from && code <= to);
}

/**
 * Whether drawing `text` needs the Latin Extended file: a character in its range
 * that the Latin file does not cover. (A few, like U+0304, are in both; the
 * browser takes those from Latin, which every text loads anyway.)
 */
export function needsLatinExtended(text: string): boolean {
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (!inRange(code, LATIN) && inRange(code, LATIN_EXT)) {
			return true;
		}
	}
	return false;
}

/**
 * One kind of text a page draws in the journal's font: upright or italic,
 * regular or bold (anything heavier than 500 — the read-page title is 600,
 * headings 600 and 700, bold 600), and whether any of it is Latin Extended.
 */
export type Face = { italic: boolean; bold: boolean; extended: boolean };

export type EntryPage = 'read' | 'edit' | 'new';

/**
 * Every face an entry page draws in the journal's font, so the server can
 * preload each of them and nothing else.
 *
 * - The read page's title is semibold; "Untitled", in its place, is italic too.
 * - The edit and new-entry pages' title field is regular, and those pages draw
 *   regular text from the first keystroke, so upright regular is always there.
 * - In the body: bold and italic marks, headings (bold), blockquotes (italic,
 *   from the typography plugin), and everything else upright and regular.
 *
 * "This entry has no body." is the app's message, not the entry's text, and is
 * not drawn in the journal's font.
 */
export function facesDrawn(page: EntryPage, title: string | null, blocks: RenderBlock[]): Face[] {
	const faces = new Map<string, Face>();
	const add = (face: Face) => {
		faces.set(`${face.italic}/${face.bold}/${face.extended}`, face);
	};
	const text = (value: string, italic: boolean, bold: boolean) => {
		add({ italic, bold, extended: false });
		if (needsLatinExtended(value)) {
			add({ italic, bold, extended: true });
		}
	};

	if (page === 'read') {
		if (title) {
			text(title, false, true);
		} else {
			text('Untitled', true, true);
		}
	} else {
		text(title ?? '', false, false);
	}

	const inline = (items: RenderInline[], italic: boolean, bold: boolean) => {
		for (const item of items) {
			if (item.kind !== 'text') continue;
			text(
				item.text,
				italic || item.marks.some((mark) => mark.type === 'italic'),
				bold || item.marks.some((mark) => mark.type === 'bold')
			);
		}
	};
	const walk = (list: RenderBlock[], italic: boolean) => {
		for (const block of list) {
			switch (block.kind) {
				case 'paragraph':
					inline(block.inline, italic, false);
					break;
				case 'heading':
					inline(block.inline, italic, true);
					break;
				case 'blockquote':
					walk(block.blocks, true);
					break;
				case 'bulletList':
				case 'orderedList':
					for (const item of block.items) walk(item, italic);
					break;
			}
		}
	};
	walk(blocks, false);

	return [...faces.values()];
}
