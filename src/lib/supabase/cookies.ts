/**
 * How the session's cookies are written: HTTP-only, so that no script in a page
 * can ever read a token.
 *
 * `@supabase/ssr` 0.12.7 writes every cookie with its `DEFAULT_COOKIE_OPTIONS`
 * (`path: '/'`, `sameSite: 'lax'`, `httpOnly: false`, `maxAge` 400 days)
 * overlaid with the client's `cookieOptions`, except that `maxAge` is always its
 * own: 400 days on a write, 0 on a removal (`applyServerStorage` and the
 * storage's `setItem`/`removeItem` in its `cookies.js`). So `httpOnly` here
 * reaches every write, refreshes and removals included; and the server
 * client's `setAll` replaces that `maxAge` on every write of the session that
 * is not a removal with the session's own lifetime (`$lib/auth/session-limit`).
 *
 * `secure` is left to SvelteKit, whose `cookies.set` defaults it to on
 * everywhere except plain `http://localhost` (its `cookie.js`), so every HTTPS
 * site gets Secure cookies, as it did before this. Not set from the request's
 * protocol here, which could only make it weaker where the protocol is
 * misreported.
 *
 * Nothing in the browser needs the session any more: uploads go through links
 * the server makes (`$lib/media/upload-link.server`), and the browser's
 * Supabase client is gone. Token refresh happens only on the server, inside
 * `getClaims()` in the hook: the server client never refreshes on a timer
 * (`autoRefreshToken: false` in `createServerClient`), it refreshes a session
 * whose `expires_at` is less than 90 seconds away when the session is read.
 */
import type { Cookies } from '@sveltejs/kit';
import { SESSION_MARK_COOKIE } from '$lib/auth/session-mark';

export const SESSION_COOKIE_OPTIONS = {
	path: '/',
	sameSite: 'lax',
	httpOnly: true
} as const;

/**
 * A session cookie's `maxAge`: seconds, or `undefined` for a cookie the browser
 * deletes when it closes (`cookieLifetime` in `$lib/auth/session-limit`).
 * SvelteKit writes neither `Max-Age` nor `Expires` for `undefined` (its
 * `cookie.js` sets no default, and `cookie`'s `serialize` writes `Max-Age`
 * only for a `maxAge` that is not null).
 */
export type Lifetime = number | undefined;

/**
 * The name supabase-js keeps the session under, and so the cookie's name:
 * `sb-<first label of the project's host>-auth-token` (`defaultStorageKey` in
 * its `SupabaseClient`). Chunks of a long session add `.0`, `.1` and so on; the
 * PKCE verifier adds `-code-verifier`.
 */
export function sessionCookieKey(supabaseUrl: string): string {
	return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
}

/** The session itself, whole or in chunks: what `isChunkLike` in `@supabase/ssr` matches. */
export function holdsSession(name: string, key: string): boolean {
	return name === key || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1)));
}

/** A chunk's place in the session: the whole cookie first, then `.0`, `.1`, … */
function chunkIndex(name: string, key: string): number {
	return name === key ? -1 : Number(name.slice(key.length + 1));
}

/**
 * The `session_id` and `amr` of the session stored in `cookies`, joined from its
 * chunks as `@supabase/ssr` writes them (`base64-` and base64url JSON), read
 * from its access token without verifying it. Only for a session the auth
 * server has just answered with (the server client's `setAll`); a session
 * from the request is verified by `getClaims()` instead. `null` when there is
 * none or it cannot be read.
 */
export function storedSession(
	cookies: readonly { name: string; value: string }[],
	key: string
): { id: string; amr: unknown } | null {
	const joined = cookies
		.filter(({ name, value }) => holdsSession(name, key) && value.length > 0)
		.sort((a, b) => chunkIndex(a.name, key) - chunkIndex(b.name, key))
		.map(({ value }) => value)
		.join('');
	if (!joined.startsWith('base64-')) {
		return null;
	}
	try {
		const session = JSON.parse(
			Buffer.from(joined.slice('base64-'.length), 'base64url').toString()
		) as { access_token?: unknown };
		if (typeof session.access_token !== 'string') {
			return null;
		}
		const claims = JSON.parse(
			Buffer.from(session.access_token.split('.')[1] ?? '', 'base64url').toString()
		) as { session_id?: unknown; amr?: unknown };
		return typeof claims.session_id === 'string'
			? { id: claims.session_id, amr: claims.amr }
			: null;
	} catch {
		return null;
	}
}

