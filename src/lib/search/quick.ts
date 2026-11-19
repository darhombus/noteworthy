/**
 * The quick-search modal's rows, decided without the DOM: which rows a state
 * shows, and where Up and Down move the selection. `QuickSearch.svelte` draws
 * them.
 *
 * The modal asks `/search/results` for the same first page `/search` shows
 * (50 entries, every matching journal) and shows the top of it: 3 journals,
 * 8 entries, in the order `runSearch` gave. One request, one answer shape, and
 * the rows are exactly the first rows of the page "See all" opens. The cost is
 * the 42 entries not drawn, a few kilobytes compressed per search.
 */
import { isShort, type EntryHit, type JournalHit, type SearchOutcome } from './results';
import { normaliseQuery } from './text';

export const JOURNALS_SHOWN = 3;
export const ENTRIES_SHOWN = 8;
/** Recently edited entries shown while nothing is typed. */
export const RECENT_SHOWN = 5;

export type QuickRow =
	| { kind: 'journal'; journal: JournalHit }
	| { kind: 'entry'; entry: EntryHit }
	| { kind: 'all'; query: string; count: number };

/**
 * Everything the search found: the journals and every matching entry, not
 * only the page. `find_journals` returns at most 50, so past 50 matching
 * journals this counts 50 of them.
 */
export function resultCount(outcome: Extract<SearchOutcome, { kind: 'found' }>): number {
	return outcome.journals.length + outcome.total;
}

/** "See all 12 results"; one is "See 1 result". */
export function seeAllLabel(count: number): string {
	return count === 1 ? 'See 1 result' : `See all ${count} results`;
}

/**
 * The rows for what is on screen: the recent entries while nothing is typed,
 * nothing while too short, and for a search the journals, the entries, then
 * "See all" when anything was found.
 */
export function quickRows(outcome: SearchOutcome, recent: EntryHit[]): QuickRow[] {
	if (outcome.kind === 'idle') {
		return recent.slice(0, RECENT_SHOWN).map((entry) => ({ kind: 'entry', entry }));
	}
	// The modal has no filters, so it is never `reversed`; nothing to show if it were.
	if (outcome.kind === 'short' || outcome.kind === 'reversed') {
		return [];
	}
	const count = resultCount(outcome);
	if (count === 0) {
		return [];
	}
	return [
		...outcome.journals
			.slice(0, JOURNALS_SHOWN)
			.map((journal): QuickRow => ({ kind: 'journal', journal })),
		...outcome.entries.slice(0, ENTRIES_SHOWN).map((entry): QuickRow => ({ kind: 'entry', entry })),
		{ kind: 'all', query: outcome.query, count }
	];
}

/**
 * Where Enter goes with no row selected: `/search` for the query in the field,
 * normalised as `runSearch` would, or `null` (nothing happens) under 2
 * characters. Read from the field, not from what is shown, so Enter pressed
 * before the pause is over still takes the whole query.
 */
export function enterQuery(value: string): string | null {
	const query = normaliseQuery(value);
	return isShort(query) ? null : query;
}

/**
 * The next selection after Up (`-1`) or Down (`1`), wrapping at both ends.
 * `-1` is none: Down from none is the first row, Up from none the last.
 */
export function moveSelection(current: number, count: number, step: 1 | -1): number {
	if (count === 0) {
		return -1;
	}
	if (current < 0 || current >= count) {
		return step === 1 ? 0 : count - 1;
	}
	return (current + step + count) % count;
}
