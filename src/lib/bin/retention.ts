/**
 * How long something has left in the Recycle Bin, stated so that it matches
 * when the row really goes.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE ROW GOES
 * ---------------------------------------------------------------------------
 * Not 30 days after it was deleted. `purge-deleted` runs once a night, at
 * `0 3 * * *` with `cron.timezone` GMT (checked on hosted and locally,
 * 2026-09-26: every recorded hosted run started at 03:00 UTC), and removes a
 * row when `deleted_at < now() - interval '30 days'`. The database's TimeZone
 * is UTC, so the interval is exactly 720 hours. So a row goes at the first
 * 03:00 UTC on or after the moment it turns 30 days old. That is between 30
 * and 31 days after the delete, depending on the time of day it happened.
 *
 * "On or after": a row that turns 30 days old at exactly 03:00:00 is taken by
 * that night's run, whose `now()` is a fraction of a second past three. The
 * one moment this gets wrong is a row that turns 30 days old within that
 * fraction of a second after three; it is shown a day longer than it has.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS SHOWN
 * ---------------------------------------------------------------------------
 * Whole days still left, rounded down, so the figure never promises time
 * that isn't there: "30 days left" straight after a delete (never 31), and
 * "1 day left" means at least 24 hours. Under 24 hours the count would read
 * "0 days left", which sounds like already gone; it says "Less than a day
 * left" instead. It says the same for a row whose night has passed but that is
 * still here (a run that failed, or one still running), since it will go at
 * the next.
 *
 * Measured on the browser's clock, as the list is being looked at; see the
 * Recycle Bin page for how the server's first render hands over to it.
 */

export const RETENTION_DAYS = 30;

/** The hour, UTC, at which `purge-deleted` runs. */
export const PURGE_HOUR_UTC = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the purge removes a row deleted at `deletedAt`, both in epoch milliseconds. */
export function purgeAt(deletedAt: number): number {
	const due = deletedAt + RETENTION_DAYS * DAY_MS;
	const day = new Date(due);
	const run = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), PURGE_HOUR_UTC);
	return run >= due ? run : run + DAY_MS;
}

/** Whole days left before the purge, never below zero. */
export function daysLeft(deletedAt: number, now: number): number {
	return Math.max(0, Math.floor((purgeAt(deletedAt) - now) / DAY_MS));
}

/** "30 days left", "1 day left", or "Less than a day left". */
export function daysLeftLabel(deletedAt: string, now: number): string {
	const days = daysLeft(Date.parse(deletedAt), now);
	if (days === 0) {
		return 'Less than a day left';
	}
	return days === 1 ? '1 day left' : `${days} days left`;
}
