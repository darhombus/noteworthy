/**
 * The `Server-Timing` header: how long the server took on a request, by part,
 * and whether the function instance was cold. Read on the device by the timing
 * readout (`$lib/timing/readout`), which finds it in Resource Timing for a
 * tap's `__data.json` and in Navigation Timing for a document.
 *
 * Names and durations only, never a description: the header goes to whoever
 * asked, signed in or not, and says nothing about what was asked for.
 *
 * - `app`: the hook's own start to the response being ready, in ms.
 * - `auth`: the `getClaims()` call, which includes any session refresh.
 * - `sign`: the media signing on the entry read and edit pages, recorded by
 *   their loads through `event.locals.timing` (`measure`). Not through
 *   `event.setHeaders`: SvelteKit throws when a header is set twice, and the
 *   Supabase client sets headers through it on a refresh. A load gets the same
 *   `locals` object the hook made (it spreads the event), and SvelteKit runs a
 *   page's server loads inside `resolve`, before the hook has the response.
 *   Only an awaited signing (a document): a tap's is streamed after the
 *   header, and marked `sign-stream` instead (`$lib/media/entry-media.server`).
 * - `sb-rest`, `sb-stor`, `sb-auth`, `sb-max-<kind>`, `sb-conn`: the request's
 *   calls to Supabase, by kind, the slowest one, and the new connections they
 *   opened (a count); see `$lib/server/supabase-calls`.
 * - `cold`: on the first request this instance serves, and on no other. Its
 *   duration is the instance's age when that request reached the hook: the
 *   process's own clock (`performance.now()` counts from the process's start).
 *   Small, and the request waited for the boot; large, and the instance was
 *   started ahead of it. A module flag: adapter-vercel imports the hooks once,
 *   in `server.init()` at the top of the function's module, before the first
 *   request. Under Fluid compute one instance serves requests concurrently, so
 *   a second request that arrived during the boot waited for it too and is not
 *   marked: `cold` is "the first", not "every one that paid".
 *
 * See docs/constraints.md, "The timing readout".
 */

let served = false;

/** Whether this is the instance's first request, counted once, at the hook's start. */
export function firstRequest(): boolean {
	if (served) {
		return false;
	}
	served = true;
	return true;
}

/** For the unit tests, which load this module once and need a fresh instance. */
export function forgetServedForTests(): void {
	served = false;
}

export type ServerTiming = {
	/** Runs `work` and records its duration as `name`. */
	measure<T>(name: string, work: () => Promise<T>): Promise<T>;
	/** Records `ms` as `name`; a second record of a name replaces the first. */
	record(name: string, ms: number): void;
	/** Parts read when the header is, after the recorded ones (the Supabase calls'). */
	include(more: () => Iterable<[string, number]>): void;
	/** The header's value: `app` measured now, the rest in the order recorded, then what was included. */
	header(): string;
};

/** One request's timings, started now. */
export function serverTiming(
	cold: boolean,
	now: () => number = () => performance.now()
): ServerTiming {
	const started = now();
	const instanceAge = started;
	const parts = new Map<string, number>();
	const included: (() => Iterable<[string, number]>)[] = [];

	return {
		async measure(name, work) {
			const from = now();
			try {
				return await work();
			} finally {
				parts.set(name, now() - from);
			}
		},
		record(name, ms) {
			parts.set(name, ms);
		},
		include(more) {
			included.push(more);
		},
		header() {
			const all: [string, number][] = [['app', now() - started], ...parts];
			for (const more of included) {
				all.push(...more());
			}
			if (cold) {
				all.push(['cold', instanceAge]);
			}
			return all.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(', ');
		}
	};
}

/**
 * `response` with its `Server-Timing`. A response whose headers cannot be
 * changed (one made by `Response.redirect`, or a `fetch` passed straight on) is
 * copied first; nothing in the app returns one today, but a header that turned
 * such a response into a 500 would be a poor diagnostic.
 */
export function withServerTiming(response: Response, timing: ServerTiming): Response {
	const value = timing.header();
	try {
		response.headers.set('server-timing', value);
		return response;
	} catch {
		const copy = new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: new Headers(response.headers)
		});
		copy.headers.set('server-timing', value);
		return copy;
	}
}
