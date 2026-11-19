/**
 * Sending a password-reset link, for `/forgot-password` and for the "Email me
 * a new link" on `/reset-password`. See docs/constraints.md, "Forgot password".
 *
 * Nothing it answers says whether the address has an account. The auth server
 * answers 429 (`max_frequency`) and 500 (a failed send) only for an address
 * with one, and 200 for any other (measured), so all three are the one answer,
 * `sent`. Only a malformed address is told so, which is about how it was
 * typed. The time the auth server takes still differs, since it sends before
 * it answers: an accepted limit.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { SESSION_COOKIE_KEY } from '$lib/supabase/server';
import { cooldownLeft, startCooldown } from './cooldown.server';
import { dropCodeVerifiers } from './recovery';

/** The minute this browser waits before asking again; see `./cooldown.server`. */
const COOLDOWN_COOKIE = 'nw-reset-wait';

export type ResetLinkAnswer = { kind: 'sent'; wait: number } | { kind: 'malformed' };

export async function sendResetLink(
	{ locals, url, cookies }: Pick<RequestEvent, 'locals' | 'url' | 'cookies'>,
	email: string
): Promise<ResetLinkAnswer> {
	const left = cooldownLeft(cookies, COOLDOWN_COOKIE);
	if (left > 0) {
		return { kind: 'sent', wait: left };
	}

	const { error } = await locals.supabase.auth.resetPasswordForEmail(email, {
		// The deployment this request reached. The template links here when it is
		// on the allow list, and to the Site URL's `/auth/confirm` otherwise.
		redirectTo: `${url.origin}/auth/confirm`
	});
	// The server client's PKCE flow wrote verifiers into this browser, for any
	// address. The link is verified with `token_hash`, so they are never read.
	dropCodeVerifiers(cookies, SESSION_COOKIE_KEY);

	if (error?.code === 'validation_failed') {
		return { kind: 'malformed' };
	}
	if (error) {
		// By code alone: never the address.
		console.warn('reset link: not sent:', error.code ?? `status ${error.status}`);
	}

	return { kind: 'sent', wait: startCooldown(cookies, COOLDOWN_COOKIE) };
}
