/**
 * What a search result is, as the page, the result list and the live requests
 * all see it. Built on the server by `$lib/search/search.server` and nowhere
 * else; the list only draws it.
 *
 * Titles, names and snippets arrive already split into `Segment`s, plain and
 * matched, and are drawn as text with a `<mark>` for each match: never as HTML.
 * They are the person's own writing.
 */
import { isUuid } from '$lib/data/ids';
import {
	filterParams,
	isFiltered,
	isReversed,
	NO_FILTERS,
	parseFilters,
	type SearchFilters
} from './filters';
import { characterCount, normaliseQuery, queryWords, type Segment } from './text';

export type JournalHit = {
	journalId: string;
	name: Segment[];
	color: string;
	icon: string;
	entryCount: number;
};

export type EntryHit = {
	entryId: string;
	journalId: string;
	journalName: string;
	journalColor: string;
	/** `null` for an untitled entry, which shows "Untitled", unmarked. */
	title: Segment[] | null;
	/** `YYYY-MM-DD`, the `entry_date` column. */
	entryDate: string;
	/** Empty when the entry has no text. */
	snippet: Segment[];
};

/** One page of entries: the rows, and how to ask for the next. */
export type EntryPage = {
	entries: EntryHit[];
	/** Every entry that matches, whatever the page. */
	total: number;
	/** The 1-based place of `entries[0]` among all the matches. */
	from: number;
	/** The cursor for the next page, or `null` when this is the last. */
	next: string | null;
};

export type SearchOutcome =
	/** Nothing typed and no filter: the page says what search covers. */
	| { kind: 'idle' }
	/** Under 2 characters and no filter: nothing was searched. */
	| { kind: 'short'; query: string }
	/** Custom's To is before its From: nothing was searched. */
	| { kind: 'reversed'; query: string }
	/** `query` is `''` when filters alone were searched. */
	| ({ kind: 'found'; query: string; journals: JournalHit[] } & EntryPage);

/**
 * What the URL asks for: `?q=`, the filters, and for a later page `after` and
 * `from`.
 *
 * `journal` is the journal whose page this is: its entries only, no journals
 * group, and, unlike a filter, nothing typed there is still nothing to search
 * (the page shows its list). Set by the journal page's load, never from an
 * address. `filters.journal` is the journal chosen with the pill on
 * `/search`, a filter like the days, read from the address by the caller
 * that allows it (`parseFilters`); `parseSearchRequest` leaves it `null`.
 */
export type SearchRequest = {
	query: string;
	journal: string | null;
	filters: SearchFilters;
	after: string | null;
	from: number;
};

export const MIN_QUERY = 2;

/**
 * `find_entries`' cursor, "tier|entry_date|created_at in UTC|entry_id", in the
 * fixed formats the function writes. Anything else is refused here, before a
 * round trip the database would refuse too; the database remains the judge of
 * a well-shaped cursor that is still no date (`2026-13-45`), and the search
 * module falls back to the first page when it says so.
 */
const CURSOR = /^[12]\|\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|(.+)$/;

export function isCursor(value: string): boolean {
	const parts = CURSOR.exec(value);
	return parts !== null && isUuid(parts[1]);
}

export function parseSearchRequest(params: URLSearchParams): SearchRequest {
	const query = normaliseQuery(params.get('q') ?? '');
	const after = params.get('after');
	const from = Number(params.get('from'));
	const cursor = after !== null && isCursor(after) ? after : null;
	// Without the journal, `parseFilters` cannot refuse anything.
	const filters = parseFilters(params, false);
	return {
		query,
		// Set by the caller that knows it: see `SearchRequest`.
		journal: null,
		filters: filters === 'invalid' ? NO_FILTERS : filters,
		after: cursor,
		// Only a label ("51–100 of 125"): the cursor alone decides the rows.
		from: cursor !== null && Number.isSafeInteger(from) && from > 1 ? from : 1
	};
}

export function isShort(query: string): boolean {
	return characterCount(query) < MIN_QUERY;
}

