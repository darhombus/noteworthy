/**
 * The journal dialog's preview line: which of a font's faces it draws, whether
 * they are here, and fetching them for the journal's font as the dialog opens
 * and for a font the person taps (PRD 14, Section 2; docs/constraints.md,
 * "Journal fonts", "The picker").
 *
 * Only those faces are fetched, and only the Latin files the line's letters
 * need: nothing for Default, nothing for a font nobody asked for. The line is
 * drawn in a font only once every face it needs has loaded, so it is never
 * drawn half in the fallback.
 *
 * **A face that failed stays failed for the rest of the document.** Once a
 * download of a face has failed, `document.fonts.load()` rejects for it at once,
 * even with the connection back, and a new `FontFace` for the same file loads
 * but is not drawn: the stylesheet's own face, failed, still wins (Chromium,
 * measured 2026-10-26). Until the page is loaded again, that font draws in its
 * fallback here and on its journal's entries. So nothing is tried while the
 * browser says it is offline: that is the case a tap can avoid poisoning.
 */
import { FONT_FAMILY, type JournalFont } from './fonts';

/** The line, in parts: "quick" in bold and "lazy" in italic, so both faces show. */
export const PREVIEW = {
	before: 'The ',
	bold: 'quick',
	middle: ' brown fox jumps over the ',
	italic: 'lazy',
	after: ' dog.'
} as const;

export const PREVIEW_TEXT = Object.values(PREVIEW).join('');

/** What the preview shows for the font it was last asked about. */
export type PreviewState = 'ready' | 'loading' | 'failed';

/** The part of `document.fonts` this needs, so a test can stand in for it. */
export type Faces = Pick<FontFaceSet, 'check' | 'load'>;

/**
 * The faces the line draws, as `font` shorthands: regular, the semibold of
 * "quick" (the weight entries draw bold in), and the italic of "lazy". The size
 * does not choose a face; any will do. Where a font has no such face the
 * browser picks its nearest (OpenDyslexic's 700 for the semibold, the upright
 * file for Caveat's, Dancing Script's and OpenDyslexic's italic), and that is
 * the file asked for.
 */
export function previewFaces(font: Exclude<JournalFont, 'default'>): string[] {
	const family = `"${FONT_FAMILY[font]}"`;
	return [`16px ${family}`, `600 16px ${family}`, `italic 16px ${family}`];
}

/**
 * Whether the line can be drawn in `font` now, with nothing to fetch: Default,
 * or a font this document has already loaded (an entry page in it, or an
 * earlier tap). Only the Latin faces: the line has no other letters.
 */
export function previewReady(faces: Faces, font: JournalFont): boolean {
	return font === 'default' || previewFaces(font).every((face) => faces.check(face, PREVIEW_TEXT));
}

/**
 * Fetches what the line needs in `font`. `'failed'` if the browser is offline
 * (nothing is tried; see above), if a face failed, or if no face answered to
 * the name at all, which would otherwise show the fallback as if it were the
 * font.
 */
export async function loadPreview(
	faces: Faces,
	font: JournalFont,
	online: boolean
): Promise<Exclude<PreviewState, 'loading'>> {
	if (font === 'default' || previewReady(faces, font)) {
		return 'ready';
	}
	if (!online) {
		return 'failed';
	}
	try {
		const loaded = await Promise.all(
			previewFaces(font).map((face) => faces.load(face, PREVIEW_TEXT))
		);
		return loaded.every((list) => list.length > 0 && list.every((face) => face.status === 'loaded'))
			? 'ready'
			: 'failed';
	} catch {
		return 'failed';
	}
}
