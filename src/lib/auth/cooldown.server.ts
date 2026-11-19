/**
 * How long a browser waits before asking for another email: a minute, hosted's
 * default `max_frequency`, whoever the address belongs to. Kept per browser in
 * an `HttpOnly` cookie holding the second it ends, by the server's clock. An
 * early press sends nothing and gets the same answer with the time left, so
 * the auth server's own limit (a 429 only for an address with an account,
 * measured) is never what a person sees.
 *
 * One cookie per kind of email: the reset link's (PRD 10, Section 1) and the
 * confirmation link's (Section 2) do not hold each other up.
 */
import type { Cookies } from '@sveltejs/kit';

export const COOLDOWN_SECONDS = 60;

/** Seconds left before this browser may ask again; 0 when it may. */
export function cooldownLeft(cookies: Cookies, name: string): number {
	const now = Math.floor(Date.now() / 1000);
	const until = Number(cookies.get(name));
	return Number.isFinite(until) && until > now ? until - now : 0;
}

/** Starts the wait; returns its length. */
export function startCooldown(cookies: Cookies, name: string, path = '/'): number {
	const now = Math.floor(Date.now() / 1000);
	cookies.set(name, String(now + COOLDOWN_SECONDS), {
		path,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: COOLDOWN_SECONDS
	});
	return COOLDOWN_SECONDS;
}
