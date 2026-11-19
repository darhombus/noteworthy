/**
 * Dates, formatted the same way on the server and in the browser.
 *
 * Pinned to en-GB rather than the reader's locale. Every one of these strings is
 * rendered once during SSR and again during hydration; left to the ambient
 * locale those two runs disagree, because Node's default and the browser's are
 * set by different things, and Svelte reports a mismatch on a date nobody chose
 * to be ambiguous. en-GB is day-month-year, which is how these dates are read
 * anyway.
 */
const DAY = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A day, from either a `date` column or a timestamp.
 *
 * The two need different handling and the difference is not cosmetic.
 * `new Date('2026-09-18')` is parsed as midnight **UTC**, so in any timezone
 * behind UTC it formats as the seventeenth — the entry would show the day before
 * the one its owner chose. A `date` column has no timezone to lose, so its parts
 * are read out and rebuilt as a local date. Timestamps carry an offset and are
 * parsed normally.
 */
export function formatDay(value: string): string {
	const parts = DATE_ONLY.exec(value);

	if (parts) {
		return DAY.format(new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
	}

	return DAY.format(new Date(value));
}

/** Today, as a `date` column wants it — in local time, not UTC, for the reason above. */
export function todayAsDateInput(): string {
	const now = new Date();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${month}-${day}`;
}
