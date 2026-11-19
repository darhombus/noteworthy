/**
 * What the search page is drawn from, as JSON: the query and filters from the
 * address, the first page of results (or the page `after` names), and the
 * picker's journals. This was the page's server load; it is an endpoint so
 * that the page's load can be universal and need not wait for it
 * (`$lib/search/page-data`).
 *
 * Listed in `JSON_ROUTES` in `hooks.server.ts`, so a request whose session has
 * gone gets a 401 rather than a redirect `fetch` would follow into the login
 * page's HTML; the load turns that 401 into the redirect a server load gave.
 */
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { searchPage } from '$lib/search/search.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	requireUser(locals.user);
	try {
		const data = await searchPage(locals.supabase, url.searchParams);
		if (data === 'invalid') {
			return json(
				{ reason: 'bad-request', message: 'Could not tell which journal to search.' },
				{ status: 400 }
			);
		}
		return json(data);
	} catch (failure) {
		console.error('search page', failure);
		return json(
			{ reason: 'failed', message: 'Search is not answering. Try again.' },
			{ status: 500 }
		);
	}
};
