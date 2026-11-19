/**
 * Signup with email confirmation on or off (PRD 10, Section 2): the address
 * carried to "Check your inbox", and sending the confirmation link again. See
 * docs/constraints.md, "Signup with confirmation on".
 *
 * Nothing it answers says whether the address has an account. `resend` answers
 * 200 for an unconfirmed, a confirmed and an unknown address alike, and 429
 * (`max_frequency`) or 500 (a failed send) only for an unconfirmed one
 * (measured), so every answer but a malformed address is the same one.
 */
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE_KEY } from '$lib/supabase/server';
import { cooldownLeft, startCooldown } from './cooldown.server';
import { dropCodeVerifiers } from './recovery';

/** The page every signup that did not sign anybody in goes to. */
export const CHECK_INBOX_PATH = '/signup/check-inbox';

/**
 * The address a person typed, kept for the "Check your inbox" page so that a
 * reload or Back keeps it without it ever being in an address. `HttpOnly`, an
 * hour (the link's own life, `otp_expiry`), and sent only to that page, which
 * is all that reads it: Send again there and on `/login` both post to it.
 * Not `sb-` anything, so `keepSessionHttpOnly` never touches it. Deleted on
 * confirmation, login and logout.
 */
const ADDRESS_COOKIE = 'nw-confirm-email';
const ADDRESS_MAX_AGE = 60 * 60;

/** The minute this browser waits before asking again; see `./cooldown.server`. */
const COOLDOWN_COOKIE = 'nw-confirm-wait';

export function rememberAddress(cookies: Cookies, email: string): void {
	cookies.set(ADDRESS_COOKIE, email, {
		path: CHECK_INBOX_PATH,
		httpOnly: true,
		sameSite: 'lax',
		maxAge: ADDRESS_MAX_AGE
	});
}

/** The address typed, on `CHECK_INBOX_PATH` only; `null` anywhere else or once it has gone. */
export function rememberedAddress(cookies: Cookies): string | null {
	const email = cookies.get(ADDRESS_COOKIE) ?? '';
	return email.length > 0 ? email : null;
}

/**
 * Deletes it from any route: the removal names the cookie's own path, which
 * need not be the request's. Outside `CHECK_INBOX_PATH` the request never
 * carries the cookie, so nothing can say whether it is there, and the removal
 * is always written.
 */
export function forgetAddress(cookies: Cookies): void {
	cookies.delete(ADDRESS_COOKIE, { path: CHECK_INBOX_PATH });
}

/** Seconds before this browser may ask again; a signup starts the wait too. */
export function confirmWaitLeft(cookies: Cookies): number {
	return cooldownLeft(cookies, COOLDOWN_COOKIE);
}

export function startConfirmWait(cookies: Cookies): number {
	return startCooldown(cookies, COOLDOWN_COOKIE, CHECK_INBOX_PATH);
}

/** Where the email's link opens: the deployment this request reached. */
export function confirmRedirect(url: URL): string {
	return `${url.origin}/auth/confirm`;
}

/**
 * Sends the confirmation link to `email` again, unless this browser asked
 * within the minute. Every outcome is the same answer, the seconds to wait.
 */
export async function sendConfirmLink(
	{ locals, url, cookies }: Pick<RequestEvent, 'locals' | 'url' | 'cookies'>,
	email: string
): Promise<number> {
	const left = confirmWaitLeft(cookies);
	if (left > 0) {
		return left;
	}

	const { error } = await locals.supabase.auth.resend({
		type: 'signup',
		email,
		options: { emailRedirectTo: confirmRedirect(url) }
	});
	// The server client's PKCE flow wrote verifiers into this browser, success or
	// not (auth-js removes two of the three on an error). Never read: the link is
	// verified with `token_hash`.
	dropCodeVerifiers(cookies, SESSION_COOKIE_KEY);
	if (error) {
		// By code alone: never the address.
		console.warn('confirm link: not sent:', error.code ?? `status ${error.status}`);
	}

	return startConfirmWait(cookies);
}
