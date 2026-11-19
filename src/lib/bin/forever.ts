/**
 * What the Recycle Bin's delete-for-good confirmations say, and what the page
 * says once one has run.
 *
 * Pure, so the wording is tested without a page. Every confirmation names what
 * goes and ends "This can’t be undone."
 *
 * ---------------------------------------------------------------------------
 * A JOURNAL
 * ---------------------------------------------------------------------------
 * `delete_journal_forever()` takes every entry in the journal: those that went
 * down with it, which its row counts, and those deleted from it on their own
 * earlier, which are rows of their own further down the list and easy to
 * forget. So the confirmation counts the first and names the second.
 *
 * ---------------------------------------------------------------------------
 * EMPTY BIN
 * ---------------------------------------------------------------------------
 * Counts every journal, every entry (inside a journal's row or a row of its
 * own) and every waiting file, whichever tab is showing, and the bytes it
 * frees. The bytes come from `media_breakdown()`, not from adding up the rows:
 * a file two entries share is in both rows, and a file a live entry also names
 * is in a row but is not freed. The breakdown counts each file once, and only
 * where nothing live names it.
 */
import type { BinItem, WaitingFile } from '$lib/data/bin';
import { formatSize } from '$lib/media/messages';
import {
	countOf,
	entryTitle,
	fileKind,
	type EntryRow,
	type FileRow,
	type JournalRow
} from './rows';

export const CANT_UNDO = 'This can’t be undone.';

/** "Permanently delete “Work”?" */
export function deleteQuestion(title: string): string {
	return `Permanently delete “${title}”?`;
}

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
export function listNames(names: readonly string[], shown = 3): string {
	if (names.length > shown) {
		return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`;
	}
	if (names.length <= 1) {
		return names.join('');
	}
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The entries deleted from `journalId` on their own, before the journal was: their titles. */
export function deletedSeparately(journalId: string, items: readonly BinItem[]): string[] {
	return items
		.filter((item) => item.kind === 'entry' && item.journal_id === journalId)
		.map((item) => entryTitle(item.title));
}

/** What deleting a journal for good takes with it, as sentences. */
export function journalGoes(row: JournalRow, separately: readonly string[]): string {
	const sentences: string[] = [];
	if (row.entries > 0) {
		sentences.push(
			row.entries === 1
				? 'Its 1 entry is deleted with it.'
				: `Its ${row.entries} entries are deleted with it.`
		);
	} else if (separately.length === 0) {
		sentences.push('It has no entries.');
	}
	if (separately.length > 0) {
		sentences.push(
			`This also deletes ${countOf(separately.length, 'entry', 'entries')} you deleted from ${row.title} earlier, ${listNames(separately)}.`
		);
	}
	sentences.push(CANT_UNDO);
	return sentences.join(' ');
}

/** "photo", "video", "audio", "file". */
export function fileNoun(type: string): string {
	return fileKind(type).toLowerCase();
}

/** The heading for Delete now on a waiting file. */
export function clearQuestion(row: FileRow): string {
	return `Delete this ${fileNoun(row.type)} now?`;
}

export function clearDetail(row: FileRow): string {
	return `It would be cleared on its own soon. Deleting it now frees ${formatSize(row.size)} straight away. ${CANT_UNDO}`;
}

/** Everything Empty bin deletes. `bytes` is null when the size could not be read. */
export type BinSummary = { journals: number; entries: number; files: number; bytes: number | null };

export function binSummary(
	items: readonly BinItem[],
	waiting: readonly WaitingFile[],
	bytes: number | null
): BinSummary {
	let journals = 0;
	let entries = 0;
	for (const item of items) {
		if (item.kind === 'journal') {
			journals += 1;
			entries += item.entries;
		} else {
			entries += 1;
		}
	}
	return { journals, entries, files: waiting.length, bytes };
}

/** Whether Empty bin has anything to do. */
export function hasAnything(summary: BinSummary): boolean {
	return summary.journals + summary.entries + summary.files > 0;
}

/** "Permanently delete 1 journal, 4 entries and 6 removed files (34 MB)?" */
export function emptyBinQuestion(summary: BinSummary): string {
	const parts: string[] = [];
	if (summary.journals > 0) {
		parts.push(countOf(summary.journals, 'journal', 'journals'));
	}
	if (summary.entries > 0) {
		parts.push(countOf(summary.entries, 'entry', 'entries'));
	}
	if (summary.files > 0) {
		parts.push(countOf(summary.files, 'removed file', 'removed files'));
	}
	const size = summary.bytes !== null && summary.bytes > 0 ? ` (${formatSize(summary.bytes)})` : '';
	return `Permanently delete ${listNames(parts, parts.length)}${size}?`;
}

/**
 * What the page says when some files could not be removed. The rows are gone
 * either way; the files are waiting, and the nightly job takes them.
 */
export function filesLeftNote(left: number): string {
	if (left === 0) {
		return '';
	}
	return left === 1
		? '1 file couldn’t be removed just now. It’s under Waiting to be cleared, and will be cleared later.'
		: `${left} files couldn’t be removed just now. They’re under Waiting to be cleared, and will be cleared later.`;
}

/**
 * What deleting for good came to, as the bin's actions answer.
 *
 *   gone       it was not in the bin (or not waiting) by the time the request
 *              arrived: deleted or restored in another tab, or a second tap.
 *              Not an error: nothing was removed twice, and the page reloads.
 *   filesLeft  files the rows named that are still in Storage. The rows are
 *              gone regardless; these are under Waiting to be cleared.
 */
export type Deleted = {
	deleted: 'entry' | 'journal' | 'file' | 'bin';
	gone: boolean;
	filesLeft: number;
};

/** Whether an action's answer is a `Deleted`. */
export function isDeleted(data: unknown): data is Deleted {
	if (typeof data !== 'object' || data === null) {
		return false;
	}
	const { deleted, gone, filesLeft } = data as Record<string, unknown>;
	return (
		(deleted === 'entry' || deleted === 'journal' || deleted === 'file' || deleted === 'bin') &&
		typeof gone === 'boolean' &&
		typeof filesLeft === 'number'
	);
}

/** What a delete-for-good confirmation was opened on. */
export type ForeverTarget =
	| { kind: 'entry'; row: EntryRow }
	| { kind: 'journal'; row: JournalRow; separately: string[] }
	| { kind: 'file'; row: FileRow }
	| { kind: 'bin'; summary: BinSummary };

/** What the page says once a delete for good has run. */
export function finishedText(target: ForeverTarget, result: Deleted): string {
	let text: string;
	if (result.gone) {
		text =
			target.kind === 'file'
				? 'That file is no longer waiting to be cleared. It may have been deleted in another tab. The list is up to date now.'
				: 'That’s no longer in the Recycle Bin. It may have been deleted or restored in another tab. The list is up to date now.';
	} else if (target.kind === 'entry') {
		text = `Deleted “${entryTitle(target.row.title)}” for good.`;
	} else if (target.kind === 'journal') {
		text =
			target.row.entries + target.separately.length > 0
				? `Deleted “${target.row.title}” and its entries for good.`
				: `Deleted “${target.row.title}” for good.`;
	} else if (target.kind === 'file') {
		text = `Deleted the ${fileNoun(target.row.type)} for good.`;
	} else {
		text = 'Emptied the Recycle Bin.';
	}
	const note = filesLeftNote(result.filesLeft);
	return note === '' ? text : `${text} ${note}`;
}
