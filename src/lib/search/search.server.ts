/**
 * Runs a search. The one implementation of what a result is: the search
 * page's data (`/search/page`, `searchPage` below), the journal page's load and
 * the live requests (`/search/results`, the quick-search modal's included) all
 * call `runSearch`.
 * The modal's rows while nothing is typed are `recentEntries`, below.
 *
 * A request with a `journal` searches that journal's entries only
 * (`find_entries`' `in_journal`) and asks for no journals. A journal that is
 * not the caller's, or is deleted or hidden, finds nothing: the function's own
 * filters and RLS see to that, not this module.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT ASKS
 * ---------------------------------------------------------------------------
 * The first page asks `find_journals` and `find_entries` together, in one round
 * trip. A later page asks for entries alone: the journals were shown with the
 * first. Under 2 characters nothing is asked at all, unless a filter is set
 * (`request.filters`: a journal chosen on `/search`, or days), when even an
 * empty query asks for every entry the filters allow, and journals are never
 * asked. To before From asks nothing (`reversed`).
 *
 * The query sent is the query highlighted with (`normaliseQuery`), so the
 * words the database matched are exactly the words marked (`queryWords`).
 *
 * ---------------------------------------------------------------------------
 * A CURSOR THAT IS NOT ONE
 * ---------------------------------------------------------------------------
 * `find_entries` raises on a malformed cursor rather than returning a short
 * page. A cursor comes from the URL, where anyone can edit it, and a bad one is
 * answered with the first page, not an error: `parseSearchRequest` drops one of
 * the wrong shape before it is sent, and when the database still refuses a
 * well-shaped one (a data exception, class 22: `2026-13-45`), the first page
 * is asked for instead, journals and all.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { listRecentEntries } from '$lib/data/entries';
import { listJournals } from '$lib/data/journals';
import { DataError } from '$lib/data/errors';
import {
	ENTRY_PAGE,
	findEntries,
	findJournals,
	type FoundEntry,
	type FoundJournal
} from '$lib/data/search';
import type { Database } from '$lib/types/database';
import { isFiltered, parseFilters } from './filters';
import type { SearchPageData } from './page-data';
import {
	parseSearchRequest,
	withoutSearching,
	type EntryHit,
	type EntryPage,
	type JournalHit,
	type SearchOutcome,
	type SearchRequest
} from './results';
import { RECENT_SHOWN } from './quick';
import { snippetSegments } from './snippet';
import { highlight, queryWords } from './text';

function isDataException(failure: unknown): boolean {
	return failure instanceof DataError && (failure.postgrest.code ?? '').startsWith('22');
}

function journalHit(row: FoundJournal, words: string[]): JournalHit {
	return {
		journalId: row.journal_id,
		name: highlight(row.title, words),
		color: row.color,
		icon: row.icon,
		entryCount: row.entry_count
	};
}

function entryHit(row: FoundEntry, words: string[]): EntryHit {
	const titled = row.title !== null && row.title.trim() !== '';
	return {
		entryId: row.entry_id,
		journalId: row.journal_id,
		journalName: row.journal_title,
		journalColor: row.journal_color,
		title: titled ? highlight(row.title ?? '', words) : null,
		entryDate: row.entry_date,
		snippet: snippetSegments(
			{ text: row.snippet, atStart: row.snippet_at_start, atEnd: row.snippet_at_end },
			words
		)
	};
}

function entryPage(rows: FoundEntry[], words: string[], from: number): EntryPage {
	const total = rows[0]?.total ?? 0;
	const last = rows.at(-1);
	// A full page may be the last one, and `total` says when it is. `from` is a
	// label taken from the URL, though, so where it cannot be right (it puts
	// this page past the total) a full page is taken to have more after it.
	const shownThrough = from - 1 + rows.length;
	const more = rows.length === ENTRY_PAGE && shownThrough !== total;
	return {
		entries: rows.map((row) => entryHit(row, words)),
		total,
		from: shownThrough > total ? 1 : from,
		next: more && last !== undefined ? last.row_cursor : null
	};
}

/**
 * `findEntries`' journal and days, each given only when set. The journal is
 * the page's own when there is one, else the one chosen on `/search`.
 */
