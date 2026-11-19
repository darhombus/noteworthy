/**
 * Search's filters: one journal, and a range of days.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE ADDRESS HOLDS
 * ---------------------------------------------------------------------------
 * `journal` (on `/search` only; on a journal page the journal is the path),
 * `when` (which date pill is chosen), and `since` and `until`, the days the
 * results are for, inclusive, as plain `YYYY-MM-DD` dates on `entry_date`.
 *
 * The server searches by `since` and `until` alone and never works out a day
 * itself: its clock is UTC, and between midnight and 03:00 at UTC+3 UTC's
 * date is still yesterday. Only the browser knows the viewer's calendar, so
 * only the browser turns a preset into days (`presetDays`). `when` tells the
 * server's render which pill to draw as chosen.
 *
 * Presets roll forward. An address made with "Today" yesterday still says
 * yesterday's date; once the page runs, `rolled` finds that "Today" now means
 * another day, and the page replaces the days in the address and searches
 * again, the pill still on Today. So a shared or reloaded "This week" means
 * this week for whoever opens it. Custom never rolls: its days are the ones
 * typed.
 *
 * `when` missing is Custom when there are days, Any time when there are none.
 * Any time has no days, whatever the address says. A preset with no days
 * (typed by hand) searches every day until the page rolls it.
 */
import { isUuid } from '$lib/data/ids';

export const DATE_PRESETS = ['today', 'week', 'month', 'year'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/** The date pills, in the order they are drawn. */
export const WHENS = ['any', ...DATE_PRESETS, 'custom'] as const;
export type When = (typeof WHENS)[number];

export const WHEN_LABELS: Record<When, string> = {
	any: 'Any time',
	today: 'Today',
	week: 'This week',
	month: 'This month',
	year: 'This year',
	custom: 'Custom'
};

export type SearchFilters = {
	when: When;
	/** The first day, inclusive, or `null` for no limit. */
	since: string | null;
	/** The last day, inclusive, or `null` for no limit. */
	until: string | null;
	/** The journal chosen on `/search`, or `null` for every journal. */
	journal: string | null;
};

export const NO_FILTERS: SearchFilters = { when: 'any', since: null, until: null, journal: null };

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real day written `YYYY-MM-DD`: `2026-02-30` is not one. */
export function isDay(value: string): boolean {
	const parts = DAY.exec(value);
	if (parts === null) {
		return false;
	}
	const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
	const date = utcDay(year, month, day);
	return (
		year >= 1 &&
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function isWhen(value: string | null): value is When {
	return (WHENS as readonly string[]).includes(value ?? '');
}

function isPreset(when: When): when is DatePreset {
	return (DATE_PRESETS as readonly string[]).includes(when);
}

/**
 * Today in `timeZone`, `YYYY-MM-DD`. Left out, the zone is the runtime's own:
 * the viewer's in a browser. Never called on the server.
 */
export function todayIn(now: Date, timeZone?: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(now);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

/**
 * A calendar day as a UTC midnight, for arithmetic only. `setUTCFullYear`
 * rather than `Date.UTC`, which reads years 0–99 as 1900–1999; either rolls an
 * overflowing month or day into the next.
 */
function utcDay(year: number, month: number, day: number): Date {
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return date;
}

/** A day moved by `days`, on the calendar alone: no time of day, no zone. */
function addDays(day: string, days: number): string {
	const [year, month, date] = day.split('-').map(Number);
	return isoDay(utcDay(year, month, date + days));
}

function isoDay(date: Date): string {
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * The days a preset covers, given today in the viewer's calendar: the day
 * itself; the week from Sunday to Saturday; the calendar month; the calendar
 * year.
 */
export function presetDays(preset: DatePreset, today: string): { since: string; until: string } {
	const [year, month, day] = today.split('-').map(Number);
	switch (preset) {
		case 'today':
			return { since: today, until: today };
		case 'week': {
			// `getUTCDay()` is 0 on a Sunday.
			const sunday = addDays(today, -utcDay(year, month, day).getUTCDay());
			return { since: sunday, until: addDays(sunday, 6) };
		}
		case 'month':
			return {
				since: isoDay(utcDay(year, month, 1)),
				// Day 0 of the next month is the last of this one.
				until: isoDay(utcDay(year, month + 1, 0))
			};
		case 'year':
			return { since: isoDay(utcDay(year, 1, 1)), until: isoDay(utcDay(year, 12, 31)) };
	}
}

/** Filters for a pill just chosen: a preset's days for today, Any time's none. */
export function choosePill(filters: SearchFilters, when: When, today: string): SearchFilters {
	if (isPreset(when)) {
		return { ...filters, when, ...presetDays(when, today) };
	}
	if (when === 'any') {
		return { ...filters, when, since: null, until: null };
	}
	// Custom starts from the days already shown, so choosing it changes nothing
	// until a day is changed.
	return { ...filters, when };
}

/**
 * The filters with a preset's days brought up to today, or `null` when they
 * already are, or the pill is not a preset (Custom never rolls).
 */
export function rolled(filters: SearchFilters, today: string): SearchFilters | null {
	if (!isPreset(filters.when)) {
		return null;
	}
	const days = presetDays(filters.when, today);
	if (days.since === filters.since && days.until === filters.until) {
		return null;
	}
	return { ...filters, ...days };
}

/**
 * Whether anything narrows the search: a journal, or either day. Custom with
 * both days empty narrows nothing, and counts as no filter.
 */
export function isFiltered(filters: SearchFilters): boolean {
	return filters.journal !== null || filters.since !== null || filters.until !== null;
}

/** To before From: said so, and not searched. */
export function isReversed(filters: SearchFilters): boolean {
	return filters.since !== null && filters.until !== null && filters.until < filters.since;
}

/**
 * The filters in an address. `journal` is read only when `withJournal`
 * (`/search`); a journal that is not an id is `'invalid'`, for the caller to
 * refuse, since ignoring it would answer one journal's search with every
 * journal. A day that is not a real day is dropped.
 */
export function parseFilters(
	params: URLSearchParams,
	withJournal: boolean
): SearchFilters | 'invalid' {
	const day = (name: string) => {
		const value = params.get(name);
		return value !== null && isDay(value) ? value : null;
	};
	let since = day('since');
	let until = day('until');
	const asked = params.get('when');
	const when: When = isWhen(asked) ? asked : since !== null || until !== null ? 'custom' : 'any';
	if (when === 'any') {
		since = null;
		until = null;
	}

	let journal: string | null = null;
	if (withJournal) {
		const value = params.get('journal');
		if (value !== null && value !== '') {
			if (!isUuid(value)) {
				return 'invalid';
			}
			journal = value.toLowerCase();
		}
	}
	return { when, since, until, journal };
}

/**
 * The filters as address parameters, in a fixed order, leaving out what is
 * the default: no journal, Any time, an empty day.
 */
export function filterParams(filters: SearchFilters): Array<[string, string]> {
	const params: Array<[string, string]> = [];
	if (filters.journal !== null) {
		params.push(['journal', filters.journal]);
	}
	if (filters.when !== 'any') {
		params.push(['when', filters.when]);
	}
	if (filters.since !== null) {
		params.push(['since', filters.since]);
	}
	if (filters.until !== null) {
		params.push(['until', filters.until]);
	}
	return params;
}

/** Whether two sets of filters ask for the same results (`when` aside). */
export function sameResults(a: SearchFilters, b: SearchFilters): boolean {
	return a.journal === b.journal && a.since === b.since && a.until === b.until;
}

export function sameFilters(a: SearchFilters, b: SearchFilters): boolean {
	return sameResults(a, b) && a.when === b.when;
}
