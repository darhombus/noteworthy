import { json, redirect, type Handle, type RequestEvent } from '@sveltejs/kit';
import { recordCookieWrites } from '$lib/server/cookie-writes';
import { keepSessionHttpOnly, type Lifetime } from '$lib/supabase/cookies';
import { createSupabaseServerClient, SESSION_COOKIE_KEY } from '$lib/supabase/server';
import { verifiedSession } from '$lib/auth/verify';
import {
	cookieLifetime,
	limitPassed,
	nowSeconds,
	recordedChoice,
	sessionStart,
	SESSION_LIMIT_COOKIE
} from '$lib/auth/session-limit';
import { endAtLimit } from '$lib/auth/session-limit.server';
import { choosingState, lapseChoosing, whileChoosing } from '$lib/auth/choose-password.server';
import { APP_HOME, AUTH_ENTRY_PATHS } from '$lib/auth/routes';
import { THEME_COOKIE, parseTheme, themeAttribute } from '$lib/theme/cookie';
import { firstRequest, serverTiming, withServerTiming } from '$lib/server/timing';
import { supabaseCalls } from '$lib/server/supabase-calls';

/**
 * The slot in `src/app.html` that the theme class goes into.
 *
 * Not `%sveltekit.something%`: that prefix is SvelteKit's own namespace, and it
 * has no placeholder for attributes on `<html>` — the only tags it requires are
 * `%sveltekit.head%` and `%sveltekit.body%`, and it substitutes `%sveltekit.
 * assets%`, `%sveltekit.nonce%` and `%sveltekit.env.*%`. An invented name under
 * that prefix would read like a framework feature and be nobody's to maintain.
 * Unrecognised placeholders are left alone rather than rejected, so this one
 * survives the build untouched and `transformPageChunk` below fills it.
 *
 * The pattern eats whatever whitespace precedes the placeholder, and
 * `themeAttribute` supplies its own leading space. That is what keeps `system`
 * rendering `<html lang="en">` exactly, with no orphaned space where the
 * attribute would have been — and it keeps that true no matter how Prettier
 * lays the tag out, which it will: it reformats `app.html` on every
 * `npm run format` and normalises the gap between attributes itself.
 */
const THEME_PLACEHOLDER = /\s*%nw\.htmlclass%/;

/**
 * Route protection is expressed as a deny-by-default list of public paths,
 * enforced here in the hook — not as an `(app)` route group with a
 * `+layout.server.ts` guard.
 *
 * Both express the same rule. The list wins on how each one fails. A route
 * added outside a protected group is silently public, and nothing about the
 * file flags it in review. A route not added to this list is protected, and
 * the failure is a developer bouncing to /login — loud, immediate, harmless.
 *
 * Everything not named here requires a verified identity.
 *
 * `/theme` is *not* here, and that is a decision rather than an omission. It was
 * public while the toggle sat on the landing, login and signup pages; those
 * pages no longer offer it, so the only thing that posts to `/theme` is the
 * sidebar, and the sidebar only renders for somebody signed in. A public path
 * nothing anonymous uses is public surface bought for nothing.
 *
 * The signed-out pages still *honour* the theme. Nothing about that goes
 * through this list: the cookie is read below on every request whatever the
 * route, and with no cookie the media query in `layout.css` follows the OS.
 * Reading a preference and changing one are different questions, and only the
 * second needed a route.
 *
 * `/timing` is public: it turns the timing readout on or off for one browser
 * (`$lib/timing/cookie`), and the login page's own timings are among the ones
 * worth reading. It shows and stores nothing about anybody.
 *
 * `/wake` is public: a 204 with no body that the app asks for after a pause,
 * signed in or out, so that this hook runs before the next tap does
 * (`src/routes/wake/+server.ts`). A signed-out page needs the server awake as
 * much as a signed-in one, and a redirect or a 401 would be a round trip spent
 * on nothing.
 *
 * `/forgot-password` is public for the reason `/login` is. `/auth/confirm` is
 * public and is not in `AUTH_ENTRY_PATHS`: an email's link is followed by
 * whoever holds it, signed in or not, and verifying replaces the session.
 * `/reset-password` is not public: it needs the session the link gave.
 * `/signup/check-inbox` is public for the reason `/signup` is.
 */
const PUBLIC_PATHS = new Set([
	'/',
	'/login',
	'/signup',
	'/signup/check-inbox',
	'/forgot-password',
	'/auth/confirm',
	'/timing',
	'/wake'
]);

