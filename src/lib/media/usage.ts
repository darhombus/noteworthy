/**
 * How much of the allowance is used, in the words the sidebar and the Storage
 * page say it.
 *
 * Both read the figure the upload check reads. The sidebar's comes from
 * `media_allowance_remaining()`, the function Storage's insert policy calls;
 * the page's from `media_breakdown()`, whose total a test in `tests/rls/bin.test.ts`
 * holds to that same function. So "34% used" here and "you have 12 MB left" on
 * a refused upload are two ways of saying one number.
 *
 * ---------------------------------------------------------------------------
 * HOW THE PERCENTAGE IS ROUNDED
 * ---------------------------------------------------------------------------
 * Down, so it never overstates, with two exceptions that stop it contradicting
 * what is on screen: anything stored reads at least 1% (a person who just added
 * a photo is not using "0%"), and the amber warning starts exactly where the
 * figure first reads 90%. Rounded to nearest, 89.6% would read "90%" and stay
 * blue. Parallel uploads can overshoot the allowance, so the figure can pass
 * 100%; it says so rather than pretending otherwise, and the bar stops full.
 */
import { formatSize } from './messages';
import { ALLOWANCE_BYTES } from './limits';

/**
 * Depended on by the layout's load, and invalidated by the Recycle Bin once it
 * has deleted for good. Not by the editor: see `./usage-measured.svelte`.
 */
export const STORAGE_USAGE = 'app:storage-usage';

/** From here on, the bar is amber. */
export const NEARLY_FULL = 0.9;

/**
 * What `media_breakdown()` returns: bytes, by what the Storage page lists. Each
 * file counts in exactly one of the five parts, so they add up to `total`.
 */
export type MediaBreakdown = {
	total: number;
	images: number;
	video: number;
	audio: number;
	/** Files only entries in the bin, or entries in journals in the bin, name. */
	bin: number;
	/** Files taken out of entries that nothing names now, cleared within 2 days. */
	waiting: number;
};

/** Whole percent of the allowance in use. */
export function percentUsed(used: number): number {
	if (used <= 0) {
		return 0;
	}
	return Math.max(1, Math.floor((used / ALLOWANCE_BYTES) * 100));
}

export function isNearlyFull(used: number): boolean {
	return used >= ALLOWANCE_BYTES * NEARLY_FULL;
}

/** How wide the bar is drawn, as a CSS percentage: never past full. */
export function barWidth(used: number): string {
	return `${Math.min(100, percentUsed(used))}%`;
}

/** The sidebar's line. */
export function usedSummary(used: number): string {
	return `${percentUsed(used)}% of storage used`;
}

/** The Storage page's headline: "24 MB of 70 MB used (34%)". */
export function usedOfAllowance(used: number): string {
	return `${formatSize(used)} of ${formatSize(ALLOWANCE_BYTES)} used (${percentUsed(used)}%)`;
}
