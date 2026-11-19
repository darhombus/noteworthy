/**
 * What the Recycle Bin page lists under each tab, and the words on each row.
 *
 * Pure, so the page's rules are tested without a database: which rows a tab
 * shows, in what order, and what a row says about itself.
 *
 * ---------------------------------------------------------------------------
 * THE TABS
 * ---------------------------------------------------------------------------
 * All, Entries, Journals, Waiting to be cleared. Each is a link carrying
 * `?tab=`, so it works without script, the back button returns to it and a
 * reload keeps it. All is the page with no parameter; anything unrecognised is
 * read as All rather than refused.
 *
 * All is everything: journals, entries, and the waiting files too, one list,
 * most recently deleted first (a waiting file by when it was taken out of its
 * entry). A waiting file's row says when it clears (`clearing.ts`), so it reads
 * right among the others.
 *
 * An entry that went down with its journal is not a row. It is inside the
 * journal's row, which counts it; `bin_items()` makes that split.
 */
import { formatSize } from '$lib/media/messages';
import type { BinItem, WaitingFile } from '$lib/data/bin';

export const BIN_TABS = ['all', 'entries', 'journals', 'waiting'] as const;

export type BinTab = (typeof BIN_TABS)[number];

export const TAB_LABELS: Record<BinTab, string> = {
	all: 'All',
	entries: 'Entries',
	journals: 'Journals',
	waiting: 'Waiting to be cleared'
};

/** The tab a `?tab=` value names; All for none, or for one that names nothing. */
export function parseTab(value: string | null): BinTab {
	return BIN_TABS.find((tab) => tab !== 'all' && tab === value) ?? 'all';
}

/** The query string for a tab, empty for All. */
export function tabQuery(tab: BinTab): string {
	return tab === 'all' ? '' : `?tab=${tab}`;
}

/** Whether a tab lists waiting files, and so needs their thumbnails signed. */
export function showsWaiting(tab: BinTab): boolean {
	return tab === 'all' || tab === 'waiting';
}

/**
 * Depended on by the bin's load, and invalidated after deleting for good, with
 * `STORAGE_USAGE`, so the list and the sidebar's bar reload and nothing else.
 */
export const BIN_CONTENTS = 'app:bin';

export type JournalRow = {
	kind: 'journal';
	id: string;
	title: string;
	deletedAt: string;
	/** Entries that went down with it: what restoring it brings back. */
	entries: number;
	files: number;
	bytes: number;
};

export type EntryRow = {
	kind: 'entry';
	id: string;
	title: string | null;
	journalId: string;
	journalTitle: string;
	/** The journal is in the bin too, and restoring this brings it back. */
	journalDeleted: boolean;
	/** When `journalDeleted`, how many entries went down with that journal. */
	journalEntries: number;
	deletedAt: string;
	files: number;
	bytes: number;
};

export type FileRow = {
	kind: 'file';
	path: string;
	type: string;
	size: number;
	/** When it was taken out of its entry. */
	deletedAt: string;
};

export type BinRow = JournalRow | EntryRow | FileRow;

/** The rows `tab` lists, most recently deleted first. */
export function binRows(tab: BinTab, items: BinItem[], waiting: WaitingFile[]): BinRow[] {
	const went = new Map(
		items.filter((item) => item.kind === 'journal').map((item) => [item.id, item.entries])
	);

	const rows: BinRow[] = [];
	for (const item of items) {
		if (item.kind === 'journal' && (tab === 'all' || tab === 'journals')) {
			rows.push({
				kind: 'journal',
				id: item.id,
				title: item.title ?? '',
				deletedAt: item.deleted_at,
				entries: item.entries,
				files: item.files,
				bytes: item.bytes
			});
		} else if (item.kind === 'entry' && (tab === 'all' || tab === 'entries')) {
			rows.push({
				kind: 'entry',
				id: item.id,
				title: item.title,
				journalId: item.journal_id,
				journalTitle: item.journal_title,
				journalDeleted: item.journal_deleted,
				journalEntries: went.get(item.journal_id) ?? 0,
				deletedAt: item.deleted_at,
				files: item.files,
				bytes: item.bytes
			});
		}
	}
	if (tab === 'all' || tab === 'waiting') {
		for (const file of waiting) {
			rows.push({
				kind: 'file',
				path: file.path,
				type: file.type,
				size: file.size,
				deletedAt: file.released_at
			});
		}
	}

	// Stable, so rows deleted at the same moment keep the order they came in.
	return rows
		.map((row, index) => ({ row, index, at: Date.parse(row.deletedAt) }))
		.sort((a, b) => b.at - a.at || a.index - b.index)
		.map(({ row }) => row);
}

/** "1 entry", "3 entries", "no entries". */
export function countOf(count: number, one: string, many: string): string {
	if (count === 0) {
		return `no ${many}`;
	}
	return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** "2 files, 4.2 MB", or "no files". */
export function filesSummary(files: number, bytes: number): string {
	return files === 0 ? 'no files' : `${countOf(files, 'file', 'files')}, ${formatSize(bytes)}`;
}

/** What a stored type is, to a person. */
export function fileKind(type: string): 'Photo' | 'Video' | 'Audio' | 'File' {
	const top = type.split('/', 1)[0].toLowerCase();
	return top === 'image' ? 'Photo' : top === 'video' ? 'Video' : top === 'audio' ? 'Audio' : 'File';
}

/** The title an entry row shows. */
export function entryTitle(title: string | null): string {
	return title === null || title.trim().length === 0 ? 'Untitled' : title;
}

/** The line under a row's title, days left aside. */
export function rowDetail(row: JournalRow | EntryRow): string {
	if (row.kind === 'journal') {
		return `Journal · ${countOf(row.entries, 'entry', 'entries')} · ${filesSummary(row.files, row.bytes)}`;
	}
	const where = `Entry in ${row.journalTitle}${row.journalDeleted ? ' · journal deleted' : ''}`;
	return row.files === 0 ? where : `${where} · ${filesSummary(row.files, row.bytes)}`;
}

/** The confirmation for restoring an entry whose journal is in the bin too. */
export function restoreWithJournalText(row: EntryRow): string {
	const others = row.journalEntries;
	if (others === 0) {
		return `This also restores the journal “${row.journalTitle}”.`;
	}
	return `This also restores the journal “${row.journalTitle}” and the ${countOf(others, 'entry', 'entries')} deleted with it.`;
}

/** What each tab says when it has nothing. */
export const EMPTY: Record<BinTab, string> = {
	all: 'The Recycle Bin is empty.',
	entries: 'No deleted entries.',
	journals: 'No deleted journals.',
	waiting: 'Nothing is waiting to be cleared.'
};

/** The one line under the tabs. */
export function tabNote(tab: BinTab): string {
	return tab === 'waiting'
		? 'Photos, videos and audio removed from entries. Cleared automatically within 2 days. You can’t restore them.'
		: 'Deleted entries and journals are removed for good after 30 days.';
}
