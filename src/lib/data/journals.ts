/**
 * Reads and writes for `journals`.
 *
 * ---------------------------------------------------------------------------
 * THE FILTERS, AND WHAT THEY ARE NOT
 * ---------------------------------------------------------------------------
 * Every read here goes through `visible()`, which applies two filters:
 *
 *   `deleted_at IS NULL`  — deleting is soft. A deleted journal keeps its row
 *                           for thirty days so the Recycle Bin can offer it
 *                           back, and a nightly pg_cron job purges it after
 *                           that. No read in the app returns one.
 *   `is_hidden = false`   — the vault is a later PRD. Nothing can be hidden
 *                           today, so this filter changes no behaviour now. It
 *                           is here so that hiddenness never has to be
 *                           retrofitted onto a surface built without it, which
 *                           is how the previous version's vault leaked more
 *                           than once.
 *
 * **This module is a convention, not a guarantee.** Nothing stops a caller
 * querying `journals` directly and getting back rows these functions would have
 * filtered away. Enforcement of that kind belongs in the database — a view, or
 * policies that know about hiddenness — and that is the vault PRD's decision to
 * make, not this one's. Until then: go through here.
 *
 * ---------------------------------------------------------------------------
 * OWNERSHIP
 * ---------------------------------------------------------------------------
 * No function filters by `user_id`. RLS already scopes every row on this table
 * to `auth.uid()`, so a filter here would be a second copy of a rule the
 * database already enforces — and the copy is the one that rots.
 *
 * Writes are the exception. The INSERT policy's `WITH CHECK` requires
 * `user_id = auth.uid()`, so the column has to be set explicitly on create even
 * though nothing reads it back out. `createJournal` takes the id for that
 * reason alone.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { ok } from './errors';

type JournalRow = Database['public']['Tables']['journals']['Row'];
type JournalInsert = Database['public']['Tables']['journals']['Insert'];
type JournalUpdate = Database['public']['Tables']['journals']['Update'];

/**
 * Named columns, never `select('*')`. On `profiles` a wide select fails
 * outright; here it only moves more than is needed, which is reason enough.
 *
 * `deleted_at` and `is_hidden` are left out on purpose: every row this module
 * returns has passed both filters, so both values are known, and omitting them
 * means no caller can be handed a row whose hiddenness it might read and act
 * on. The vault PRD widens this when a surface exists that should see them.
 *
 * The four counters are read-only. They are maintained by triggers, and the
 * column-level INSERT and UPDATE grants both leave them out, so writing one
 * fails at the database. INSERT has only been narrowed since
 * `20260921120000_narrow_client_writes`: before it a journal could be created
 * holding any counters the client chose. Two of them are also known to drift
 * — see `entries.ts`.
 *
 * `font` and `text_size` are what the journal's entries are drawn in
 * (`$lib/journals/fonts`).
 */
const COLUMNS =
	'journal_id, user_id, title, description, color, icon, font, text_size, is_favorite, entry_count, total_word_count, hidden_entry_count, hidden_word_count, created_at, updated_at';

export type Journal = Pick<
	JournalRow,
	| 'journal_id'
	| 'user_id'
	| 'title'
	| 'description'
	| 'color'
	| 'icon'
	| 'font'
	| 'text_size'
	| 'is_favorite'
	| 'entry_count'
	| 'total_word_count'
	| 'hidden_entry_count'
	| 'hidden_word_count'
	| 'created_at'
	| 'updated_at'
>;

/**
 * `title` is required; colour, icon, font and size fall back to the column
 * defaults.
 *
 * These six and `user_id` are the whole of the INSERT grant on `journals`, so
 * adding a field here means adding it to the grant in a migration too.
 * `user_id` is not maintained by a trigger: `createJournal` supplies it, and
 * the insert policy's WITH CHECK refuses any value but the caller's own id.
 */
export type NewJournal = Pick<
	JournalInsert,
	'title' | 'description' | 'color' | 'icon' | 'font' | 'text_size'