/**
 * Routes that answer a request rather than render a page, by `route.id`.
 *
 * A 303 to `/login` is the right answer for somebody whose session expired
 * while they were clicking a link, and exactly the wrong one for `fetch`.
 * `fetch` follows redirects without being asked, so the autosave call would
 * come back `ok: true`, status 200, holding the HTML of the login page — and
 * the editor would report the entry as saved while nothing had been written.
 * Silent data loss, dressed as a success.
 *
 * So these routes get a 401 with a `reason` the client can act on. Matched on
 * `route.id` rather than on the path, because the path contains two uuids and
 * the route id is the thing that is actually stable.
 *
 * Anything added here must answer JSON on its own paths too, or a caller will
 * get a JSON body for one failure and HTML for another.
 */
const JSON_ROUTES = new Set([
	'/journals/[journalId]/entries/[entryId]/autosave',
	// Fresh signed links for a page's photos; see `$lib/media/links`.
	'/media/sign',
	// A signed upload link for one file; see `$lib/media/upload-link.server`.
	'/media/upload',
	// A page of search results, for Show more; see `$lib/search/search.server`.
	'/search/results',
	// The search page's data, for its universal load; see `$lib/search/page-data`.
	'/search/page',
	// The quick-search modal's recently edited entries.
	'/search/recent'
]);

/**
 * Nothing sent to a signed-in person may be stored, by their browser or by
 * anything between it and Vercel: every such response is their own writing,
 * their journals' names, or a search they typed.
 *
 * SvelteKit sends no `Cache-Control` on a rendered page or a `+server.ts`
 * answer (it does send `private, no-store` on `__data.json`), and Vercel then
 * sends `public, max-age=0, must-revalidate`. Vercel's CDN stores nothing
 * without `s-maxage`, but `public` lets the browser keep the page on disk and
 * any proxy keep a copy, and a browser's Back shows a stored page without
 * asking the server. After logging out, that would put the entry back on
 * screen. `private, no-store` rules all of it out.
 *
 * Only when nothing has set one already. SvelteKit's own header on
 * `__data.json` stands, and so does the stronger set the Supabase client sends
 * on a request that refreshed the session (`$lib/supabase/server`).
 *
 * Set on the response here, not with `setHeaders` in each load: `setHeaders`
 * throws when a header is set twice, and the Supabase client sets
 * `Cache-Control` through it on exactly those refreshing requests.
 *
 * Signed out, the same goes for every HTML page (the landing page, login,
 * signup, an error page), though nothing on them is private. SvelteKit keeps
 * the document a person signed in on for the whole session: login, journals,
 * entries are all drawn inside it. Chrome decides whether to keep a document
 * for Back by that document's own response, so a session begun on a cacheable
 * `/login` was kept through the logout and restored on Back, and the restore
 * guard (`$lib/auth/stale`) hid it and reloaded: a blank screen for a round
 * trip or two (docs/constraints.md, "Back after logout on the real site").
 * With `no-store` on that first document too, the logout's change to the
 * HTTP-only cookies makes Chrome drop it, and Back is an ordinary navigation
 * that keeps the old page on screen until the new one paints. So does every
 * redirect the hook builds, signed in or out (`toAppHome`, `toLogin`): a
 * browser stores a redirect too, and uses it for Back without asking. Other
 * signed-out JSON (a form's failed answer, the 401s) is left as it is.
 *
 * The hook never sees static files: `static/` and the built `_app/immutable/`
 * are served before it runs, locally by the preview server and on Vercel from
 * its CDN.
 */
const NO_STORE = 'private, no-store';

function withoutStorage(response: Response): Response {
	if (!response.headers.has('cache-control')) {
		response.headers.set('cache-control', NO_STORE);
	}
	return response;
}

function isPage(response: Response): boolean {
	return response.headers.get('content-type')?.startsWith('text/html') ?? false;
}

/**
 * Whether a POST came from `use:enhance`, which asks for the action's result as
 * JSON and parses whatever comes back as JSON. A form posted by the browser
 * itself asks for HTML. This is SvelteKit's own test (`is_action_json_request`,
 * not exported): `application/json` preferred over `text/html`.
 */
function isEnhancedPost(request: Request): boolean {
	const accept = request.headers.get('accept') ?? '';
	return (
		request.method === 'POST' &&
		accept.includes('application/json') &&
		!accept.includes('text/html')
	);
}