/**
 * Deletes the session's chunks and the mark straight from the jar: for when
 * signing out could not be asked of the auth server at all.
 */
export function dropSession(cookies: Cookies, key: string): void {
	for (const { name, value } of cookies.getAll()) {
		if (holdsSession(name, key) && value.length > 0) {
			cookies.delete(name, { ...SESSION_COOKIE_OPTIONS });
		}
	}
	if (cookies.get(SESSION_MARK_COOKIE) !== undefined) {
		cookies.delete(SESSION_MARK_COOKIE, { path: '/' });
	}
}

function hasSession(cookies: Cookies, key: string): boolean {
	return cookies.getAll().some(({ name, value }) => holdsSession(name, key) && value.length > 0);
}

function freshMark(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Keeps `SESSION_MARK_COOKIE` beside the session: a new value when there is a
 * session and no mark, deleted when there is a mark and no session, and left
 * alone otherwise. Reads the jar as it stands, this request's writes included.
 * A new mark lives as long as the session's cookies (`lifetime`).
 */
export function markSession(cookies: Cookies, key: string, lifetime: Lifetime): void {
	const session = hasSession(cookies, key);
	const mark = cookies.get(SESSION_MARK_COOKIE);
	if (session && !mark) {
		writeMark(cookies, freshMark(), lifetime);
	} else if (!session && mark !== undefined) {
		cookies.delete(SESSION_MARK_COOKIE, { path: '/' });
	}
}

/**
 * Writes the mark with the session's lifetime: `fresh` for a session just
 * made, else the mark already there (a refresh keeps it), else a new one.
 */
export function renewMark(cookies: Cookies, lifetime: Lifetime, fresh: boolean): void {
	writeMark(cookies, (!fresh && cookies.get(SESSION_MARK_COOKIE)) || freshMark(), lifetime);
}

function writeMark(cookies: Cookies, value: string, lifetime: Lifetime): void {
	cookies.set(SESSION_MARK_COOKIE, value, {
		path: '/',
		sameSite: 'lax',
		httpOnly: false,
		maxAge: lifetime
	});
}

/**
 * Makes the session cookies of somebody signed in before they were HTTP-only
 * HTTP-only too, at their first request, without signing them out.
 *
 * `@supabase/ssr` writes a cookie only when its value changes
 * (`setCookiesToWrite` in `applyServerStorage`), so left to itself an old
 * cookie would stay readable by script until the session's next refresh, up to
 * the token's lifetime (an hour) of requests later, or forever for a tab whose
 * owner stopped making requests. A request carries cookies without their
 * attributes, so nothing on it says which kind it has. The mark does: every
 * session cookie written since this was deployed is written with it, so a
 * session without one dates from before, and its cookies are written again,
 * with the same values, HTTP-only, and the mark is set. Each session is
 * rewritten once.
 *
 * Every cookie under the session's name is rewritten, chunks and the PKCE
 * verifier included, with the values SvelteKit decoded from the request, which
 * `cookies.set` encodes back the same way, as it did when it first wrote them.
 *
 * Only when a session is there. No mark is also what every signed-out browser
 * has, and a PKCE verifier on its own (left by a password-reset request) is
 * under the session's name too: measured on the built app, the verifiers alone
 * were written again on every signed-out response, with no mark ever set to
 * end it.
 *
 * Written with the verified session's own lifetime (`lifetime`, from the hook),
 * as every write of a session is since PRD 11.
 */
export function keepSessionHttpOnly(cookies: Cookies, key: string, lifetime: Lifetime): void {
	if (!cookies.get(SESSION_MARK_COOKIE) && hasSession(cookies, key)) {
		for (const { name, value } of cookies.getAll()) {
			if (name.startsWith(key) && value.length > 0) {
				cookies.set(name, value, { ...SESSION_COOKIE_OPTIONS, maxAge: lifetime });
			}
		}
	}
	markSession(cookies, key, lifetime);
}
