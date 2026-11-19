import { redirect } from '@sveltejs/kit';
import { forgetAddress } from '$lib/auth/confirm-link.server';
import { CHOOSE_PASSWORD_COOKIE } from '$lib/auth/recovery';
import type { RequestHandler } from './$types';

/**
 * POST only, deliberately. A GET logout can be fired by a prefetch, a crawler
 * or an `<img src>` on another site, signing people out without them asking.
 *
 * Calling `signOut()` on the *server* client is what clears the cookies:
 * `@supabase/ssr` writes the removals through the same `setAll` the hook wired
 * to `event.cookies`, so they ride out on this response. Clearing only a
 * browser-side session would leave the cookie sitting there and the very next
 * request would still arrive signed in.
 */
export const POST: RequestHandler = async ({ locals, cookies }) => {
	// The default scope is `global` (auth-js 2.116): it revokes the refresh tokens
	// of every session of the account, on every device, not only this one. Kept
	// so for now; a this-device Log out belongs to the settings PRD
	// (docs/constraints.md, "Keep me signed in"). If that call fails the cookies are
	// still cleared locally, and there is nothing useful to say to someone on
	// their way out, so the redirect is unconditional.
	await locals.supabase.auth.signOut();
	// Nothing a signup left in this browser outlives the person leaving it.
	forgetAddress(cookies);
	cookies.delete(CHOOSE_PASSWORD_COOKIE, { path: '/' });

	redirect(303, '/login');
};