>;

/**
 * Editable fields only. The counters and `user_id` are excluded because the
 * grant excludes them; `deleted_at` is excluded because deleting goes through
 * `deleteJournal`, which is the only place that should be stamping it.
 *
 * These seven, `deleted_at`, and the `updated_at` the entry-edit trigger writes
 * are the whole of the UPDATE grant on `journals`. `journal_id` and
 * `created_at` are not in it.
 */
export type JournalEdit = Pick<
	JournalUpdate,
	'title' | 'description' | 'color' | 'icon' | 'font' | 'text_size' | 'is_favorite'
>;

/**
 * The one place the two filters are applied. Every read below starts here.
 * The Recycle Bin reads deleted journals through `bin.ts` beside this file, by
 * a path of its own, so that nothing here ever has to let them through.
 */
function visible(supabase: SupabaseClient<Database>) {
	return supabase.from('journals').select(COLUMNS).is('deleted_at', null).eq('is_hidden', false);
}

/**
 * Every journal the signed-in person can see, most recently touched first.
 *
 * That order matches `idx_journals_user_public`, a partial index on
 * `(user_id, updated_at DESC)` carrying the same two filters, so the list is an
 * index scan rather than a sort over the table.
 *
 * `updated_at` is a genuine-edit timestamp, not a last-touched one: the trigger
 * on `journals` leaves it alone when only `is_favorite` moves, so favouriting a
 * journal does not jump it to the top of the list.
 */
export async function listJournals(supabase: SupabaseClient<Database>): Promise<Journal[]> {
	return ok('list journals', await visible(supabase).order('updated_at', { ascending: false }));
}

/** One journal, or `null` if it does not exist, is deleted, or isn't theirs. */
export async function getJournal(
	supabase: SupabaseClient<Database>,
	journalId: string
): Promise<Journal | null> {
	return ok('get journal', await visible(supabase).eq('journal_id', journalId).maybeSingle());
}

/**
 * Creates a journal owned by `userId`.
 *
 * Note that a new account already has one — a trigger on `auth.users` creates
 * it at signup — so this is for the second journal onwards, not for making
 * writing possible in the first place.
 */
export async function createJournal(
	supabase: SupabaseClient<Database>,
	userId: string,
	input: NewJournal
): Promise<Journal> {
	return ok(
		'create journal',
		await supabase
			.from('journals')
			.insert({ ...input, user_id: userId })
			.select(COLUMNS)
			.single()
	);
}

/**
 * Applies an edit and returns the journal as it now stands.
 *
 * The `deleted_at IS NULL` filter is on the UPDATE as well as the SELECT: a
 * deleted journal is not editable, and without it a stale id from a page loaded
 * before the delete would quietly write to a row nobody can see.
 */
export async function updateJournal(
	supabase: SupabaseClient<Database>,
	journalId: string,
	patch: JournalEdit
): Promise<Journal> {
	return ok(
		'update journal',
		await supabase
			.from('journals')
			.update(patch)
			.eq('journal_id', journalId)
			.is('deleted_at', null)
			.select(COLUMNS)
			.single()
	);
}

/**
 * Soft-deletes a journal, and with it every entry still live inside it.
 *
 * The entries are not touched from here. A trigger on `journals` does it —
 * `trg_journals_soft_delete_cascade` — so that a journal deleted by a script,
 * or by the Recycle Bin later, takes its entries with it too. Application code
 * would only cover the paths somebody remembered.
 *
 * `deleted_at IS NULL` in the WHERE clause makes a second delete a no-op rather
 * than a re-stamp. It matters: the timestamp is what the thirty-day retention
 * window is measured from, and re-stamping would silently extend it.
 */
export async function deleteJournal(
	supabase: SupabaseClient<Database>,
	journalId: string
): Promise<void> {
	ok(
		'delete journal',
		await supabase
			.from('journals')
			.update({ deleted_at: new Date().toISOString() })
			.eq('journal_id', journalId)
			.is('deleted_at', null)
	);
}
