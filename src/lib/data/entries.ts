/**
 * Reads and writes for `entries`.
 *
 * ---------------------------------------------------------------------------
 * THE FILTERS, AND WHAT THEY ARE NOT
 * ---------------------------------------------------------------------------
 * Every read here goes through `visible()`, which applies four filters — the
 * two on the entry, and the same two again on the journal it belongs to:
 *
 *   `entries.deleted_at IS NULL`   — deleting is soft, for thirty days.
 *   `entries.is_hidden = false`    — the vault is a later PRD.
 *   `journals.deleted_at IS NULL`  — defence in depth. A trigger cascades a
 *                                    journal's deletion onto its entries, so
 *                                    this should never be the filter that
 *                                    catches anything. It costs nothing, and an
 *                                    entry that outlives its journal is exactly
 *                                    the kind of row that should not appear in
 *                                    a list because one trigger was missed.
 *   `journals.is_hidden = false`   — an entry inside a hidden journal is
 *                                    hidden, whatever its own flag says.
 *
 * That last one is the part worth not losing. Hiddenness in this schema has two
 * limbs — `e.is_hidden OR j.is_hidden` — and every piece of SQL that already
 * knows about it says so: `fn_journals_rollup`, search's `find_entries`, and
 * the partial indexes. A layer that filtered only
 * the entry's own flag would leak every entry in a hidden journal, which is
 * precisely how the previous version's vault leaked.
 *
 * **This module is a convention, not a guarantee.** A caller that queries
 * `entries` directly gets rows these functions would have filtered away.
 * Enforcement belongs in the database, and that is the vault PRD's decision to
 * make, not this one's. Until then: go through here.
 *
 * ---------------------------------------------------------------------------
 * OWNERSHIP
 * ---------------------------------------------------------------------------
 * `entries` has no `user_id` column. RLS reaches ownership through the journal
 * — the policies read `journal_id IN (SELECT journal_id FROM journals WHERE
 * user_id = auth.uid())` — so there is no owner to filter by here and none to
 * set on insert either. Naming a journal is naming an owner.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE TWO KNOWN COUNTER DEFECTS SURFACE
 * ---------------------------------------------------------------------------
 * Both are unfixed by decision. `tests/rls/counters.test.ts` asserts that each
 * defect exists, so those assertions pass today and a fix turns them red; they
 * are not to be edited. Neither is caused by anything in this file; this is
 * where they become visible to a person.
 *
 *   FINDING 7-A — `updateEntry` with a new `content` recomputes the entry's own
 *   `word_count`, but the journal's `total_word_count` is not recomputed with
 *   it. Any surface showing a journal's word count displays the figure from
 *   before the edit, until some other operation on that journal — an insert, a
 *   delete, a hide — happens to refresh it.
 *
 *   Autosave made this worse rather than more visible. `POST .../autosave`
 *   writes a body every second or so of typing instead of once when somebody
 *   presses a button, so the window in which a journal's word count disagrees
 *   with its entries is now most of the time somebody spends writing, rather
 *   than the moment between two saves. Nothing about the defect changed; the
 *   number of times a day it happens went up by two orders of magnitude.
 *
 *   Worth knowing for whoever fixes it: the obvious fix is to widen the rollup
 *   trigger to fire on `content`. That would also make every autosave run
 *   `fn_journals_rollup`, which recounts the journal's entries — a full recount
 *   per keystroke-batch, where today there is none. A cheaper fix is to adjust
 *   `total_word_count` by the delta rather than recounting.
 *
 *   FINDING 7-B — moving an entry from one journal to another updates neither
 *   journal's counters: the old one keeps counting it, the new one never
 *   starts. There is deliberately no move function here. When one is added, it
 *   will leave two journals wrong, and no amount of care on this side of the
 *   database changes that.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { DataError, ok } from './errors';
import { isUuid } from './ids';

type EntryRow = Database['public']['Tables']['entries']['Row'];
type EntryInsert = Database['public']['Tables']['entries']['Insert'];
type EntryUpdate = Database['public']['Tables']['entries']['Update'];

export type Entry = Pick<
	EntryRow,
	| 'entry_id'
	| 'journal_id'
	| 'title'
	| 'content'
	| 'word_count'
	| 'is_pinned'
	| 'pinned_at'
	| 'is_favorite'
	| 'entry_date'
	| 'created_at'
	| 'updated_at'
	| 'revision'
>;

/**
 * Named columns, never `select('*')`.
 *
 * Left out deliberately: `deleted_at`, `is_hidden` and `deleted_with_journal`,
 * whose values are all known from the filters having passed, `search_text`,
 * which is a generated copy of the title and body for the full-text index and
 * is never something to render, and `last_save_id`, which only the save's own
 * filter reads.
 */