/**
 * A signed-in visitor's way off `/`, `/login` and `/signup`, in the form the
 * request can read.
 *
 * Returned rather than thrown with `redirect()`, which would leave the hook
 * before `withoutStorage`: this is a signed-in response too. But SvelteKit
 * reshapes only a *thrown* redirect for each kind of request. A returned one it
 * converts for `__data.json` alone, so a 303 sent to an enhanced form POST is
 * followed by `fetch`, the journals page's HTML comes back, and `use:enhance`
 * shows its `JSON.parse` failure as a 500 ("Unexpected token '<' … is not valid
 * JSON"). Measured two ways: the login form left open in one tab while the
 * person signs in in another, then submitted; and a second press of Login
 * while the first one's navigation waits for `/journals`, which is how it was
 * seen (the buttons now refuse that: `$lib/auth/pending.svelte`). Nothing
 * fails on the server, so nothing is logged.
 *
 * The JSON is an `ActionResult` redirect, what `deserialize` from `$app/forms`
 * reads: `use:enhance` then navigates to `APP_HOME`, re-running every load.
 *
 * Thrown for `__data.json` and remote calls, as `toLogin` is. SvelteKit
 * replaces a 303 the hook *returns* for a data request with its own JSON
 * redirect after the hook has gone (`respond.js`), and the replacement carried
 * nothing the hook had put on it: a session refreshed by `getClaims()` on that
 * request was lost (docs/constraints.md, "Server-only sessions"). A thrown
 * redirect gets its JSON built in SvelteKit's catch, with every cookie written
 * through `event.cookies`, and it is `private, no-store` already.
 */
function toAppHome(event: RequestEvent): Response {
	return sendTo(event, APP_HOME);
}

/** A 303 to `location` in the form each kind of request reads; see `toAppHome`. */
function sendTo(event: RequestEvent, location: string): Response {
	if (event.isDataRequest || event.isRemoteRequest) {
		redirect(303, location);
	}
	if (isEnhancedPost(event.request)) {
		return json({ type: 'redirect', status: 303, location });
	}
	return new Response(null, { status: 303, headers: { location } });
}

/**
 * A signed-out visitor's way to `/login`, from any page that needs a session.
 *
 * Built here rather than thrown, so that it is sent `private, no-store` like
 * every other redirect the hook makes. SvelteKit builds the answer to a
 * thrown redirect after the hook has returned, with only a `location`, and
 * Vercel then sends it `public, max-age=0, must-revalidate`. Chrome stored that
 * 303 and, on a `back_forward` navigation, used it without asking: measured on
 * dev, the entry's 303 came back in under a millisecond with an earlier
 * response's `Date`. So after signing in again, history to an entry was sent
 * to `/login` from the browser's cache and on to `/journals` by the hook, the
 * entry never asked for (docs/constraints.md, "Back after logout on the real
 * site").
 *
 * Still thrown for `__data.json` and remote calls: SvelteKit turns it into its
 * own JSON redirect there, already `private, no-store`, which its client reads.
 * That answer is built after the hook has thrown, so it carries no
 * `Server-Timing`. An enhanced form POST gets the `ActionResult` redirect SvelteKit would send,
 * as `toAppHome` does.
 */
function toLogin(event: RequestEvent): Response {
	return sendTo(event, '/login');
}

/** The 401 a JSON route answers for want of a session, which its callers act on. */
function signedOutJson(): Response {
	return json({ reason: 'signed-out', message: 'You have been signed out.' }, { status: 401 });
}

