/**
 * What a collapsed media item says about itself, and the number that caps an
 * expanded one's height.
 *
 * Pure, so both are pinned in Node. The editor's rows are drawn by
 * `$lib/entries/collapse`; the cap itself is CSS (`.entry-media` in
 * `layout.css`), fed by `mediaRatio`.
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS FETCHED TO WRITE A ROW
 * ---------------------------------------------------------------------------
 * A row says the kind, and a length only where the player already knows one.
 * Players load with `preload="metadata"`, so a length is usually there by the
 * time anybody collapses anything, and when it is not the row says the kind
 * alone rather than asking for more of the file. A photo's thumbnail is the
 * photo's own link, which the expanded photo has usually already loaded.
 *
 * Audio is called "Audio", not "Recording". Nothing stored says whether a file
 * was recorded here or picked through *Audio file* — the path is a random id,
 * and the extension a recording gets (`.m4a`, `.ogg`, `.webm`) is one a picked
 * file can have too — and a row that called a song a recording would be
 * guessing. "Audio" is also what the player itself is labelled.
 */
import { formatClock } from './recording';
import type { MediaKind } from './types';

export const KIND_NAMES: Record<MediaKind, string> = {
	image: 'Photo',
	video: 'Video',
	audio: 'Audio'
};

/**
 * A row's two parts: the kind, and the length as a player shows one, or `null`
 * when there is none to show. A photo has no length; a player that has not
 * read its metadata reports `NaN`, and an unrepaired WebM `Infinity`.
 */
export function collapsedParts(
	kind: MediaKind,
	duration: number | null
): { name: string; length: string | null } {
	const known = kind !== 'image' && duration !== null && Number.isFinite(duration) && duration > 0;
	return {
		name: KIND_NAMES[kind],
		length: known ? formatClock(duration * 1000) : null
	};
}

/** The row as it reads on screen: "Photo", "Video · 0:42". */
export function collapsedLabel(kind: MediaKind, duration: number | null): string {
	const { name, length } = collapsedParts(kind, duration);
	return length === null ? name : `${name} · ${length}`;
}

/**
 * The icons on a media item's own controls, drawn like the toolbar's: strokes
 * on a 24-unit grid, `currentColor`.
 *
 * Here rather than in `$lib/entries/collapse`, which builds them into the
 * editor's figures, because the edit page draws the same collapse button before
 * the editor has arrived (`EntryEditMedia.svelte`), and that module imports
 * TipTap. This one imports nothing that does.
 */
export const FOLD_ICONS = {
	image: [
		'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1',
		'm3 16 5-5 5 5',
		'M15.5 9.5h.01'
	],
	video: [
		'M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2',
		'm16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11'
	],
	audio: [
		'M9 18V5l12-2v13',
		'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
		'M18 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6'
	],
	expand: ['m6 9 6 6 6-6'],
	collapse: ['m18 15-6-6-6 6']
} as const satisfies Record<string, readonly string[]>;

/** The custom property the height cap reads. See `.entry-media` in `layout.css`. */
export const MEDIA_RATIO_PROPERTY = '--media-ratio';

/**
 * A picture's width over its height, as the cap wants it, or `null` when the
 * size is not known — which leaves the cap to its fallback.
 *
 * A number rather than `w / h` because it is multiplied inside `calc()`, where
 * a ratio is not a value.
 */
export function mediaRatio(width: number | null, height: number | null): string | null {
	if (width === null || height === null || !(width > 0) || !(height > 0)) {
		return null;
	}
	return String(width / height);
}
