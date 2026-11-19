/**
 * The cookies a request wrote, for a response the hook builds itself.
 *
 * SvelteKit attaches the cookies written through `event.cookies`, and the
 * headers set through `event.setHeaders`, to two kinds of response only: one
 * that comes back through `resolve`, and (cookies alone) a `Redirect` thrown
 * out of the hook (`respond.js`). A `Response` the hook *returns* gets neither.
 * The hook returns three: the signed-in redirect away from `/`, `/login` and
 * `/signup` (`toAppHome`), the signed-out redirect to `/login` (`toLogin`,
 * thrown until 2026-10-06, and still thrown for `__data.json`), and the
 * signed-out 401 for a JSON route. All come after `getClaims()`, which may
 * have refreshed the session or removed it, and after the HTTP-only upgrade,
 * so each can owe the browser cookies, and the
 * `Cache-Control` that `@supabase/ssr` sends with any response that writes
 * them.
 *
 * A refresh whose cookies are lost leaves the browser the refresh token the
 * auth server has just rotated away from. Auth v2.197.0 lets a token one
 * rotation old through at any time, answering with the token it rotated to, so
 * nobody was signed out by it; but every later request refreshed again until a
 * response from `resolve` wrote the cookies, and a token two rotations old is
 * refused (`tests/auth/cookies.test.ts`). The upgrade, and a 401's removal of
 * a session the auth server refused, were lost the same way.
 *
 * So the hook writes through `record`'s jar and `setHeaders`, and `handOver`
 * puts what was written on a response the hook built. Each cookie is
 * serialized by SvelteKit's own `cookies.serialize`, which applies the same
 * defaults and path resolution as the header SvelteKit writes itself; only the
 * last write of each cookie counts, as in SvelteKit's own list. Headers are set
 * over whatever the response had, as SvelteKit does with `setHeaders`. Never
 * hand over a response that came through `resolve`, or a thrown redirect: the
 * browser would get each cookie twice.
 */
import type { Cookies, RequestEvent } from '@sveltejs/kit';

type Options = Parameters<Cookies['set']>[2];

export type CookieWrites = {
	/** The request's jar, recording what is written through it. */
	cookies: Cookies;
	/** `event.setHeaders`, recording what it is given. */
	setHeaders(headers: Record<string, string>): void;
	/** `response`, carrying every cookie and header written so far. */
	handOver(response: Response): Response;
};

export function recordCookieWrites(
	event: Pick<RequestEvent, 'cookies' | 'setHeaders'>
): CookieWrites {
	const jar = event.cookies;
	const written = new Map<string, { name: string; value: string; options: Options }>();
	const headers = new Map<string, string>();

	const note = (name: string, value: string, options: Options) =>
		written.set(`${options.domain ?? ''}|${options.path}|${name}`, { name, value, options });

	const cookies: Cookies = {
		get: (name, options) => jar.get(name, options),
		getAll: (options) => jar.getAll(options),
		serialize: (name, value, options) => jar.serialize(name, value, options),
		set(name, value, options) {
			jar.set(name, value, options);
			note(name, value, options);
		},
		delete(name, options) {
			jar.delete(name, options);
			note(name, '', { ...options, maxAge: 0 });
		}
	};

	return {
		cookies,
		setHeaders(set) {
			event.setHeaders(set);
			for (const [name, value] of Object.entries(set)) headers.set(name.toLowerCase(), value);
		},
		handOver(response) {
			for (const [name, value] of headers) response.headers.set(name, value);
			for (const { name, value, options } of written.values()) {
				response.headers.append('set-cookie', jar.serialize(name, value, options));
			}
			return response;
		}
	};
}
