import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { entryMediaForLoad } from '$lib/media/entry-media.server';
import { deleteEntry, getEntry } from '$lib/data/entries';
import { getJournal } from '$lib/data/journals';
import { isUuid } from '$lib/data/ids';
import { JOURNALS, journalCrumb, type Crumb } from '$lib/nav/breadcrumbs';
import { entryFontFiles } from '$lib/server/font-files';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, isDataRequest }) => {
	if (!isUuid(params.journalId) || !isUuid(params.entryId)) {
		error(404, 'Entry not found.');
	}

	const [entry, journal] = await Promise.all([
		getEntry(locals.supabase, params.entryId),
		getJournal(locals.supabase, params.journalId)
	]);

	if (entry === null || journal === null) {
		error(404, 'Entry not found.');
	}

	// The entry is fetched by its own id, so a real entry reached through the
	// wrong journal's URL would otherwise render happily under a heading naming a
	// journal it is not in. Both ids are in the address; both have to agree.
	if (entry.journal_id !== journal.journal_id) {
		error(404, 'Entry not found.');
	}

	return {
		entry,
		journal,
		// The journal's font files this page draws, preloaded in its head.
		fontFiles: entryFontFiles('read', journal, entry.title, entry.content),
		// Every photo's path, signed in one request: on a tap, streamed after the
		// text; for a document, awaited (`$lib/media/entry-media.server`, which
		// says what `Server-Timing` records). No request at all for an entry
		// without photos — `signMediaPaths` returns before sending.
		...(await entryMediaForLoad(
			{ locals, isDataRequest },
			requireUser(locals.user).id,
			entry.content
		)),
		breadcrumbs: [
			JOURNALS,
			journalCrumb(journal.journal_id, journal.title),
			{ label: entry.title ?? 'Untitled' }
		] satisfies Crumb[]
	};
};

export const actions: Actions = {
	delete: async ({ locals, params }) => {
		// The entry id comes from the address, not from a form field. There is
		// exactly one entry this page can delete — the one it is showing — so
		// accepting an id in the body would widen the action for nothing.
		if (!isUuid(params.entryId)) {
			error(404, 'Entry not found.');
		}

		try {
			// Soft delete: `deleted_at` is stamped and the row stays for thirty days.
			// `deleted_with_journal` is left alone, which is the point of it — this
			// was a decision about this entry, so restoring the journal later must
			// not sweep it back up.
			await deleteEntry(locals.supabase, params.entryId);
		} catch {
			return fail(500, { errors: { form: 'Could not delete the entry. Try again.' } });
		}

		// Back to the journal, where the entry is now absent from the list. Staying
		// on a page describing a row that no longer exists would be worse.
		redirect(303, `/journals/${params.journalId}`);
	}
};