const COLUMNS =
	'entry_id, journal_id, title, content, word_count, is_pinned, pinned_at, is_favorite, entry_date, created_at, updated_at, revision';

/**
 * The same columns plus an inner join to the parent journal, which is how the
 * two journal-side filters reach a query on `entries`. `!inner` is what makes
 * a filter on the embedded table drop the entry row rather than just blanking
 * the embed.
 */
const COLUMNS_WITH_JOURNAL = `${COLUMNS}, journals!inner(is_hidden, deleted_at)`;

type EntryWithJournal = Entry & {
	journals: Pick<Database['public']['Tables']['journals']['Row'], 'is_hidden' | 'deleted_at'>;
};

/**
 * The journal is joined to filter on, not to return.
 *
 * Written out field by field rather than destructured with a rest element so
 * the compiler checks it: a column added to `Entry` and to `COLUMNS` but
 * forgotten here is an error, where a rest element would have carried it
 * silently and quietly re-admitted the embedded journal alongside it.
 */
function withoutJournal(row: EntryWithJournal): Entry {
	return {
		entry_id: row.entry_id,
		journal_id: row.journal_id,
		title: row.title,
		content: row.content,
		word_count: row.word_count,
		is_pinned: row.is_pinned,
		pinned_at: row.pinned_at,
		is_favorite: row.is_favorite,
		entry_date: row.entry_date,
		created_at: row.created_at,
		updated_at: row.updated_at,
		revision: row.revision
	};
}

/**
 * `journal_id` is required; everything else falls back to a column default.
 *
 * These four, and the `entry_id` only `createEntryOnce` sends, are the whole of
 * the INSERT grant on `entries`. A field added here needs a grant in a
 * migration too, or the database refuses the insert.
 */
export type NewEntry = Pick<EntryInsert, 'journal_id' | 'title' | 'content' | 'entry_date'>;

/**
 * Editable fields only — the UPDATE grant on `entries`, less the `deleted_at`
 * that `deleteEntry` writes by itself.
 *
 * `word_count` is excluded because a trigger derives it from `content` and the
 * client is not granted it; `is_hidden` because the vault owns it;
 * `journal_id` because moving an entry is FINDING 7-B and nothing offers it.
 *
 * `is_pinned` and `is_favorite` used to be listed here although nothing sent
 * them. They are not granted — see `20260921120000_narrow_client_writes` — so
 * the feature that first pins or favourites an entry adds the field and the
 * grant together. Flipping either will not reorder any list: the trigger on
 * `entries` holds `updated_at` still unless the title, body or date changed.
 */
export type EntryEdit = Pick<EntryUpdate, 'title' | 'content' | 'entry_date'>;

export type ListEntriesOptions = {
	/** Restrict to one journal. Omitted, the list spans all of them. */
	journalId?: string;
	limit?: number;
};

/**
 * The one place the four filters are applied. Every read below starts here.
 * The Recycle Bin reads deleted entries through `bin.ts` beside this file, by a
 * path of its own, so that nothing here ever has to let them through.
 *
 * `columns` must embed `journals!inner(is_hidden, deleted_at)`, or the two
 * journal-side filters have nothing to filter. Both lists in this file do:
 * `COLUMNS_WITH_JOURNAL` and `RECENT_COLUMNS`.
 */
function visible<Columns extends string>(supabase: SupabaseClient<Database>, columns: Columns) {
	return supabase
		.from('entries')
		.select(columns)
		.is('deleted_at', null)
		.eq('is_hidden', false)
		.is('journals.deleted_at', null)
		.eq('journals.is_hidden', false);
}

/**
 * Entries, pinned ones first and newest first within that.
 *
 * Scoped to a journal, that order matches `idx_entries_journal_public`, a
 * partial index on `(journal_id, is_pinned DESC, entry_date DESC)` carrying the
 * same two entry-side filters. Across journals there is no such index and the
 * database sorts; that is the cost of the unscoped call, and `limit` is the
 * thing that keeps it small.
 *
 * `created_at` breaks the tie. `entry_date` is a `date` — the day the entry is
 * about — so everything written about the same day sorts equal on it, and
 * without a third key the order among them is whatever the scan returns and can
 * change between two loads of the same page. Somebody writing twice in one
 * evening would watch their entries swap places.
 */