export const handle: Handle = async ({ event, resolve }) => {
	// First, so that `app` counts everything the hook does. Every response that
	// leaves through here carries it, those the hook builds as well as those
	// from `resolve`; see `$lib/server/timing`.
	const timing = serverTiming(firstRequest());
	event.locals.timing = timing;
	const timed = (response: Response) => withServerTiming(response, timing);
	// The request's calls to Supabase, auth's included, by kind, the slowest,
	// and the new connections they opened; see `$lib/server/supabase-calls`.
	const calls = supabaseCalls();
	timing.include(() => calls.entries());

	// Every cookie written before `resolve` goes through this, so that the
	// responses the hook returns itself carry them; see `$lib/server/cookie-writes`.
	const writes = recordCookieWrites(event);
	event.locals.newSession = { choice: null };
	event.locals.supabase = createSupabaseServerClient(
		event,
		writes,
		calls.timed(fetch),
		event.locals.newSession
	);
	const session = await timing.measure('auth', () => verifiedSession(event.locals.supabase));
	event.locals.user = session?.user ?? null;

	// The session's limit, before anything else reads the session: 30 days from
	// login when the box was ticked, 12 hours otherwise, measured from the token's
	// own sign-in time with this server's clock. Past it, the session is signed
	// out at the auth server and its cookies deleted, and the request goes on
	// signed out: a page to `/login` (with the notice), a JSON route its 401, a
	// public page drawn signed out. See `$lib/auth/session-limit`.
	let lifetime: Lifetime;
	if (session) {
		const choice = recordedChoice(writes.cookies.get(SESSION_LIMIT_COOKIE), session.id);
		const start = sessionStart(session.amr);
		const now = nowSeconds();
		if (limitPassed(start, choice, now)) {
			await endAtLimit(writes.cookies, event.locals.supabase.auth, SESSION_COOKIE_KEY, choice);
			event.locals.user = null;
		} else {
			lifetime = cookieLifetime(start, choice, now);
		}
	}

	// After `getClaims()`, which may have refreshed the session or removed it:
	// a session signed in before its cookies were HTTP-only becomes HTTP-only on
	// this response, and the mark pages read follows the session. See
	// `$lib/supabase/cookies`.
	keepSessionHttpOnly(writes.cookies, SESSION_COOKIE_KEY, lifetime);
	event.locals.theme = parseTheme(event.cookies.get(THEME_COOKIE));

	// A signup link for an account signed up more than once: the person chooses
	// their password before going in (`/auth/confirm`), and if the window passes
	// first, every session ends and the password is set by email. Fails closed:
	// never in with the first signup's password. See
	// `$lib/auth/choose-password.server`. Read only when its cookie is there; with
	// no session, or another one, the cookie is deleted here. Before the
	// `route.id` guard below: while choosing, an address that matches no route is
	// sent back too, rather than drawn as a 404.
	const choosing = await choosingState(writes.cookies, event.locals.supabase.auth);
	if (choosing === 'lapsed') {
		await lapseChoosing(writes.cookies, event.locals.supabase.auth);
		event.locals.user = null;
		if (event.route.id !== null && JSON_ROUTES.has(event.route.id)) {
			return timed(writes.handOver(signedOutJson()));
		}
		return timed(writes.handOver(withoutStorage(sendTo(event, '/forgot-password'))));
	}
	if (choosing === 'pending') {
		// An allow-list: anything not on it is refused, a route added later included.
		const answer = whileChoosing(event.route.id);
		if (answer === 'refuse') {
			return timed(writes.handOver(withoutStorage(signedOutJson())));
		}
		if (answer === 'send-back') {
			return timed(writes.handOver(withoutStorage(sendTo(event, '/reset-password'))));
		}
	}

	// `route.id` is null when no route matched — static assets and 404s. Guarding
	// those would send a missing image to /login and call it a redirect.
	if (event.route.id !== null) {
		const path = event.url.pathname;

		if (!event.locals.user && !PUBLIC_PATHS.has(path)) {
			if (JSON_ROUTES.has(event.route.id)) {
				return timed(writes.handOver(signedOutJson()));
			}
			return timed(writes.handOver(withoutStorage(toLogin(event))));
		}

		if (event.locals.user && AUTH_ENTRY_PATHS.has(path)) {
			return timed(writes.handOver(withoutStorage(toAppHome(event))));
		}
	}

	/**
	 * The theme is decided above, on the server, because the cookie is on the
	 * request. Nothing about it is deferred to the client: the HTML that leaves
	 * this function is already in the right theme, so there is no first paint in
	 * the wrong one to correct.
	 *
	 * `system` writes no class and is resolved by `prefers-color-scheme` inside
	 * the `dark` variant in `src/routes/layout.css`, which the browser evaluates
	 * before it paints. See that file for why the media query lives there.
	 */
	const themeClass = themeAttribute(event.locals.theme);

	const response = await resolve(event, {
		/**
		 * Safe against streaming, which hands this callback the page in pieces: the
		 * placeholder sits in the opening `<html>` tag, which is in the first chunk
		 * in one piece, and `replace` on a chunk that does not contain it is a
		 * no-op. Nothing here is ever a partial match, because the only values
		 * substituted come from `themeAttribute`, which returns one of three
		 * fixed strings.
		 */
		transformPageChunk: ({ html }) => html.replace(THEME_PLACEHOLDER, themeClass),

		// SvelteKit strips response headers from a server load's `fetch` before
		// replaying it on the client. supabase-js reads both of these off its REST
		// responses, so they have to survive that trip.
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});

	return timed(event.locals.user || isPage(response) ? withoutStorage(response) : response);
};
