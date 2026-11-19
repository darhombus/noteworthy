/**
 * The fetch wrapper behind `refreshInPlace` (`./refresh-in-place`), kept free of
 * `$app` imports so it can be tested without SvelteKit's runtime.
 */
const DATA_SUFFIX = '/__data.json';
/** SvelteKit's own query parameters on a data request (`shared.js`). */
const KIT_PARAMS = ['x-sveltekit-invalidated', 'x-sveltekit-trailing-slash'];

type Win = {
	fetch: typeof fetch;
	location: Pick<Location, 'href' | 'origin' | 'pathname' | 'search'>;
	addEventListener: (type: 'online', listener: () => void, options: { once: true }) => void;
};

/** What a page's data request asks for, as SvelteKit builds it (`load_data`). */
export function dataPathOf(pathname: string): string {
	return pathname.replace(/\/$/, '') + DATA_SUFFIX;
}

/** Whether two queries are the same, SvelteKit's own parameters aside. */
export function sameQuery(a: URLSearchParams, b: URLSearchParams): boolean {
	const own = (params: URLSearchParams) =>
		[...params]
			.filter(([key]) => !KIT_PARAMS.includes(key))
			.map(([key, value]) => `${key}=${value}`)
			.sort()
			.join('&');
	return own(a) === own(b);
}

/** Whether `input` is SvelteKit asking for the data of the page already on screen. */
export function isDataForPageOnScreen(
	input: RequestInfo | URL,
	location: Win['location']
): boolean {
	const url = new URL(input instanceof Request ? input.url : String(input), location.href);
	return (
		url.origin === location.origin &&
		url.searchParams.has(KIT_PARAMS[0]) &&
		url.pathname === dataPathOf(location.pathname) &&
		sameQuery(url.searchParams, new URLSearchParams(location.search))
	);
}

/** "Every node as it was", in SvelteKit's data format. */
function nothingChanged(): Response {
	return new Response('{"type":"data","nodes":[]}\n', {
		headers: { 'content-type': 'application/json' }
	});
}

export type RefreshGuard = {
	/** Runs `refresh`; resolves `false` when it could not reach the server. */
	run: (refresh: () => Promise<unknown>) => Promise<boolean>;
};

/**
 * Wraps `win.fetch` once. `again` is the refresh made when the connection
 * comes back after one that could not reach the server.
 */
export function createRefreshGuard(win: Win, again: () => Promise<unknown>): RefreshGuard {
	const original = win.fetch;
	let running = 0;
	let unreached = 0;
	let waiting = false;

	win.fetch = async (input, init) => {
		const guarded = running > 0 && isDataForPageOnScreen(input, win.location);
		try {
			return await original(input, init);
		} catch (failure) {
			if (!guarded) {
				throw failure;
			}
			unreached += 1;
			return nothingChanged();
		}
	};

	async function run(refresh: () => Promise<unknown>): Promise<boolean> {
		const before = unreached;
		running += 1;
		try {
			await refresh();
		} finally {
			running -= 1;
		}
		const reached = unreached === before;
		if (!reached && !waiting) {
			waiting = true;
			win.addEventListener(
				'online',
				() => {
					waiting = false;
					void run(again);
				},
				{ once: true }
			);
		}
		return reached;
	}

	return { run };
}
