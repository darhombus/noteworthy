/**
 * The quick-search modal's rows while nothing is typed: the most recently
 * edited entries, as JSON (`recentEntries` in `$lib/search/search.server`).
 *
 * Asked when the modal opens, not in the shell's load: every signed-in page
 * runs that load, and only someone who opens search needs these.
 *
 * Listed in `JSON_ROUTES` in `hooks.server.ts`, like `/search/results`, so a
 * request whose session has gone gets a 401 rather than a redirect `fetch`
 * would follow into the login page's HTML.
 */
import { json } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { recentEntries } from '$lib/search/search.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireUser(locals.user);
	try {
		return json({ entries: await recentEntries(locals.supabase) });
	} catch (failure) {
		console.error('recent entries', failure);
		return json(
			{ reason: 'failed', message: 'Recent entries are not answering. Try again.' },
			{ status: 500 }
		);
	}
};
