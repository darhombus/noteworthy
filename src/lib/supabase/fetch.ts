/**
 * How long to wait before the one retry.
 */
export const RETRY_DELAY_MS = 1000;

/**
 * Wraps `fetch` for the server's Supabase client so that the one transient
 * refusal PostgREST makes on its own is retried, once. It wrapped the browser's
 * client too until that client was removed (PRD 08); every query the app makes
 * now runs on the server, so this is where the refusal can still reach.
 *
 * The refusal is a fresh session token rejected as issued in the future: HTTP
 * 401, `{"code":"PGRST303","message":"JWT issued at future"}`. PostgREST allows
 * 30 seconds of skew on `iat`, so a token minted moments ago only fails that
 * check when the worker's own clock is more than 30 seconds stale — and before
 * v14.18 a worker could validate against a cached timestamp that had stopped
 * updating. It shows up as a 500 on the first page after login that a refresh
 * clears.
 *
 * Delete this once the hosted project runs PostgREST v14.18 or later, which has
 * the fix ("Fix sporadic 'PGRST303 JWT issued at future' errors",
 * PostgREST/postgrest#5196; brought into Supabase's images by
 * supabase/postgres#2446). `supabase/.temp/rest-version` records the hosted
 * version as of the last `supabase link`.
 *
 * Any method is retried, writes included: PostgREST checks the token before it
 * runs anything, so the refused attempt wrote nothing and sending it again
 * cannot write twice.
 *
 * Every other response, including every other 401 and PGRST303, comes back
 * untouched. Auth, Storage, Functions and Realtime's REST calls come through
 * here as well, since supabase-js hands this same `fetch` to all of them, but
 * none of them answers with a PostgREST error code, so none can match.
 *
 * `warn` hears about each retry, given the request path and nothing else: the
 * query string can carry row ids and filter values, and the headers carry the
 * token.
 */
export function retryIssuedAtFuture(
	baseFetch: typeof fetch,
	warn?: (message: string) => void
): typeof fetch {
	return async (input, init) => {
		const response = await baseFetch(input, init);

		if (!canResend(input, init) || !(await isIssuedAtFuture(response))) {
			return response;
		}

		warn?.(`Supabase: retrying once after PGRST303 "JWT issued at future": ${pathOf(input)}`);
		await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
		return baseFetch(input, init);
	};
}

/**
 * Whether the response is the one refusal worth a retry.
 *
 * Reads a clone, so the body stays unread for whoever receives the response.
 * The status is checked first so that only a 401 is ever cloned and parsed.
 * A body that is not JSON, or is empty as it always is for HEAD, does not
 * match.
 */
async function isIssuedAtFuture(response: Response): Promise<boolean> {
	if (response.status !== 401) return false;

	let body: unknown;
	try {
		body = await response.clone().json();
	} catch {
		return false;
	}

	return (
		typeof body === 'object' &&
		body !== null &&
		'code' in body &&
		body.code === 'PGRST303' &&
		'message' in body &&
		body.message === 'JWT issued at future'
	);
}

/**
 * Whether the request can go out a second time.
 *
 * PostgREST, Auth and Realtime send JSON strings. Storage uploads and Functions
 * calls send whatever the caller passed, and a stream is spent once it is sent:
 * sending it again would throw rather than hand back the 401. Neither service
 * answers PGRST303, so this never turns away a retry that matters, but it keeps
 * a stream from being sent twice.
 */
function canResend(input: RequestInfo | URL, init: RequestInit | undefined): boolean {
	if (input instanceof Request && input.body !== null) return false;

	const body = init?.body;
	return (
		body === undefined ||
		body === null ||
		typeof body === 'string' ||
		body instanceof Blob ||
		body instanceof ArrayBuffer ||
		ArrayBuffer.isView(body) ||
		body instanceof FormData ||
		body instanceof URLSearchParams
	);
}

function pathOf(input: RequestInfo | URL): string {
	return new URL(input instanceof Request ? input.url : input).pathname;
}