function scope(request: SearchRequest): { journal?: string; since?: string; until?: string } {
	const journal = request.journal ?? request.filters.journal;
	const { since, until } = request.filters;
	return {
		...(journal === null ? {} : { journal }),
		...(since === null ? {} : { since }),
		...(until === null ? {} : { until })
	};
}

/**
 * The first page: journals and entries, in one round trip. Inside a journal,
 * or with any filter set, entries alone: journals have no dates, and a
 * journal chosen or searched in is not a journal to find.
 */
async function firstPage(
	supabase: SupabaseClient<Database>,
	request: SearchRequest,
	words: string[]
): Promise<SearchOutcome> {
	const { query } = request;
	const withJournals = request.journal === null && !isFiltered(request.filters);
	const [rows, journals] = await Promise.all([
		findEntries(supabase, { query, ...scope(request) }),
		withJournals ? findJournals(supabase, query) : Promise.resolve([])
	]);
	return {
		kind: 'found',
		query,
		journals: journals.map((row) => journalHit(row, words)),
		...entryPage(rows, words, 1)
	};
}

/**
 * The quick-search modal's rows while nothing is typed: the most recently
 * edited entries, read through `visible()` like any list, as `EntryHit`s with
 * nothing marked and no snippet, so the modal draws them as it draws results.
 */
export async function recentEntries(supabase: SupabaseClient<Database>): Promise<EntryHit[]> {
	const rows = await listRecentEntries(supabase, RECENT_SHOWN);
	return rows.map((row) => {
		const titled = row.title !== null && row.title.trim() !== '';
		return {
			entryId: row.entry_id,
			journalId: row.journal_id,
			journalName: row.journal_title,
			journalColor: row.journal_color,
			title: titled ? highlight(row.title ?? '', []) : null,
			entryDate: row.entry_date,
			snippet: []
		};
	});
}

export async function runSearch(
	supabase: SupabaseClient<Database>,
	request: SearchRequest
): Promise<SearchOutcome> {
	const { query } = request;
	// `normaliseQuery` trims exactly the characters the database splits words
	// on, so a query left non-empty has at least one word. An empty query
	// reaches `find_entries` only with a filter set, where "every entry the
	// filters allow" is what is wanted.
	const local = withoutSearching(query, request.filters);
	if (local !== null) {
		return local;
	}
	const words = queryWords(query);

	if (request.after === null) {
		return firstPage(supabase, request, words);
	}

	let rows: FoundEntry[];
	try {
		rows = await findEntries(supabase, { query, ...scope(request), after: request.after });
	} catch (failure) {
		if (isDataException(failure)) {
			return firstPage(supabase, request, words);
		}
		throw failure;
	}
	return { kind: 'found', query, journals: [], ...entryPage(rows, words, request.from) };
}

/**
 * The search page's data for its address's query string: `?q=` the query;
 * `?journal=`, `?when=`, `?since=` and `?until=` the filters
 * (`$lib/search/filters`); `?after=` and `?from=` a later page of entries,
 * which is how Show more works without JavaScript. `'invalid'` when `journal`
 * is not an id, which is refused rather than ignored, since ignoring it would
 * show every journal's results under a pill that named one. Another person's
 * journal, or a deleted or hidden one, finds nothing (`find_entries`' filters
 * and RLS), and the pill says so (`journals` does not hold it).
 *
 * `journal` is read here, and only here among the pages: `parseSearchRequest`
 * never reads it, because on a journal page the journal is the path. The days
 * are searched as given: the server never works out a day, its clock being
 * UTC. The browser rolls a preset to today (`LiveSearchForm`).
 *
 * The picker's journals are read with the search, in the same round trip:
 * every visible journal, by name.
 */
export async function searchPage(
	supabase: SupabaseClient<Database>,
	params: URLSearchParams
): Promise<SearchPageData | 'invalid'> {
	const filters = parseFilters(params, true);
	if (filters === 'invalid') {
		return 'invalid';
	}
	const request = { ...parseSearchRequest(params), filters };

	const [outcome, journals] = await Promise.all([
		runSearch(supabase, request),
		listJournals(supabase)
	]);

	return {
		query: request.query,
		filters,
		outcome,
		journals: journals
			.map((journal) => ({ id: journal.journal_id, name: journal.title }))
			.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
	};
}
