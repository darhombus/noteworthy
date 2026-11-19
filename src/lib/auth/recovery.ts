/**
 * A password reset, from the email's link to the new password (PRD 10,
 * Section 1). See docs/constraints.md, "Forgot password".
 *
 * The link opens `/auth/confirm`, whose button POSTs the token to
 * `verifyOtp({ type, token_hash })`. Not the code exchange the server client's
 * PKCE flow is built for: that needs the verifier cookie of the browser that
 * asked, and the link is often opened somewhere else (the phone's mail app).
 * `token_hash` verifies in any browser (measured against the local stack).
 */
import type { Cookies } from '@sveltejs/kit';

/** The link types `/auth/confirm` takes: a password reset, and a signup's confirmation. */
export type ConfirmType = 'recovery' | 'signup';

export function confirmType(value: string | null): ConfirmType | null {
	return value === 'recovery' || value === 'signup' ? value : null;
}

/**
 * Where each type may go after verifying, the first entry the default. A
 * `next` from the address is used only when it is on its type's list, so no
 * link can send anybody off the site or anywhere the type does not lead.
 *
 * Signup's list holds `/journals` alone. Its other destination,
 * `/reset-password` for an account signed up more than once
 * (`signedUpAgain`), is decided from the auth server's data, never from the
 * address.
 */
const DESTINATIONS: Record<ConfirmType, readonly [string, ...string[]]> = {
	recovery: ['/reset-password'],
	signup: ['/journals']
};

export function confirmDestination(type: ConfirmType, next: string | null): string {
	const allowed = DESTINATIONS[type];
	return next !== null && allowed.includes(next) ? next : allowed[0];
}

/**
 * How long after an account is made its first confirmation email is stamped,
 * at most, for it to count as the only one. Measured on the local stack: 20 to
 * 38 ms over nine signups, one of them with the send held up 3 s (the auth
 * server stamps before it sends, so a slow mail provider adds nothing). A
 * second signup or a resend cannot come sooner than `max_frequency` after the
 * last email (1 s locally, a minute by default on hosted), so this must stay
 * below every environment's `max_frequency`.
 */
export const SIGNED_UP_AGAIN_MS = 500;

type SignupStamps = { created_at?: unknown; confirmation_sent_at?: unknown };

/**
 * Whether the account a signup link confirms was signed up more than once, or
 * sent its link again: its latest confirmation email went out well after it
 * was made. Both stamps are the auth server's own, read from what `verifyOtp`
 * returns.
 *
 * A second signup for an unconfirmed address keeps the first password
 * (measured), so whoever signed up first may know the password of the account
 * the owner is about to confirm. Such a person chooses their password before
 * going in. A missing or unreadable stamp counts as signed up again: the safe
 * side costs one password typed.
 */
export function signedUpAgain(user: SignupStamps | null | undefined): boolean {
	const created = typeof user?.created_at === 'string' ? Date.parse(user.created_at) : NaN;
	const sent =
		typeof user?.confirmation_sent_at === 'string' ? Date.parse(user.confirmation_sent_at) : NaN;
	if (!Number.isFinite(created) || !Number.isFinite(sent)) {
		return true;
	}
	return sent - created > SIGNED_UP_AGAIN_MS;
}

/**
 * Holds the `session_id` of a session that must choose its password before
 * going anywhere: set by `/auth/confirm` alone, and read through
 * `./choose-password.server`, which explains the rules.
 */
export const CHOOSE_PASSWORD_COOKIE = 'nw-choose-password';

/**
 * How recent a recovery must be for `/reset-password`: a session whose `amr`
 * holds `otp` from the last 15 minutes. A recovery session carries `otp` (no
 * "recovery" label, measured), and so would a magic link, which this project
 * does not offer. A password login carries `password`. The timestamp is the
 * verification's, and a refresh keeps it, so a session cannot stay qualified by
 * being refreshed.
 */
export const RECOVERY_WINDOW_SECONDS = 15 * 60;

type AmrEntry = { method?: unknown; timestamp?: unknown };

export function recentRecovery(amr: unknown, nowSeconds: number): boolean {
	if (!Array.isArray(amr)) {
		return false;
	}
	return amr.some((entry: AmrEntry) => {
		const { method, timestamp } = entry ?? {};
		return (
			method === 'otp' &&
			typeof timestamp === 'number' &&
			timestamp <= nowSeconds + 60 &&
			nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS
		);
	});
}

/**
 * The PKCE verifier cookies under the session's name: `<key>-code-verifier`,
 * `<key>-flows-code-verifier` and `<key>-flow-<id>-code-verifier`.
 */
function isCodeVerifier(name: string, key: string): boolean {
	return name.startsWith(`${key}-`) && name.endsWith('-code-verifier');
}

/**
 * Deletes every PKCE verifier cookie in the jar, this request's writes
 * included. `createServerClient` forces the PKCE flow, so
 * `resetPasswordForEmail` writes three of them, for any address, and nothing
 * here ever reads them back: the link is verified with `token_hash`.
 */
export function dropCodeVerifiers(cookies: Cookies, key: string): void {
	for (const { name } of cookies.getAll()) {
		if (isCodeVerifier(name, key)) {
			cookies.delete(name, { path: '/' });
		}
	}
}

/**
 * The one-time notice `/journals` shows after a password change: a short-lived
 * cookie rather than a query, so a reload or a shared address does not show it
 * again, and it works without JavaScript.
 */
export const NOTICE_COOKIE = 'nw-notice';
export const PASSWORD_CHANGED = 'password-changed';
