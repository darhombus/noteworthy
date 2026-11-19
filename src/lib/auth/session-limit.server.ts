/**
 * Ending a session whose limit has passed (`./session-limit`). A real
 * sign-out: the auth server is asked to end this session alone (`local`:
 * measured on the local stack, that session's refresh token is refused
 * afterwards and the account's other sessions are not touched), and the
 * request's cookies go with it. See docs/constraints.md, "Keep me signed in".
 */
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dropSession } from '$lib/supabase/cookies';
import type { Database } from '$lib/types/database';
import { NOTICE_COOKIE } from './recovery';
import {
	LIMIT_NOTICE,
	LIMIT_NOTICE_SECONDS,
	SESSION_LIMIT_COOKIE,
	type SessionChoice
} from './session-limit';

/**
 * Through the request's own client, so the removals go through its `setAll`
 * and the hook's recorder: every kind of response the hook builds carries them.
 * auth-js removes the session's cookies even when the auth server's answer is
 * an error (measured: unreachable, and a 500), though the refresh token then
 * outlives it at Supabase; only the error's code is logged. If the call
 * throws instead, the cookies are deleted here; they are deleted here in
 * every case, which is a no-op once auth-js has.
 */
export async function endAtLimit(
	cookies: Cookies,
	auth: SupabaseClient<Database>['auth'],
	key: string,
	choice: SessionChoice
): Promise<void> {
	try {
		const { error } = await auth.signOut({ scope: 'local' });
		if (error) {
			console.warn('session limit: sign-out:', error.code ?? `status ${error.status}`);
		}
	} catch {
		console.warn('session limit: sign-out threw');
	}
	dropSession(cookies, key);
	if (cookies.get(SESSION_LIMIT_COOKIE) !== undefined) {
		cookies.delete(SESSION_LIMIT_COOKIE, { path: '/' });
	}
	cookies.set(NOTICE_COOKIE, LIMIT_NOTICE[choice], {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: LIMIT_NOTICE_SECONDS
	});
}
