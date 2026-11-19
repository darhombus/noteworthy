/**
 * The cookie that turns the timing readout on for one browser.
 *
 * Set and removed by `/timing`, read by the root layout's load, which tells the
 * page whether to draw the readout. Its value says only "on", and it names
 * nobody: it is the same in every browser that has it.
 *
 * Not `HttpOnly`: nothing private is in it, and a person can see and clear it
 * in their browser like any setting. A year, `SameSite=Lax`, `Path=/`.
 * `Secure` is left to SvelteKit's default (on everywhere but plain
 * `http://localhost`), as for the session cookies.
 */
export const TIMING_COOKIE = 'nw-timing';
export const TIMING_ON = 'on';

export const TIMING_COOKIE_OPTIONS = {
	path: '/',
	maxAge: 60 * 60 * 24 * 365,
	sameSite: 'lax',
	httpOnly: false
} as const;

/** Whether a cookie value turns the readout on. Anything else is off. */
export function timingOn(value: string | undefined): boolean {
	return value === TIMING_ON;
}
