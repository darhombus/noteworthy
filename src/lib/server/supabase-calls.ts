/**
 * One request's calls from the function to Supabase, for its `Server-Timing`:
 * how long they took by kind, the slowest one, and how many new connections
 * they opened. Added 2026-10-10 (PRD 09, after Section 2's "after"
 * measurement), to show where a tap's `app` goes once the instance is warm.
 *
 * - `sb-rest`, `sb-stor`, `sb-auth`: the time during which at least one call of
 *   that kind was waiting, in ms (PostgREST, Storage, Auth, told apart by the
 *   path: `/rest/v1/`, `/storage/v1/`, `/auth/v1/`). Not the sum: the entry
 *   page's two queries run side by side, and a sum would count that time
 *   twice, so it could no longer be set against `app`. `stor`, not `storage`:
 *   Copy's text never holds that word (`e2e/timing.e2e.ts`).
 * - `sb-max-<kind>`: the slowest single call, named by its kind.
 * - `sb-conn`: a count, not a duration. How many of the request's calls went
 *   out on a connection no earlier call had used: each is a TCP and TLS
 *   handshake this request paid for (or waited on).
 *
 * A call's time runs from `fetch` to its response's headers, which is when
 * `fetch` resolves; the body after that is not counted. Calls to anything else
 * (Functions, Realtime) are passed on untimed; the app makes none.
 *
 * **How the connections are counted.** Node's `fetch` is undici, which
 * publishes on `node:diagnostics_channel`: `undici:request:create` when a
 * request is made, `undici:client:sendHeaders` with the socket it goes out on.
 * A socket seen for the first time is a new connection. The request object is
 * matched to this request's calls at `create`, where the caller's async
 * context is still the call's own (`AsyncLocalStorage`, entered by the wrapped
 * `fetch`); at `sendHeaders` that context cannot be trusted, since a pooled
 * socket's events run in the context of whoever opened it (measured on Node
 * 24: a later request's headers event carried the first request's store).
 *
 * **When the count is left out.** If no call of the request was seen on the
 * channel, `sb-conn` is not sent at all, rather than a 0 that would read as
 * "every connection reused": a runtime whose `fetch` is not undici, or one
 * that wraps it out of undici's reach, would otherwise report zero new
 * connections forever.
 *
 * Names and durations only: no path, no id, no query.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { subscribe } from 'node:diagnostics_channel';

export type SupabaseKind = 'rest' | 'stor' | 'auth';

const KINDS: readonly [SupabaseKind, string][] = [
	['rest', '/rest/v1/'],
	['stor', '/storage/v1/'],
	['auth', '/auth/v1/']
];

/** Which of Supabase's services a request goes to, by its path; `null` for anything else. */
export function kindOf(input: RequestInfo | URL): SupabaseKind | null {
	const href = input instanceof Request ? input.url : String(input);
	let path: string;
	try {
		path = new URL(href).pathname;
	} catch {
		return null;
	}
	return KINDS.find(([, prefix]) => path.startsWith(prefix))?.[0] ?? null;
}

/** The length of time covered by at least one of `spans`, overlaps counted once. */
export function covered(spans: readonly (readonly [number, number])[]): number {
	const sorted = [...spans].sort((a, b) => a[0] - b[0]);
	let total = 0;
	let end = -Infinity;
	for (const [from, to] of sorted) {
		if (to <= end) {
			continue;
		}
		total += to - Math.max(from, end);
		end = to;
	}
	return total;
}

export type SupabaseCalls = {
	/** `base`, with every call to Supabase timed and its connections counted. */
	timed(base: typeof fetch): typeof fetch;
	/** The `Server-Timing` parts, in a fixed order; none when no call was made. */
	entries(): [string, number][];
};

type Recorder = {
	/** A call of this request went out; `fresh` when on a connection nothing had used. */
	sent(fresh: boolean): void;
};

const current = new AsyncLocalStorage<Recorder>();

/** undici's request objects, each to the calls of the request that made it. */
const owners = new WeakMap<object, Recorder>();
/** Every socket a request has gone out on, this process's lifetime. */
const used = new WeakSet<object>();

let watching = false;

function field(message: unknown, name: string): object | null {
	if (typeof message !== 'object' || message === null || !(name in message)) {
		return null;
	}
	const value: unknown = (message as Record<string, unknown>)[name];
	return typeof value === 'object' && value !== null ? value : null;
}

/** Subscribes to undici's channels, once for the process. */
function watchConnections(): void {
	if (watching) {
		return;
	}
	watching = true;
	subscribe('undici:request:create', (message) => {
		const request = field(message, 'request');
		const recorder = current.getStore();
		if (request !== null && recorder !== undefined) {
			owners.set(request, recorder);
		}
	});
	subscribe('undici:client:sendHeaders', (message) => {
		const request = field(message, 'request');
		const socket = field(message, 'socket');
		if (request === null || socket === null) {
			return;
		}
		const fresh = !used.has(socket);
		used.add(socket);
		owners.get(request)?.sent(fresh);
	});
}

/** A new request's record of its Supabase calls. */
export function supabaseCalls(now: () => number = () => performance.now()): SupabaseCalls {
	watchConnections();

	const spans = new Map<SupabaseKind, [number, number][]>();
	let slowest: { kind: SupabaseKind; ms: number } | null = null;
	let seen = 0;
	let opened = 0;

	const recorder: Recorder = {
		sent(fresh) {
			seen += 1;
			if (fresh) {
				opened += 1;
			}
		}
	};

	return {
		timed(base) {
			return async (input, init) => {
				const kind = kindOf(input);
				if (kind === null) {
					return base(input, init);
				}
				const from = now();
				try {
					return await current.run(recorder, () => base(input, init));
				} finally {
					const to = now();
					spans.set(kind, [...(spans.get(kind) ?? []), [from, to]]);
					if (slowest === null || to - from > slowest.ms) {
						slowest = { kind, ms: to - from };
					}
				}
			};
		},
		entries() {
			const parts: [string, number][] = [];
			for (const [kind] of KINDS) {
				const of = spans.get(kind);
				if (of !== undefined) {
					parts.push([`sb-${kind}`, covered(of)]);
				}
			}
			if (slowest !== null) {
				parts.push([`sb-max-${slowest.kind}`, slowest.ms]);
			}
			if (seen > 0) {
				parts.push(['sb-conn', opened]);
			}
			return parts;
		}
	};
}
