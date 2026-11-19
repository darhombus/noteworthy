/**
 * When a waiting file will be cleared, stated so that it matches when
 * `remove-unused-media` really removes it. The Recycle Bin's rows' twin of
 * `retention.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHEN THE FILE GOES
 * ---------------------------------------------------------------------------
 * The job runs once a night, at `0 4 * * *` with `cron.timezone` GMT
 * (`20260924120000_remove_unused_media`; checked locally 2026-09-26). It skips
 * a file while
 *
 *     r.released_at >= now() - interval '24 hours'
 *
 * (`unused_media()`), so it takes it at the first run where
 * `released_at < now() - interval '24 hours'`: released more than 24 hours
 * before the run. The database's TimeZone is UTC, so the interval is exactly
 * 24 hours. That run is between 24 and 48 hours after the release, depending on
 * the time of day it happened: a file taken out at 04:30 UTC is 23½ hours old
 * at the next run and waits for the one after.
 *
 * `now()` is the run's transaction start, a fraction of a second after
 * 04:00:00. So a file whose 24 hours end at exactly 04:00:00 is taken by that
 * run, and this says so; the one moment it gets wrong is a file whose 24 hours
 * end within that fraction of a second after four, shown a day early. The same
 * caveat as `retention.ts`.
 *
 * The job has a second condition, that the file was uploaded more than 24
 * hours before the run. A waiting file was uploaded before it was released, so
 * the release condition is always the later of the two, and the only one here.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS SHOWN
 * ---------------------------------------------------------------------------
 * "Clears Wed 07:00": the run's weekday and time in the viewer's own time zone,
 * 24-hour. A weekday is enough: the run is never two days away, let alone
 * seven. Once that moment has passed and the row is still here (the run is
 * under way, or it failed and the next one will try), "Clearing soon".
 *
 * Only in the browser, from its own clock and time zone. The server's zone is
 * UTC, and a time rendered there would show, until hydration, in the wrong
 * zone; the page shows nothing until it runs.
 */

/** The hour, UTC, at which `remove-unused-media` runs. */
export const CLEANUP_HOUR_UTC = 4;

/** How long after its release the job leaves a file alone. */
export const RELEASE_HOLD_MS = 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** When the job removes a file released at `releasedAt`, both in epoch milliseconds. */
export function clearsAt(releasedAt: number): number {
	const due = releasedAt + RELEASE_HOLD_MS;
	const day = new Date(due);
	const run = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), CLEANUP_HOUR_UTC);
	return run >= due ? run : run + DAY_MS;
}

/**
 * "Clears Wed 07:00", or "Clearing soon" once that moment has come. `timeZone`
 * is for tests; the page leaves it out, and the browser uses the viewer's.
 */
export function clearsLabel(releasedAt: string, now: number, timeZone?: string): string {
	const at = clearsAt(Date.parse(releasedAt));
	if (now >= at) {
		return 'Clearing soon';
	}
	const when = new Intl.DateTimeFormat('en-GB', {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone
	}).format(at);
	return `Clears ${when}`;
}
