/**
 * A search, answered as JSON: the same `runSearch` the page's load calls, with
 * the same parameters (`q`, `after`, `from`), so a page of results fetched here
 * is exactly the page the URL would have rendered.
 *
 * `since` and `until` are the days, and `journal` the journal searched: the
 * journal page's own, or the one chosen with `/search`'s pill. Both are taken
 * as a filter (`filters.journal`), which searches exactly the rows a journal
 * page's search does (that journal's entries, no journals group). Where the
 * two would differ, nothing typed or one character with no days, the live
 * search never asks: it knows those answers itself (`withoutSearching`). A
 * journal that is not an id is refused with a 400 rather than dropped, since
 * dropping it would answer a search of one journal with every journal. A day
 * that is not a real day is dropped, which only ever widens the days, never
 * the journals.
 *
 * Show more asks here for the next 50, and search as you type
 * (`$lib/search/live`) for each first page, on the pages and in the
 * quick-search modal, which shows the top of that same page.
 *
 * Listed in `JSON_ROUTES` in `hooks.server.ts`, so a request whose session has
 * gone gets a 401 rather than a redirect `fetch` would follow into the login
 * page's HTML.
 */
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { parseFilters } from '$lib/search/filters';
import { parseSearchRequest } from '$lib/search/results';
import { runSearch } from '$lib/search/search.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireUser(locals.user);
	const filters = parseFilters(url.searchParams, true);
	if (filters === 'invalid') {
		return json(
			{ reason: 'bad-request', message: 'Could not tell which journal to search.' },
			{ status: 400 }
		);
	}
	try {
		return json(
			await runSearch(locals.supabase, { ...parseSearchRequest(url.searchParams), filters })
		);
	} catch (failure) {
		console.error('search', failure);
		return json(
			{ reason: 'failed', message: 'Search is not answering. Try again.' },
			{ status: 500 }
		);
	}
};
