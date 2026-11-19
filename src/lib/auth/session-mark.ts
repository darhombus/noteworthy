/**
 * The one sign of a session a page's script can read.
 *
 * The session cookies `@supabase/ssr` writes are HTTP-only (`$lib/supabase/
 * cookies`), so `document.cookie` holds none of them. A page still has one
 * question about the session it cannot ask the server: whether the session it
 * was drawn for is still the one in this browser, asked by `$lib/auth/stale`
 * when the back/forward cache gives back a page holding unsaved work while the
 * server may be out of reach.
 *
 * So the server keeps this cookie beside the session: set, to a fresh random
 * value, whenever a session appears in this browser where there was none (a
 * login, a signup, the first request after HTTP-only cookies were deployed),
 * left alone while the same session is refreshed, and deleted on the same
 * response that deletes the session (a logout, a refresh the auth server
 * refuses). Its value is random and names nothing: not the person, not the
 * session, not a token. A script that reads it learns that somebody is signed
 * in here, which the page it runs on already shows.
 *
 * Not `HttpOnly`, which is the point, and so Chrome's back/forward cache rule
 * ignores it: what drops a kept page there is the session cookies changing.
 */
export const SESSION_MARK_COOKIE = 'nw-session-mark';

/** The mark in a `document.cookie` string, or `null` when there is none. */
export function readSessionMark(cookie: string): string | null {
	for (const pair of cookie.split(';')) {
		const at = pair.indexOf('=');
		if (at !== -1 && pair.slice(0, at).trim() === SESSION_MARK_COOKIE) {
			const value = pair.slice(at + 1).trim();
			return value.length > 0 ? value : null;
		}
	}
	return null;
}
