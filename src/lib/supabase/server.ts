import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestEvent } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
	cookieLifetime,
	limitValue,
	nowSeconds,
	recordedChoice,
	sessionStart,
	SESSION_LIMIT_COOKIE,
	type SessionChoice
} from '$lib/auth/session-limit';
import type { CookieWrites } from '$lib/server/cookie-writes';
import type { Database } from '$lib/types/database';
import {
	holdsSession,
	markSession,
	renewMark,
	SESSION_COOKIE_OPTIONS,
	sessionCookieKey,
	storedSession
} from './cookies';
import { retryIssuedAtFuture } from './fetch';

/** The name the session's cookies go under, for this project. */
export const SESSION_COOKIE_KEY = sessionCookieKey(PUBLIC_SUPABASE_URL);

/**
 * The choice for a session this request is about to make: set by the login and
 * signup actions from the box, and by `/auth/confirm` (always `12h`), before
 * they call the auth server; read by `setAll` when the new session is written.
 * `null` until then, and for every request that only refreshes a session.
 */
export type NewSession = { choice: SessionChoice | null };

/**
 * Builds a Supabase client bound to a single request.
 *
 * The cookie handlers close over this event, so the client must not be cached
 * or shared between requests — create one per request and hand it down through
 * `event.locals`.
 *
 * Cookies and headers go through `writes` when given: the hook's recorder, so
 * that a response the hook builds itself carries a refresh or a removal made
 * here (`$lib/server/cookie-writes`).
 *
 * Every call PostgREST, Storage and Auth make goes through `baseFetch`: the
 * hook passes the request's timed `fetch` (`$lib/server/supabase-calls`).
 */
export function createSupabaseServerClient(
	event: RequestEvent,
	writes: Pick<CookieWrites, 'cookies' | 'setHeaders'> = event,
	baseFetch: typeof fetch = fetch,
	newSession: NewSession = { choice: null }
): SupabaseClient<Database> {
	const { cookies } = writes;
	return createServerClient<Database>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		// Retries PostgREST's transient "JWT issued at future" once; see ./fetch.
		// This is the only Supabase client in the app, so the warning lands in the
		// server log. Outside the timing, so each attempt is timed as its own call
		// and the second's wait is not counted as Supabase's.
		global: { fetch: retryIssuedAtFuture(baseFetch, console.warn) },
		// HTTP-only, so no script in a page can read the session; see ./cookies.
		cookieOptions: SESSION_COOKIE_OPTIONS,
		cookies: {
			getAll: () => cookies.getAll(),
			setAll: (cookiesToSet, headers) => {
				// The session as it stands once these are written: the auth server's
				// answer (a sign-in, a refresh, a user update), or none (a sign-out).
				const after = new Map(cookies.getAll().map(({ name, value }) => [name, value]));
				for (const { name, value } of cookiesToSet) after.set(name, value);
				const touched = cookiesToSet.some(({ name }) => holdsSession(name, SESSION_COOKIE_KEY));
				const session = touched
					? storedSession(
							[...after].map(([name, value]) => ({ name, value })),
							SESSION_COOKIE_KEY
						)
					: null;

				// `@supabase/ssr` writes 400 days on every write; the session's own
				// lifetime replaces it, refreshes included. A removal (`maxAge` 0) is
				// left as it is. See `$lib/auth/session-limit`.
				const choice =
					newSession.choice ??
					(session ? recordedChoice(cookies.get(SESSION_LIMIT_COOKIE), session.id) : '12h');
				const lifetime = session
					? cookieLifetime(sessionStart(session.amr), choice, nowSeconds())
					: undefined;

				for (const { name, value, options } of cookiesToSet) {
					// SvelteKit requires an explicit path. Without one the cookie would be
					// scoped to whatever route happened to write it, and the session would
					// disappear on the next navigation.
					const written = { ...options, path: options.path ?? '/' };
					if (holdsSession(name, SESSION_COOKIE_KEY) && options.maxAge !== 0) {
						written.maxAge = lifetime;
					}
					cookies.set(name, value, written);
				}

				// A response that writes auth cookies must not be cached by a CDN, or one
				// user's session token can be served to another. The library sends these
				// headers with the first cookie write only; later calls pass an empty object.
				if (Object.keys(headers).length > 0) {
					writes.setHeaders(headers);
				}

				if (session) {
					// The mark and the choice follow the session, with its lifetime. A
					// session just made gets a new mark, so a page drawn for another
					// session reads it as gone.
					renewMark(cookies, lifetime, newSession.choice !== null);
					cookies.set(SESSION_LIMIT_COOKIE, limitValue(session.id, choice), {
						...SESSION_COOKIE_OPTIONS,
						maxAge: lifetime
					});
				} else if (touched && cookies.get(SESSION_LIMIT_COOKIE) !== undefined) {
					cookies.delete(SESSION_LIMIT_COOKIE, { path: '/' });
				}
				// A session removed, so the mark pages read goes with it.
				markSession(cookies, SESSION_COOKIE_KEY, lifetime);
			}
		}
	});
}