/**
 * What a normalised query shows without asking the database: To before From,
 * nothing typed, or too short to search. `null` when it has to be asked. The
 * server's search and the live search both answer these from here, so the
 * page as typed and the page as loaded from its URL say the same thing.
 *
 * With a filter set, nothing typed and one character are both searched: the
 * 2-character minimum applies only when nothing else narrows the search.
 */
export function withoutSearching(
	query: string,
	filters: SearchFilters = NO_FILTERS
): SearchOutcome | null {
	if (isReversed(filters)) {
		return { kind: 'reversed', query };
	}
	if (isFiltered(filters)) {
		return null;
	}
	if (query === '') {
		return { kind: 'idle' };
	}
	return isShort(query) ? { kind: 'short', query } : null;
}

/**
 * The words to mark in the rows already shown while `value` is in the field:
 * the words the server would mark if `value` were searched now, and none when
 * it would not be searched (nothing typed, under 2 characters with no filter,
 * To before From). So the marks follow every keystroke, by the same word
 * rules and case-folding as the server's (`queryWords`), while the rows
 * themselves change only when an answer lands.
 */
export function markWords(value: string, filters: SearchFilters = NO_FILTERS): string[] {
	const query = normaliseQuery(value);
	return withoutSearching(query, filters) === null ? queryWords(query) : [];
}

/** The query an outcome shows, `''` for none. */
export function shownQuery(outcome: SearchOutcome): string {
	return outcome.kind === 'idle' ? '' : outcome.query;
}

type NextPage = { after: string; from: number };

/** `?q=…`, with the page after `next` when given. For `resolve('/search')` and the live requests. */
export function searchQueryString(query: string, next?: NextPage): string {
	const params = new URLSearchParams({ q: query });
	if (next !== undefined) {
		params.set('after', next.after);
		params.set('from', String(next.from));
	}
	return `?${params.toString()}`;
}

/**
 * A page's own address after its path: the query when there is one, the
 * filters (`filterParams`: `when` included, defaults left out), then the page
 * after `next`. `''` when there is nothing to say, so the address is the bare
 * path. On a journal page `filters.journal` is `null`: the journal is the path.
 */
export function pageQueryString(query: string, filters: SearchFilters, next?: NextPage): string {
	const params = new URLSearchParams();
	if (query !== '') {
		params.set('q', query);
	}
	for (const [name, value] of filterParams(filters)) {
		params.set(name, value);
	}
	if (next !== undefined) {
		params.set('after', next.after);
		params.set('from', String(next.from));
	}
	const search = params.toString();
	return search === '' ? '' : `?${search}`;
}

/**
 * The query string for `/search/results`: the query, and what decides the
 * rows: the journal and the days, never `when`. `journal` is the journal
 * searched, a journal page's own or the one chosen on `/search`; the endpoint
 * takes either as a filter, which searches the same rows (see the endpoint).
 */
export function resultsQueryString(
	query: string,
	filters: Pick<SearchFilters, 'journal' | 'since' | 'until'>,
	next?: NextPage
): string {
	const params = new URLSearchParams({ q: query });
	if (next !== undefined) {
		params.set('after', next.after);
		params.set('from', String(next.from));
	}
	if (filters.journal !== null) {
		params.set('journal', filters.journal);
	}
	if (filters.since !== null) {
		params.set('since', filters.since);
	}
	if (filters.until !== null) {
		params.set('until', filters.until);
	}
	return `?${params.toString()}`;
}

function entries(count: number): string {
	return count === 1 ? '1 entry' : `${count} entries`;
}

/**
 * The line above the results: "71 entries" when all of them are shown, "50 of
 * 71 entries" when more are to come, and "51–100 of 125 entries" on a later
 * page loaded without JavaScript.
 */
export function countLine(total: number, from: number, shown: number): string {
	if (from <= 1 && shown >= total) {
		return entries(total);
	}
	if (from <= 1) {
		return `${shown} of ${entries(total)}`;
	}
	return `${from}–${from + shown - 1} of ${entries(total)}`;
}

export function entryCountLabel(count: number): string {
	return entries(count);
}
