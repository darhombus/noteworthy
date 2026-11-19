/**
 * What the search page is drawn from, how its load asks for it, and the
 * quick-search modal's answer handed over to it.
 *
 * `/search`'s load is universal (`+page.ts`), not a server load, so that a
 * client-side navigation to it need not wait for the server. A server load is
 * always fetched before a page is drawn: SvelteKit's client asks for the
 * page's `__data.json` whenever its node is new to the page (2.70.3,
 * `load_route` in `runtime/client/client.js`), and only then runs the
 * universal loads. With no server load of its own, `/search` is drawn as soon
 * as its load returns: the root layout's server load reads nothing from the
 * URL and is not asked again.
 *
 * So the load asks `/search/page` for what the server load used to return,
 * through SvelteKit's `fetch`. On the server (a reload, a visit from outside,
 * the no-script form) that call never leaves the server, and the page is
 * rendered there as before, with the answer written into the HTML for
 * hydration to read. In the browser it is one request, as `__data.json` was.
 *
 * ---------------------------------------------------------------------------
 * THE HANDOVER
 * ---------------------------------------------------------------------------
 * Enter in the modal, or its See all row, puts the modal's query and the
 * answer it is showing here (`handOver`), keyed by the address it then goes
 * to. The load takes it (`takeHandover`): the page is drawn with it at once,
 * and the same request as ever goes out without being waited for. The page
 * follows its answer as a search of its own (`follow` in `$lib/search/live`).
 *
 * Held for one navigation: taken, or replaced by the next handover. It is the
 * answer the modal already had on screen, never more, and it is gone with the
 * document, so it follows "Nothing signed in is stored" (docs/constraints.md)
 * as the modal does.
 */
import { resolve } from '$app/paths';
import type { SearchFilters } from './filters';
import type { SearchOutcome } from './results';

/** A journal in the picker. */
export type PickerJournal = { id: string; name: string };

/** What `/search/page` answers, and the page is drawn from. */
export type SearchPageData = {
	query: string;
	filters: SearchFilters;
	outcome: SearchOutcome;
	journals: PickerJournal[];
};

/** `/search/page` refused: `status` is its status, `message` what to show. */
export class SearchPageRefused extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

/** Asks `/search/page` for the page at `url`, through `fetcher` (the load's `fetch`). */
export async function askSearchPage(fetcher: typeof fetch, url: URL): Promise<SearchPageData> {
	const response = await fetcher(`${resolve('/search/page')}${url.search}`);
	const body = (await response.json()) as SearchPageData | { message?: string };
	if (!response.ok || !('outcome' in body)) {
		const message =
			'message' in body && typeof body.message === 'string'
				? body.message
				: 'Search is not answering. Try again.';
		throw new SearchPageRefused(response.status, message);
	}
	return body;
}

export type Handover = {
	/** The query in the modal's field, as Enter or See all sends it. */
	query: string;
	/** The answer the modal is showing, or `null` when it shows none. */
	outcome: Extract<SearchOutcome, { kind: 'found' }> | null;
};

let held: { address: string; handover: Handover } | null = null;

/** The path and query string of `url`, as the handover is keyed. */
function addressOf(url: URL): string {
	return `${url.pathname}${url.search}`;
}

/** Leaves `handover` for the load of `address` (`/search?q=…`), and only that. */
export function handOver(address: string, handover: Handover): void {
	held = { address, handover };
}

/** The handover for `url`, if there is one. Taken once: a second call finds nothing. */
export function takeHandover(url: URL): Handover | null {
	const found = held;
	held = null;
	return found !== null && found.address === addressOf(url) ? found.handover : null;
}
