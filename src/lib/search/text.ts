/**
 * What a search query's words are, and where they fall in a piece of text.
 *
 * The database decides what matches (`search_words`, `find_entries` and
 * `find_journals` in `20260929120000_search`); this file only has to show it.
 * So every rule here is the database's rule, restated, and
 * `tests/data/search-page.test.ts` holds the two to each other:
 *
 *   - A query counts up to its first 200 characters, and then its first 10
 *     words. Characters are code points, as Postgres's `left()` counts them,
 *     not UTF-16 units.
 *   - Words are split on whitespace: `[[:space:]]` under `pg_c_utf8` plus
 *     U+FEFF. JavaScript's `\s` is that set less U+0085, so U+0085 is added.
 *   - Case is ignored by lowering each code point on its own and keeping the
 *     first code point of the result. `pg_c_utf8` maps one code point to one;
 *     `toLowerCase()` maps "İ" to two ("i" and a combining dot), and lowering a
 *     whole string would also lower a final "Σ" by its context. Lowered one at
 *     a time, the two agree on every code point the database's Unicode (15.1)
 *     assigns. Node's is newer, and lowers 55 code points Postgres does not
 *     know yet; there, a highlight can mark a letter in the other case that the
 *     database did not match on. That only ever adds a mark to a result the
 *     database already returned.
 *
 * Positions are kept in code points throughout, so that a match found in the
 * lowered text is exactly the same characters in the original.
 */

/** The database's limits on a query (`search_words`). */
export const QUERY_CHARACTERS = 200;
export const QUERY_WORDS = 10;

/** Whitespace, as the database splits a query on it. See above. */
const SPACE = /[\s\u0085]/;
const SPACES = /[\s\u0085]+/;
const EDGE_SPACES = /^[\s\u0085]+|[\s\u0085]+$/g;

export function isSpace(character: string): boolean {
	return SPACE.test(character);
}

/** One code point, lowered the way `lower(... COLLATE pg_c_utf8)` lowers it. */
export function lowerOne(character: string): string {
	const lowered = character.toLowerCase();
	return String.fromCodePoint(lowered.codePointAt(0) ?? 0);
}

/**
 * A query as the page holds it and the database is sent it: whitespace off
 * both ends, NUL removed (Postgres text cannot hold one, and PostgREST would
 * refuse the call), and cut to the first 200 code points, which is all the
 * database reads anyway.
 */
export function normaliseQuery(raw: string): string {
	const trimmed = raw.replaceAll(String.fromCharCode(0), '').replace(EDGE_SPACES, '');
	return Array.from(trimmed).slice(0, QUERY_CHARACTERS).join('');
}

/** The number of characters in `text`, counted as the database counts them. */
export function characterCount(text: string): number {
	return Array.from(text).length;
}

/**
 * The words the database will match `query` by: `search_words(query)`,
 * lowered, in the order typed, at most 10.
 */
export function queryWords(query: string): string[] {
	const head = Array.from(query).slice(0, QUERY_CHARACTERS).map(lowerOne).join('');
	return head
		.split(SPACES)
		.filter((word) => word !== '')
		.slice(0, QUERY_WORDS);
}

/** A run of text, and whether it is part of a match. Rendered as text, never as HTML. */
export type Segment = { text: string; match: boolean };

/**
 * Where `words` occur in `characters` (code points, lowered), as half-open
 * ranges in code points, sorted and with overlapping or touching ranges merged.
 * Every occurrence of every word counts, overlapping ones included: "aa" in
 * "aaa" is the whole of it.
 */
function matchRanges(lowered: string[], words: string[]): Array<[number, number]> {
	const found: Array<[number, number]> = [];
	for (const word of words) {
		const needle = Array.from(word);
		for (let at = 0; at + needle.length <= lowered.length; at += 1) {
			let same = true;
			for (let k = 0; k < needle.length; k += 1) {
				if (lowered[at + k] !== needle[k]) {
					same = false;
					break;
				}
			}
			if (same) {
				found.push([at, at + needle.length]);
			}
		}
	}
	found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

	const merged: Array<[number, number]> = [];
	for (const range of found) {
		const last = merged.at(-1);
		if (last !== undefined && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
		} else {
			merged.push([range[0], range[1]]);
		}
	}
	return merged;
}

/**
 * `text` split into plain and matched runs, in order. Joined back together the
 * runs are exactly `text`. With no words, or no match, it is one plain run.
 */
export function highlight(text: string, words: string[]): Segment[] {
	const characters = Array.from(text);
	const ranges = matchRanges(characters.map(lowerOne), words);

	const segments: Segment[] = [];
	let at = 0;
	for (const [start, end] of ranges) {
		if (start > at) {
			segments.push({ text: characters.slice(at, start).join(''), match: false });
		}
		segments.push({ text: characters.slice(start, end).join(''), match: true });
		at = end;
	}
	if (at < characters.length || segments.length === 0) {
		segments.push({ text: characters.slice(at).join(''), match: false });
	}
	return segments;
}

/**
 * The first matched run in `lowered` (code points, already lowered), as the
 * highlight will draw it: where it starts, and where it ends, which can be past
 * the end of the first word when another overlaps or touches it. `null` when
 * no word occurs.
 */
export function firstMatch(
	lowered: string[],
	words: string[]
): { start: number; end: number } | null {
	const [first] = matchRanges(lowered, words);
	return first === undefined ? null : { start: first[0], end: first[1] };
}
