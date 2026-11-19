/**
 * Reads and writes for the Recycle Bin.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `visible()`
 * ---------------------------------------------------------------------------
 * Every other read of `entries` and `journals` goes through a `visible()` in
 * `entries.ts` or `journals.ts`, and the first thing each does is drop deleted
 * rows. The bin is the one place that wants exactly those rows, so it reads
 * them here, by a path of its own, and `visible()` stays as strict as it was.
 * Widening `visible()` with an option would put "and deleted ones too" one
 * argument away from every list in the app.
 *
 * Nothing here queries the tables. Each call is one of the bin's database
 * functions (`20260926120000_recycle_bin`), which take the caller from
 * `auth.uid()` and nothing else:
 *
 *   bin_items()      every entry and journal in the bin, newest first, each
 *                    with the count and size of its files. SECURITY INVOKER:
 *                    the owner's own select policies already show them their
 *                    deleted rows.
 *   waiting_files()  files taken out of entries that nothing names now.
 *   restore_entry()  an entry, and its journal with it if that is deleted too.
 *   restore_journal() a journal and the entries that went down with it.
 *   delete_entry_forever(), delete_journal_forever(), empty_bin()
 *                    remove rows for good and return the paths of the files
 *                    to remove next. The rows are gone when these return; the
 *                    files are the caller's job (`$lib/bin/remove.server`).
 *   is_waiting_file() whether a file is still waiting, asked before removing it.
 *   media_breakdown() the bytes in the bin and waiting, for Empty bin's figure.
 *
 * Restoring is a function rather than an update of `deleted_at` because it
 * must clear `deleted_with_journal`, which no client is granted, and must do
 * it for several rows at once.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT FILTERED
 * ---------------------------------------------------------------------------
 * Hiddenness. Nothing can be hidden yet, and `bin_items()` does not ask. The
 * vault PRD decides what its bin shows; until then this is the second place,
 * after `visible()`, it has to look.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { ok } from './errors';

type Functions = Database['public']['Functions'];
type BinItemRow = Functions['bin_items']['Returns'][number];
type WaitingRow = Functions['waiting_files']['Returns'][number];

/**
 * One journal or entry in the bin, as `bin_items()` describes it.
 *
 *   kind 'journal'  `entries` is how many went down with it, and `files` and
 *                   `bytes` are theirs.
 *   kind 'entry'    in the bin in its own right. `journal_deleted` says its
 *                   journal is in the bin too, as a row of its own.
 *
 * `title` is nullable for an entry, as the column is, though the generated
 * type says otherwise: a function's result columns come out non-null.
 */
export type BinItem = Omit<BinItemRow, 'kind' | 'title'> & {
	kind: 'journal' | 'entry';
	title: string | null;
};

/** A file waiting to be cleared. `type` is the stored MIME type, or '' if Storage kept none. */
export type WaitingFile = WaitingRow;

export async function listBinItems(supabase: SupabaseClient<Database>): Promise<BinItem[]> {
	const rows = ok('list bin', await supabase.rpc('bin_items'));
	// The two kinds are the function's CASE; anything else would be a change to
	// it, and is left out rather than drawn as the wrong thing.
	return rows.flatMap((row): BinItem[] =>
		row.kind === 'journal' || row.kind === 'entry' ? [{ ...row, kind: row.kind }] : []
	);
}

export async function listWaitingFiles(supabase: SupabaseClient<Database>): Promise<WaitingFile[]> {
	const rows = ok('list waiting files', await supabase.rpc('waiting_files'));
	return rows.map((row) => ({ ...row, type: row.type ?? '' }));
}

/** What restoring an entry brought back. */
export type EntryRestored = { journalRestored: boolean; entriesRestored: number };

/**
 * Restores an entry, and its journal with the entries that went down with it
 * if the journal is in the bin too. Throws `DataError` with code P0002 when
 * the entry is not in the caller's bin: restored already, purged, or not theirs.
 */
export async function restoreEntry(
	supabase: SupabaseClient<Database>,
	entryId: string
): Promise<EntryRestored> {
	const [row] = ok('restore entry', await supabase.rpc('restore_entry', { entry: entryId }));
	return {
		journalRestored: row?.journal_restored ?? false,
		entriesRestored: row?.entries_restored ?? 0
	};
}

/**
 * Restores a journal and the entries that went down with it; returns how many
 * came back. Entries deleted from it on their own stay in the bin. P0002 as
 * for `restoreEntry`.
 */
export async function restoreJournal(
	supabase: SupabaseClient<Database>,
	journalId: string
): Promise<number> {
	return ok('restore journal', await supabase.rpc('restore_journal', { journal: journalId }));
}

/**
 * Deletes an entry in the bin for good. Returns the paths of the files it
 * alone named, to be removed next. P0002 when it is not in the caller's bin:
 * deleted or restored already, purged, or not theirs.
 */
export async function deleteEntryForever(
	supabase: SupabaseClient<Database>,
	entryId: string
): Promise<string[]> {
	return ok('delete entry forever', await supabase.rpc('delete_entry_forever', { entry: entryId }));
}

/**
 * Deletes a journal in the bin for good, with every entry in it, those deleted
 * from it on their own earlier included. Returns the paths to remove. P0002 as
 * above; 55000 when it still holds a live entry, which it then keeps.
 */
export async function deleteJournalForever(
	supabase: SupabaseClient<Database>,
	journalId: string
): Promise<string[]> {
	return ok(
		'delete journal forever',
		await supabase.rpc('delete_journal_forever', { journal: journalId })
	);
}

/**
 * Deletes everything in the caller's bin for good. Returns the paths to
 * remove: the files those rows alone named, and every waiting file.
 */
export async function emptyBin(supabase: SupabaseClient<Database>): Promise<string[]> {
	return ok('empty bin', await supabase.rpc('empty_bin'));
}

/** Whether `path` is still one of the caller's waiting files. */
export async function isWaitingFile(
	supabase: SupabaseClient<Database>,
	path: string
): Promise<boolean> {
	return ok('is waiting file', await supabase.rpc('is_waiting_file', { file: path }));
}

/**
 * The bytes Empty bin would free: files only entries in the bin name, and
 * waiting files, each counted once. `null` when the database would not say;
 * the confirmation then gives the counts without a size.
 */
export async function binBytes(supabase: SupabaseClient<Database>): Promise<number | null> {
	try {
		const { data, error } = await supabase.rpc('media_breakdown').single();
		return error === null ? data.bin + data.waiting : null;
	} catch {
		return null;
	}
}
