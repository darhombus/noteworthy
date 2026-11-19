/**
 * The font files an entry page preloads.
 *
 * Each import names the same package path as its `@font-face` rule in
 * `$lib/journals/fonts.css`, so Vite gives both one hashed URL under
 * `/_app/immutable/assets/` and a preload is the face's own download, not a
 * second one. `fonts.test.ts` holds the two lists together.
 *
 * Server-only: a page receives the few URLs it preloads in its data, never this
 * table.
 *
 * A preload is written for every face the entry draws (`facesDrawn`) and for
 * nothing else: a face the page never uses is a download for nothing and a
 * console warning, and a face it uses but does not preload is fetched only once
 * the text is laid out, after the first paint, which is the reflow the preloads
 * exist to avoid (docs/constraints.md, "Journal fonts").
 */
import { toRenderTree } from '$lib/entries/render';
import {
	facesDrawn,
	toFont,
	type EntryPage,
	type Face,
	type JournalFont
} from '$lib/journals/fonts';
import type { Json } from '$lib/types/database';

import interNormal from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import interNormalExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2?url';
import interItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url';
import interItalicExt from '@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2?url';
import atkinsonNormal from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url';
import atkinsonNormalExt from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-normal.woff2?url';
import atkinsonItalic from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-italic.woff2?url';
import atkinsonItalicExt from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-ext-wght-italic.woff2?url';
import openDyslexicRegular from '@fontsource/opendyslexic/files/opendyslexic-latin-400-normal.woff2?url';
import openDyslexicBold from '@fontsource/opendyslexic/files/opendyslexic-latin-700-normal.woff2?url';
import loraNormal from '@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url';
import loraNormalExt from '@fontsource-variable/lora/files/lora-latin-ext-wght-normal.woff2?url';
import loraItalic from '@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url';
import loraItalicExt from '@fontsource-variable/lora/files/lora-latin-ext-wght-italic.woff2?url';
import merriweatherNormal from '@fontsource-variable/merriweather/files/merriweather-latin-wght-normal.woff2?url';
import merriweatherNormalExt from '@fontsource-variable/merriweather/files/merriweather-latin-ext-wght-normal.woff2?url';
import merriweatherItalic from '@fontsource-variable/merriweather/files/merriweather-latin-wght-italic.woff2?url';
import merriweatherItalicExt from '@fontsource-variable/merriweather/files/merriweather-latin-ext-wght-italic.woff2?url';
import literataNormal from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import literataNormalExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url';
import literataItalic from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url';
import literataItalicExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url';
import garamondNormal from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url';
import garamondNormalExt from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-normal.woff2?url';
import garamondItalic from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-italic.woff2?url';
import garamondItalicExt from '@fontsource-variable/eb-garamond/files/eb-garamond-latin-ext-wght-italic.woff2?url';
import monoNormal from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import monoNormalExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2?url';
import monoItalic from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-italic.woff2?url';
import monoItalicExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-italic.woff2?url';
import caveatNormal from '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url';
import caveatNormalExt from '@fontsource-variable/caveat/files/caveat-latin-ext-wght-normal.woff2?url';
import dancingNormal from '@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url';
import dancingNormalExt from '@fontsource-variable/dancing-script/files/dancing-script-latin-ext-wght-normal.woff2?url';

/**
 * A variable font: one file per style and subset, every weight inside it. With
 * no italic files the browser slants the upright ones, so italic text needs the
 * upright file.
 */
type Variable = {
	kind: 'variable';
	normal: { latin: string; extended: string };
	italic: { latin: string; extended: string } | null;
};

/** OpenDyslexic: whole-font files (no subsets), regular and bold, no italic. */
type Static = { kind: 'static'; regular: string; bold: string };

export const FONT_FILES: Record<Exclude<JournalFont, 'default'>, Variable | Static> = {
	inter: {
		kind: 'variable',
		normal: { latin: interNormal, extended: interNormalExt },
		italic: { latin: interItalic, extended: interItalicExt }
	},
	'atkinson-hyperlegible': {
		kind: 'variable',
		normal: { latin: atkinsonNormal, extended: atkinsonNormalExt },
		italic: { latin: atkinsonItalic, extended: atkinsonItalicExt }
	},
	opendyslexic: { kind: 'static', regular: openDyslexicRegular, bold: openDyslexicBold },
	lora: {
		kind: 'variable',
		normal: { latin: loraNormal, extended: loraNormalExt },
		italic: { latin: loraItalic, extended: loraItalicExt }
	},
	merriweather: {
		kind: 'variable',
		normal: { latin: merriweatherNormal, extended: merriweatherNormalExt },
		italic: { latin: merriweatherItalic, extended: merriweatherItalicExt }
	},
	literata: {
		kind: 'variable',
		normal: { latin: literataNormal, extended: literataNormalExt },
		italic: { latin: literataItalic, extended: literataItalicExt }
	},
	'eb-garamond': {
		kind: 'variable',
		normal: { latin: garamondNormal, extended: garamondNormalExt },
		italic: { latin: garamondItalic, extended: garamondItalicExt }
	},
	'jetbrains-mono': {
		kind: 'variable',
		normal: { latin: monoNormal, extended: monoNormalExt },
		italic: { latin: monoItalic, extended: monoItalicExt }
	},
	caveat: {
		kind: 'variable',
		normal: { latin: caveatNormal, extended: caveatNormalExt },
		italic: null
	},
	'dancing-script': {
		kind: 'variable',
		normal: { latin: dancingNormal, extended: dancingNormalExt },
		italic: null
	}
};

/** The files that draw `faces` in `font`, each once, in a stable order. Default: none. */
export function preloadsFor(font: JournalFont, faces: Face[]): string[] {
	if (font === 'default') {
		return [];
	}
	const files = FONT_FILES[font];
	const urls = new Set<string>();
	for (const face of faces) {
		if (files.kind === 'static') {
			urls.add(face.bold ? files.bold : files.regular);
			continue;
		}
		const style = face.italic && files.italic ? files.italic : files.normal;
		urls.add(style.latin);
		if (face.extended) {
			urls.add(style.extended);
		}
	}
	return [...urls].sort();
}

/**
 * What an entry page's load returns as `fontFiles`: the files to preload for
 * this journal's font, from what the page will draw. Default walks nothing.
 */
export function entryFontFiles(
	page: EntryPage,
	journal: { font: string },
	title: string | null,
	content: Json
): string[] {
	const font = toFont(journal.font);
	return font === 'default'
		? []
		: preloadsFor(font, facesDrawn(page, title, toRenderTree(content)));
}
