/**
 * Search's two calls: `find_entries` and `find_journals`
 * (`20260929120000_search`).
 *
 * Like the bin, search does not go through `visible()`, and does not have to:
 * both functions apply its four filters themselves (the entry's and its
 * journal's `deleted_at` and `is_hidden`), name `auth.uid()` as well as
 * running under RLS, and take no user id. `tests/rls/search.test.ts` holds them
 * to that. Call them with the person's own client, `locals.supabase`.
 *
 * `$lib/search/search.server` is the only caller; it decides what a result is.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { ok } from './errors';

type Functions = Database['public']['Functions'];
type EntryRow = Functions['find_entries']['Returns'][number];
type JournalRow = Functions['find_journals']['Returns'][number];

/**
 * One row of `find_entries`. `title` is null for an untitled entry, as the
 * column is, though the generated type says otherwise: a function's result
 * columns come out non-null.
 */
export type FoundEntry = Omit<EntryRow, 'title'> & { title: string | null };

export type FoundJournal = JournalRow;

/** The rows `find_entries` returns at most, and so the size of a page. */
export const ENTRY_PAGE = 50;

export type FindEntriesArgs = {
	/** `''` matches every entry the other arguments allow. */
	query: string;
	/** Only this journal's entries; omitted for every journal. */
	journal?: string;
	/** Entries dated on or after this day (`YYYY-MM-DD`); omitted for no limit. */
	since?: string;
	/** Entries dated on or before this day; omitted for no limit. */
	until?: string;
	/** `row_cursor` of the last row already shown; omitted for the first page. */
	after?: string;
};

/**
 * One page of entries matching `query`. Throws `DataError`; a malformed
 * `after` is refused with a code in class 22 (data exception).
 */
export async function findEntries(
	supabase: SupabaseClient<Database>,
	{ query, journal, since, until, after }: FindEntriesArgs
): Promise<FoundEntry[]> {
	return ok(
		'find entries',
		await supabase.rpc('find_entries', {
			query_text: query,
			...(journal === undefined ? {} : { in_journal: journal }),
			...(since === undefined ? {} : { from_day: since }),
			...(until === undefined ? {} : { to_day: until }),
			...(after === undefined ? {} : { after_row: after })
		})
	);
}

/** The journals whose name holds every word of `query`, at most 50. */
export async function findJournals(
	supabase: SupabaseClient<Database>,
	query: string
): Promise<FoundJournal[]> {
	return ok('find journals', await supabase.rpc('find_journals', { query_text: query }));
}