export async function listEntries(
	supabase: SupabaseClient<Database>,
	options: ListEntriesOptions = {}
): Promise<Entry[]> {
	let query = visible(supabase, COLUMNS_WITH_JOURNAL)
		.order('is_pinned', { ascending: false })
		.order('entry_date', { ascending: false })
		.order('created_at', { ascending: false });

	if (options.journalId !== undefined) {
		query = query.eq('journal_id', options.journalId);
	}

	if (options.limit !== undefined) {
		query = query.limit(options.limit);
	}

	const rows = ok('list entries', await query);
	return rows.map(withoutJournal);
}

/** One entry, or `null` if it does not exist, is filtered away, or isn't theirs. */
export async function getEntry(
	supabase: SupabaseClient<Database>,
	entryId: string
): Promise<Entry | null> {
	const row = ok(
		'get entry',
		await visible(supabase, COLUMNS_WITH_JOURNAL).eq('entry_id', entryId).maybeSingle()
	);
	return row === null ? null : withoutJournal(row);
}

/** An entry as the quick-search modal lists it while nothing is typed. */
export type RecentEntry = Pick<EntryRow, 'entry_id' | 'journal_id' | 'title' | 'entry_date'> & {
	journal_title: string;
	journal_color: string;
};

/**
 * No body: a row in a list needs a title and a date, and `content` can be the
 * largest thing in the row. The journal's title and colour ride along on the
 * same join that carries the filters.
 */
const RECENT_COLUMNS =
	'entry_id, journal_id, title, entry_date, journals!inner(title, color, is_hidden, deleted_at)';

/**
 * The `limit` most recently edited entries across every journal, newest edit
 * first. "Edited" is `updated_at`, which moves only for a change to the title,
 * the body or the date (`fn_entries_set_updated_at`), so pinning or hiding
 * never puts an entry here. The id breaks a tie, so the order is total.
 */
export async function listRecentEntries(
	supabase: SupabaseClient<Database>,
	limit: number
): Promise<RecentEntry[]> {
	const rows = ok(
		'list recent entries',
		await visible(supabase, RECENT_COLUMNS)
			.order('updated_at', { ascending: false })
			.order('entry_id', { ascending: false })
			.limit(limit)
	);
	return rows.map((row) => ({
		entry_id: row.entry_id,
		journal_id: row.journal_id,
		title: row.title,
		entry_date: row.entry_date,
		journal_title: row.journals.title,
		journal_color: row.journals.color
	}));
}

/**
 * Creates an entry in `input.journal_id`.
 *
 * The insert names no owner: RLS derives one from the journal. It also does not
 * check that the journal is live and unhidden — RLS only asks who owns it, and
 * asking here would cost a second round trip on every save. The gap is narrow
 * and self-inflicted: a tab holding a journal id from before that journal was
 * deleted can write an entry into it, which every read in this module then
 * filters away, and which the nightly purge removes with the journal. Closing
 * it properly means a check in the database rather than a lookup here.
 */
export async function createEntry(
	supabase: SupabaseClient<Database>,
	input: NewEntry
): Promise<Entry> {
	return ok('create entry', await supabase.from('entries').insert(input).select(COLUMNS).single());
}

/** Postgres' `unique_violation`. On `entries` the only unique key is `entry_id`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Creates an entry under an id the caller chose, and can be repeated safely.
 *
 * This is what lets autosave create an entry at all. A create whose reply is
 * lost — the insert committed, the connection dropped on the way back — looks
 * to the browser exactly like one that never arrived, and the browser will send
 * it again. With a database-chosen id the second attempt would make a second
 * entry. With the page's own id it hits the primary key instead, and that
 * collision is the proof the first attempt landed.
 *
 * So a collision is not an error: the row is updated with what this attempt
 * carried, which is never older than what the first one did — autosave sends
 * one save at a time and always the latest draft. The update is held to the
 * same journal and to a live row, so an id that turns out to belong to another
 * journal, another person, or a deleted entry is refused rather than
 * overwritten. Updating across journals would be a move, which is FINDING 7-B;
 * reviving a deleted entry would undo a delete nobody asked to undo.
 *
 * It is held to the page's own attempts as well: `last_save_id` must be one of
 * `save.earlier`, the creates this page sent and never heard back from. Until a
 * create has answered, nobody else can have written the row except by opening
 * it from somewhere else, and a write from there names no save of this page's,
 * so it is refused as stale rather than replaced (SAVES, below).
 *
 * `authenticated` holds INSERT on `entry_id` — it is one of the columns named
 * in `20260921120000_narrow_client_writes` — and never UPDATE. RLS asks the
 * same question it asks of any insert: whose journal.
 *
 * Returns `null` when the id is taken by a row this call may not write: in
 * another journal, or not this person's.
 */
