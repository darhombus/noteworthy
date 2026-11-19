/**
 * Wakes the server ahead of a tap: the app asks here when it is likely about to
 * be used after a pause (`$lib/wake`), so that the tap that follows finds an
 * open connection and a function instance that has already done its first
 * request's work.
 *
 * Most of the work is the hook's: `getClaims()` runs for every request, which
 * verifies the session (fetching the signing keys when they are not held, or
 * were fetched more than auth-js's 10 minutes ago, and opening a connection to
 * Supabase's host on the way) and refreshes a session that expired while the
 * app was away; the refreshed cookies arrive with this answer.
 *
 * What the hook cannot reach is the code of the route the tap will ask for.
 * SvelteKit imports a route's server modules on its first request, before the
 * hook runs, and a cold instance has loaded none: measured locally, a tap after
 * a wake still spent about 45 ms of its 56 importing them, against a warm
 * tap's 25 in all. So this loads every route's server modules (loads and
 * endpoints, not the components, which only a full page render needs), once
 * per instance; later wakes find them loaded. Measured as `code` in
 * `Server-Timing`. Loading code reads nothing: no database, no Storage.
 *
 * Nor does the hook reach PostgREST, which is cold again after an idle: measured
 * on dev, a tap's two reads after a wake took 288–361 ms against about 90 warm
 * (and still warm about 50 s after a query, so not the documented 30 s pool
 * timeout; what goes cold is not established). So,
 * signed in, this also reads one column of the person's own profile row through
 * their session: the gateway, PostgREST, its pool and RLS, the path every
 * page's query takes, for one primary-key row. Signed out, nothing is read.
 * It starts before the code loading and runs alongside it; the answer waits for
 * both, but for the read no longer than `READ_LIMIT_MS`, and whatever the read
 * returns or throws, the answer is the same 204. Waited for rather than left
 * running, because adapter-vercel gives a Node function no `waitUntil`: work
 * left behind after the answer may be frozen before its request leaves.
 *
 * Public, signed in or out (`PUBLIC_PATHS` in `hooks.server.ts`): never a
 * redirect to `/login`, never a 401. `private, no-store` here rather than left
 * to the hook, which sets it on signed-in answers only: a stored 204 would
 * answer a later wake without reaching the server, which is the whole point.
 * A refresh's own `Cache-Control` from the Supabase client replaces it (it is
 * set after this handler returns), and says no-store too.
 *
 * See docs/constraints.md, "Wake on return".
 */
import type { RequestHandler } from './$types';

const routeCode = import.meta.glob([
	'../**/+page.server.ts',
	'../**/+layout.server.ts',
	'../**/+server.ts',
	'!./+server.ts'
]);

let loaded: Promise<void> | null = null;

/** Every route's server modules, imported once per instance. A failure is left to that route's own request. */
function loadRouteCode(): Promise<void> {
	loaded ??= Promise.all(Object.values(routeCode).map((load) => load())).then(
		() => {},
		() => {
			loaded = null;
		}
	);
	return loaded;
}

/**
 * The longest the answer waits for the read. Over twice the slowest cold read
 * measured on dev (361 ms); nobody waits on a wake, and a read cut short has
 * still reached PostgREST.
 */
const READ_LIMIT_MS = 1000;

/**
 * One small read through the person's own session, so that PostgREST and its
 * database pool are warm for the tap that follows. Never rejects, and settles
 * within `READ_LIMIT_MS`: the signal ends the request, the timer ends the wait
 * (the PGRST303 retry's pause is not abortable).
 */
async function warmPostgrest({ supabase, user }: App.Locals): Promise<void> {
	if (!user) {
		return;
	}
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const limit = new Promise<void>((settle) => {
		timer = setTimeout(() => {
			controller.abort();
			settle();
		}, READ_LIMIT_MS);
	});
	const read = (async () => {
		try {
			await supabase
				.from('profiles')
				.select('user_id')
				.eq('user_id', user.id)
				// postgrest-js retries a failed GET up to three times; one arrival is
				// all this is for.
				.retry(false)
				.abortSignal(controller.signal);
		} catch {
			// Its only purpose was to arrive; a failure changes nothing.
		}
	})();
	await Promise.race([read, limit]);
	clearTimeout(timer);
}

export const GET: RequestHandler = async ({ locals }) => {
	const warmed = warmPostgrest(locals);
	await locals.timing.measure('code', loadRouteCode);
	await warmed;
	return new Response(null, { status: 204, headers: { 'cache-control': 'private, no-store' } });
};
