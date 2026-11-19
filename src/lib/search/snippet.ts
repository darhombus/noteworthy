/**
 * The few words of an entry shown under a search result, around its first match.
 *
 * `find_entries` sends a window of the body's text: up to 200 characters,
 * starting 60 before the earliest place any word of the query is found in the
 * body (or at the start, when no word is in the body), and says whether that
 * window reaches the start and the end of the text. This turns the window into
 * what is shown:
 *
 *   - At most `LEAD` characters before the first match. The card clamps the
 *     snippet to two lines, which at 320px is about 70 characters; the 60 the
 *     database leaves would put the match at the end of the second line at
 *     best, with nothing after it.
 *   - It starts and ends on word boundaries. A window that does not begin at
 *     the start of the text may begin inside a word, so its first word is
 *     dropped unless nothing else comes before the match; likewise its last
 *     word at the end.
 *   - "…" wherever text was cut, at either end.
 *
 * A single word longer than the room before the match is the one case that
 * starts inside a word: there is no boundary to start on.
 */
import { firstMatch, highlight, isSpace, lowerOne, type Segment } from './text';

/** The most characters kept before the first match. */
export const LEAD = 40;

export const ELLIPSIS = '…';

export type SnippetWindow = { text: string; atStart: boolean; atEnd: boolean };

export type Snippet = {
	/** The words shown, cut and trimmed, without the ellipses. */
	text: string;
	cutStart: boolean;
	cutEnd: boolean;
};

export function shapeSnippet(window: SnippetWindow, words: string[]): Snippet {
	const characters = Array.from(window.text);
	const match = firstMatch(characters.map(lowerOne), words);

	// Where a word begins: after a space, or at 0 when 0 is the real start of
	// the text. A window that starts mid-text may start mid-word, so 0 is not a
	// known boundary there.
	const begins = (at: number) =>
		!isSpace(characters[at]) && (at === 0 ? window.atStart : isSpace(characters[at - 1]));

	let start = 0;
	if (match !== null) {
		const earliest = Math.max(0, match.start - LEAD);
		let chosen: number | null = null;
		for (let at = earliest; at <= match.start && chosen === null; at += 1) {
			if (begins(at)) {
				chosen = at;
			}
		}
		// No boundary inside the room: the match's own word starts further
		// back. Keep that word whole if it starts anywhere in the window.
		for (let at = earliest - 1; at >= 0 && chosen === null; at -= 1) {
			if (begins(at)) {
				chosen = at;
			}
		}
		start = chosen ?? earliest;
	} else if (!window.atStart) {
		const first = characters.findIndex((_, at) => begins(at));
		start = first === -1 ? 0 : first;
	}

	let end = characters.length;
	if (!window.atEnd) {
		// The last space after the first match: the word after it may be cut.
		const keep = match === null ? start : match.end;
		for (let at = characters.length - 1; at >= keep; at -= 1) {
			if (isSpace(characters[at])) {
				end = at;
				break;
			}
		}
	}

	const text = characters.slice(start, end).join('');
	const trimmed = text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
	return {
		text: trimmed,
		// Skipping only the spaces a body starts with cuts nothing.
		cutStart: !window.atStart || characters.slice(0, start).some((each) => !isSpace(each)),
		// The end only moves when the window stops short of the text's end.
		cutEnd: !window.atEnd
	};
}

/**
 * The snippet as the page draws it: the ellipses in place, and every match of
 * every word marked.
 */
export function snippetSegments(window: SnippetWindow, words: string[]): Segment[] {
	const snippet = shapeSnippet(window, words);
	if (snippet.text === '') {
		return [];
	}
	const segments = highlight(snippet.text, words);
	if (snippet.cutStart) {
		segments.unshift({ text: ELLIPSIS, match: false });
	}
	if (snippet.cutEnd) {
		segments.push({ text: ELLIPSIS, match: false });
	}
	return segments;
}