export async function createEntryOnce(
	supabase: SupabaseClient<Database>,
	entryId: string,
	input: NewEntry,
	save: { saveId: string; earlier: readonly string[] }
): Promise<SaveOutcome | null> {
	const inserted = await supabase
		.from('entries')
		.insert({ ...input, entry_id: entryId, last_save_id: save.saveId })
		.select(COLUMNS)
		.single();

	if (inserted.error === null) {
		return { kind: 'saved', entry: inserted.data };
	}
	if (inserted.error.code !== UNIQUE_VIOLATION) {
		throw new DataError('create entry', inserted.error);
	}

	const { journal_id: journalId, ...patch } = input;
	const earlier = uuids(save.earlier);
	if (earlier.length > 0) {
		const updated = ok(
			'create entry again',
			await supabase
				.from('entries')
				.update({ ...patch, last_save_id: save.saveId })
				.eq('entry_id', entryId)
				.eq('journal_id', journalId)
				.is('deleted_at', null)
				.in('last_save_id', earlier)
				.select(COLUMNS)
				.maybeSingle()
		);
		if (updated !== null) {
			return { kind: 'saved', entry: updated };
		}
	}

	const refused = await whyRefused(supabase, entryId);
	if (refused.kind === 'not-found' || refused.journalId !== journalId) {
		return null;
	}
	return refused.kind === 'deleted'
		? { kind: 'deleted' }
		: { kind: 'stale', revision: refused.revision };
}

/**
 * ---------------------------------------------------------------------------
 * SAVES
 * ---------------------------------------------------------------------------
 * An entry open in two places, two tabs or two devices, used to be saved by
 * whichever wrote last. Now every entry has a `revision`, which the database
 * moves on every change to the title, the body or the date and on every save
 * made here (`20261023120000_entry_revision`), and a save says which revision
 * it was made from. `saveEntry` applies it only if that is still the entry's
 * revision, in the UPDATE's own WHERE clause, so there is no read between the
 * check and the write for another save to land in.
 *
 * The one exception is a page's own save that it gave up on. A request that
 * threw may still have reached the server, so the row's revision has moved
 * past the one the page holds, by the page's own hand. Each save carries a
 * fresh `saveId`, stored as `last_save_id`, and the ids of the page's saves
 * that were never answered (`unanswered`). A save also applies when the row's
 * last save is one of those. Every revision a page holds is one whose text it
 * knew, so neither case replaces a change made anywhere else.
 *
 * Only a refusal costs a second request: one read, to say which refusal it
 * was. The UPDATE matched no row, so nothing was written and no trigger fired.
 */
export type SaveOutcome =
	| { kind: 'saved'; entry: Entry }
	/** Changed somewhere else since `expected`; `revision` is what it is now. */
	| { kind: 'stale'; revision: number }
	/** In the Recycle Bin. */
	| { kind: 'deleted' };

export type SaveCheck = {
	/** The revision the page's text was made from. */
	expected: number;
	/** This save's own id, chosen by the page. */
	saveId: string;
	/** The page's saves that were never answered. */
	unanswered: readonly string[];
};

/** Only ids go into a PostgREST filter: the list is spliced into the query string. */
function uuids(values: readonly string[]): string[] {
	return values.filter((value) => isUuid(value));
}

type Refusal =
	| { kind: 'not-found' }
	| { kind: 'deleted'; journalId: string }
	| { kind: 'stale'; journalId: string; revision: number };

/**
 * Why a save matched no row. Not filtered on `deleted_at`, which is what lets it
 * tell a deleted entry apart: the SELECT policy asks only whose journal it is.
 */
async function whyRefused(supabase: SupabaseClient<Database>, entryId: string): Promise<Refusal> {
	const row = ok(
		'read refused entry',
		await supabase
			.from('entries')
			.select('journal_id, revision, deleted_at')
			.eq('entry_id', entryId)
			.maybeSingle()
	);
	if (row === null) {
		return { kind: 'not-found' };
	}
	if (row.deleted_at !== null) {
		return { kind: 'deleted', journalId: row.journal_id };
	}
	return { kind: 'stale', journalId: row.journal_id, revision: row.revision };
}

/**
 * Applies a save from an entry page, if it was made from the entry as it now
 * stands. See SAVES above.
 *
 * Returns `null` when there is no such entry for this person.
 */
