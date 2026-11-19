/**
 * "Choose your password" after a signup link for an account signed up more
 * than once (PRD 10, Section 2). See docs/constraints.md, "Signup with
 * confirmation on".
 *
 * Whoever signed up first chose the account's password (a second signup keeps
 * it, measured), and may not be the person who just confirmed it. So that
 * person chooses a password before going anywhere, and if they do not within
 * the window `/reset-password` accepts, the session ends everywhere and the
 * password is set by email instead: it fails closed. Going in with the first
 * password is never the outcome.
 *
 * The state is `CHOOSE_PASSWORD_COOKIE`, holding the `session_id` of the
 * session the link gave. Only `/auth/confirm` sets it. It counts only beside
 * that same session: any other session, or none, and it is deleted on sight,
 * so it cannot outlive the session it was set for. Its lifetime is the
 * session's cookie's, not the window's, so it is still there when the window
 * has passed: a link's session is a 12-hour one, so neither has a `Max-Age`
 * and both go when the browser closes (`$lib/auth/session-limit`). `HttpOnly`; a person forging it in their own browser can only
 * shut their own session out.
 */
import type { Cookies } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { CHOOSE_PASSWORD_COOKIE, NOTICE_COOKIE, recentRecovery } from './recovery';

/** The one-line reason `/forgot-password` shows after a choice was left too long. */
export const SET_BY_EMAIL = 'set-by-email';

type Auth = SupabaseClient<Database>['auth'];

/** The verified session's `session_id` and `amr`; `null` for no session. Local, no round trip. */
async function sessionClaims(auth: Auth): Promise<{ id: string; amr: unknown } | null> {
	const { data, error } = await auth.getClaims();
	if (error || !data || typeof data.claims.session_id !== 'string') {
		return null;
	}
	return { id: data.claims.session_id, amr: data.claims.amr };
}

/** By `/auth/confirm`, straight after `verifyOtp` gave the session. */
export async function startChoosing(cookies: Cookies, auth: Auth): Promise<boolean> {
	const session = await sessionClaims(auth);
	if (session === null) {
		return false;
	}
	cookies.set(CHOOSE_PASSWORD_COOKIE, session.id, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax'
	});
	return true;
}

export function endChoosing(cookies: Cookies): void {
	cookies.delete(CHOOSE_PASSWORD_COOKIE, { path: '/' });
}

/**
 * `none`: nothing to choose. `pending`: this session must choose, and still
 * may. `lapsed`: this session had to choose and the window has passed.
 * Reads the claims only when the cookie is there.
 */
export async function choosingState(
	cookies: Cookies,
	auth: Auth
): Promise<'none' | 'pending' | 'lapsed'> {
	const marked = cookies.get(CHOOSE_PASSWORD_COOKIE);
	if (marked === undefined) {
		return 'none';
	}
	const session = await sessionClaims(auth);
	if (session === null || session.id !== marked) {
		endChoosing(cookies);
		return 'none';
	}
	return recentRecovery(session.amr, Math.floor(Date.now() / 1000)) ? 'pending' : 'lapsed';
}

/**
 * The routes a person choosing may still use, by `route.id`: the page and its
 * actions, logging out, another email's link, `/forgot-password` (which sends
 * a signed-in person on to the journals, and so back here), and `/wake`, which
 * shows nothing. Static files never reach the hook.
 *
 * An allow-list, so that a route added later is refused without anybody
 * listing it. The rule was the other way round until 2026-10-14: the hook let
 * every JSON route through, on the reading that nothing on the way here called
 * them, and the search, media and autosave routes all answered this session
 * with the account's data (measured; the shell drawn around this page offered
 * Ctrl/Cmd+K, which asks `/search/recent`). See docs/constraints.md, "The
 * pages outside the shell".
 */
export const WHILE_CHOOSING: ReadonlySet<string> = new Set([
	'/reset-password',
	'/logout',
	'/auth/confirm',
	'/forgot-password',
	'/wake'
]);

/**
 * `route.id` for every `+server` file under `src/routes`, from the files
 * themselves: an endpoint added later is one without being listed. A route id
 * keeps its groups, as the path here does.
 */
export function endpointRouteIds(files: readonly string[]): ReadonlySet<string> {
	return new Set(
		files.map((file) => file.replace(/^\/src\/routes/, '').replace(/\/\+server\.[jt]s$/, '') || '/')
	);
}

// Lazy, and never called: only the file names are read.
const ENDPOINTS = endpointRouteIds(Object.keys(import.meta.glob('/src/routes/**/+server.{ts,js}')));

/**
 * What the hook does with a request while a choice is pending. `allow` for
 * the routes above; `refuse` for any other endpoint, which gets the signed-out
 * 401 (a redirect would be read as its answer); `send-back` for everything
 * else, a page, its data, a form action, or an address that matches no route,
 * which goes to `/reset-password`.
 */
export function whileChoosing(
	routeId: string | null,
	endpoints: ReadonlySet<string> = ENDPOINTS
): 'allow' | 'refuse' | 'send-back' {
	if (routeId !== null && WHILE_CHOOSING.has(routeId)) {
		return 'allow';
	}
	return routeId !== null && endpoints.has(routeId) ? 'refuse' : 'send-back';
}

/**
 * The window passed with no password chosen: every session of the account
 * ends (`global`; auth-js removes this one's cookies even when the auth server
 * call fails), and `/forgot-password` says why once.
 */
export async function lapseChoosing(cookies: Cookies, auth: Auth): Promise<void> {
	const { error } = await auth.signOut({ scope: 'global' });
	if (error) {
		console.warn('choose password: global sign-out:', error.code ?? `status ${error.status}`);
	}
	endChoosing(cookies);
	cookies.set(NOTICE_COOKIE, SET_BY_EMAIL, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60
	});
}
