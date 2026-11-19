import { error, redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import type { Crumb } from '$lib/nav/breadcrumbs';
import { NO_FILTERS } from '$lib/search/filters';
import {
	askSearchPage,
	SearchPageRefused,
	takeHandover,
	type PickerJournal,
	type SearchPageData
} from '$lib/search/page-data';
import type { SearchOutcome } from '$lib/search/results';
import type { PageLoad } from './$types';

/**
 * The search page. Universal, not a server load, so that the quick-search
 * modal's answer can draw it at once: see `$lib/search/page-data`, which also
 * says what the address may hold (`searchPage` in `$lib/search/search.server`).
 *
 * Without a handover, which is every load on the server and every navigation
 * but the modal's, it waits for `/search/page` as the server load did: on the
 * server that call never leaves it. With one, it returns the modal's query and
 * answer at once, and `refresh` is the same request, not waited for: the page
 * follows it (`LiveSearchForm`) and takes the picker's journals from it.
 *
 * Re-run on every change of the query string, so submitting the form (an
 * ordinary GET) searches again.
 */
export const load: PageLoad = async ({ url, fetch }) => {
	const breadcrumbs = [{ label: 'Search' }] satisfies Crumb[];

	const handover = browser ? takeHandover(url) : null;
	if (handover !== null) {
		const asked = askSearchPage(fetch, url);
		const outcome = asked.then((data) => data.outcome);
		const journals = asked.then(
			(data) => data.journals,
			(): PickerJournal[] | null => null
		);
		// `follow` handles a failure; this is for a page left before it is followed.
		outcome.catch(() => {});
		asked.catch((failure: unknown) => {
			// The modal's answer drew the page without asking the server whether
			// anybody is still signed in. A full load asks it: see "A page that
			// outlived its session" in docs/constraints.md.
			if (failure instanceof SearchPageRefused && failure.status === 401) {
				location.reload();
			}
		});
		// None when the modal had no answer on screen yet: the page says it is searching.
		const shown: SearchOutcome = handover.outcome ?? { kind: 'idle' };
		return {
			query: handover.query,
			filters: NO_FILTERS,
			outcome: shown,
			journals: [] as PickerJournal[],
			refresh: { outcome, journals },
			breadcrumbs
		};
	}

	let data: SearchPageData;
	try {
		data = await askSearchPage(fetch, url);
	} catch (failure) {
		if (failure instanceof SearchPageRefused) {
			if (failure.status === 401) {
				redirect(303, resolve('/login'));
			}
			error(failure.status, failure.message);
		}
		throw failure;
	}
	return { ...data, refresh: null, breadcrumbs };
};