export async function saveEntry(
	supabase: SupabaseClient<Database>,
	entryId: string,
	patch: EntryEdit,
	check: SaveCheck
): Promise<SaveOutcome | null> {
	const unanswered = uuids(check.unanswered);
	let query = supabase
		.from('entries')
		.update({ ...patch, last_save_id: check.saveId })
		.eq('entry_id', entryId)
		.is('deleted_at', null);
	query =
		unanswered.length > 0
			? query.or(`revision.eq.${check.expected},last_save_id.in.(${unanswered.join(',')})`)
			: query.eq('revision', check.expected);

	const saved = ok('save entry', await query.select(COLUMNS).maybeSingle());
	if (saved !== null) {
		return { kind: 'saved', entry: saved };
	}

	const refused = await whyRefused(supabase, entryId);
	if (refused.kind === 'not-found') {
		return null;
	}
	return refused.kind === 'deleted'
		? { kind: 'deleted' }
		: { kind: 'stale', revision: refused.revision };
}

/**
 * What an open entry page asks to learn whether its entry changed somewhere
 * else, and, for "Use the saved version", the text it puts on screen.
 */
export type EntryVersion = {
	revision: number;
	/** The save the row was last written by, to tell a page's own save from anyone else's. */
	lastSaveId: string | null;
	deleted: boolean;
	/** Only when asked for. */
	text: Pick<EntryRow, 'title' | 'content' | 'entry_date'> | null;
};

type VersionRow = Pick<EntryRow, 'revision' | 'last_save_id' | 'deleted_at'>;

/**
 * An entry's revision, and with `withText` its title, date and body: what the
 * autosave route's GET answers (`$lib/entries/conflict.svelte`). Not filtered
 * on `deleted_at`, like the refusal read above, so a deleted entry is told
 * apart from a missing one. `null` when there is no such entry for this person.
 */
export async function readEntryVersion(
	supabase: SupabaseClient<Database>,
	entryId: string,
	withText: boolean
): Promise<EntryVersion | null> {
	const version = (row: VersionRow): Omit<EntryVersion, 'text'> => ({
		revision: row.revision,
		lastSaveId: row.last_save_id,
		deleted: row.deleted_at !== null
	});
	if (!withText) {
		const row = ok(
			'read entry version',
			await supabase
				.from('entries')
				.select('revision, last_save_id, deleted_at')
				.eq('entry_id', entryId)
				.maybeSingle()
		);
		return row === null ? null : { ...version(row), text: null };
	}
	const row = ok(
		'read saved version',
		await supabase
			.from('entries')
			.select('revision, last_save_id, deleted_at, title, content, entry_date')
			.eq('entry_id', entryId)
			.maybeSingle()
	);
	return row === null
		? null
		: {
				...version(row),
				text: { title: row.title, content: row.content, entry_date: row.entry_date }
			};
}

/**
 * Applies an edit and returns the entry as it now stands, whatever its
 * revision. Rename uses it: a title written from a journal's list is made from
 * no revision, and moves the entry's revision through the trigger, so every
 * page that holds the old title is refused on its next save.
 *
 * `deleted_at IS NULL` is on the UPDATE as well, so a stale id from a page
 * loaded before the entry was deleted does not quietly write to a row nobody
 * can see. A hidden entry is not excluded here — the vault will edit through
 * this path, and an `is_hidden = false` filter on the write would be in its way
 * for no gain, since RLS already decides whose entry it is.
 */
export async function updateEntry(
	supabase: SupabaseClient<Database>,
	entryId: string,
	patch: EntryEdit
): Promise<Entry> {
	return ok(
		'update entry',
		await supabase
			.from('entries')
			.update(patch)
			.eq('entry_id', entryId)
			.is('deleted_at', null)
			.select(COLUMNS)
			.single()
	);
}

/**
 * Soft-deletes one entry.
 *
 * `deleted_with_journal` is left alone, which is the whole point of it: this
 * deletion was the person's decision about this entry, so a later restore of
 * the journal must not sweep it back up. The journal-wide cascade is the only
 * thing that sets that column, and it lives in a trigger.
 *
 * As with journals, `deleted_at IS NULL` makes a second delete a no-op rather
 * than a re-stamp that would extend the retention window.
 */
export async function deleteEntry(
	supabase: SupabaseClient<Database>,
	entryId: string
): Promise<void> {
	ok(
		'delete entry',
		await supabase
			.from('entries')
			.update({ deleted_at: new Date().toISOString() })
			.eq('entry_id', entryId)
			.is('deleted_at', null)
	);
}
