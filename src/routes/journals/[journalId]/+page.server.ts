import { error, fail } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { listEntries, updateEntry } from '$lib/data/entries';
import { DataError } from '$lib/data/errors';
import { getJournal } from '$lib/data/journals';
import { isUuid } from '$lib/data/ids';
import { validateTitle, type RenameErrors } from '$lib/entries/edit';
import { JOURNALS, type Crumb } from '$lib/nav/breadcrumbs';
import { parseSearchRequest } from '$lib/search/results';
import { runSearch } from '$lib/search/search.server';
import type { Actions, PageServerLoad } from './$types';

/**
 * A journal and its entries, and, with `?q=` or a date filter (`?when=`,
 * `?since=`, `?until=`), a search of its entries (`?after=` and `?from=` for a
 * later page without JavaScript, as on `/search`). Any time with nothing
 * typed is the list; a date filter with nothing typed is every entry in those
 * days, in the results' layout. With JavaScript the search follows the field through
 * `/search/results` instead, and this load runs only for the URL a page is
 * loaded or navigated to.
 *
 * The entry list is read even when there is a query: clearing the field shows
 * it again at once, with no round trip, and it costs no extra wait, being
 * asked at the same time as the rest.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!isUuid(params.journalId)) {
		error(404, 'Journal not found.');
	}
	const request = { ...parseSearchRequest(url.searchParams), journal: params.journalId };

	// All at once. Each is a round trip to Frankfurt, and running them in
	// sequence would spend two or three of them on a page that needs one wait.
	// The cost is that a missing journal still pays for the entries query and the
	// search — but both return nothing in that case anyway, and the 404 path is
	// not the one worth tuning.
	//
	// Soft-deleted journals, soft-deleted entries and hidden entries are all
	// filtered inside the query layer (and `find_entries`) rather than here.
	const [journal, entries, outcome] = await Promise.all([
		getJournal(locals.supabase, params.journalId),
		listEntries(locals.supabase, { journalId: params.journalId }),
		runSearch(locals.supabase, request)
	]);

	if (journal === null) {
		// Not "forbidden". RLS scopes the read, so somebody else's journal and a
		// journal that never existed are the same answer here, and saying which
		// would turn this route into a way to test whether an id is real.
		error(404, 'Journal not found.');
	}

	return {
		journal,
		entries,
		query: request.query,
		filters: request.filters,
		outcome,
		breadcrumbs: [JOURNALS, { label: journal.title }] satisfies Crumb[]
	};
};

export const actions: Actions = {
	/**
	 * Renaming an entry from the list: the title, and nothing else.
	 *
	 * The patch names `title` alone, so the UPDATE touches no other granted
	 * column. The body is not re-sent, and so it is neither rebuilt nor re-run
	 * through the sanitiser. `word_count` and the media-release trigger fire only
	 * when `content` is named, so neither does anything here. What does move is
	 * `updated_at`, and the journal's with it: `fn_entries_set_updated_at` counts
	 * a title change as a real edit. The list is ordered by `entry_date`, so a
	 * rename never reorders it.
	 *
	 * The rule for the title is the editor's own (`validateTitle`): trimmed,
	 * blank stored as `null` and shown as "Untitled", at most `MAX_TITLE`.
	 */
	rename: async ({ request, locals }) => {
		requireUser(locals.user);
		const submitted = await request.formData();
		const entryId = String(submitted.get('entry_id') ?? '');
		const titled = validateTitle(String(submitted.get('title') ?? ''));

		if (!isUuid(entryId)) {
			return fail(400, {
				errors: { form: 'Could not tell which entry to rename.' } satisfies RenameErrors
			});
		}
		if (!titled.ok) {
			return fail(400, { errors: { title: titled.message } satisfies RenameErrors });
		}

		try {
			const renamed = await updateEntry(locals.supabase, entryId, { title: titled.title });
			// For the dialog to tell an edit page open in another tab, at once
			// (`$lib/entries/conflict.svelte`).
			return { renamed: { entryId, revision: renamed.revision } };
		} catch (failure) {
			// `PGRST116`: the filter matched no row, so the entry was deleted
			// (another tab, most likely) since this list was drawn.
			const gone = failure instanceof DataError && failure.postgrest.code === 'PGRST116';
			return fail(gone ? 404 : 500, {
				errors: {
					form: gone
						? 'That entry no longer exists. Refresh to see the current list.'
						: 'Could not rename the entry. Try again.'
				} satisfies RenameErrors
			});
		}
	}
};
