/**
 * The edit page's load, and the save that happens when autosave cannot.
 *
 * The action below is no longer the ordinary way an entry is written — that is
 * `POST .../autosave`, which runs while somebody types. This is the path for a
 * browser with no JavaScript, or one whose editor chunk never arrived: the body
 * is still a textarea, the page is still a form, and the Save button is still
 * there. See the note at the top of `+page.svelte`.
 *
 * Both paths validate through `validateEntryEdit`, so the two cannot disagree
 * about what a date is or what an empty body means, and both save through
 * `saveEntry`, so both are refused alike when the entry changed somewhere else
 * (`$lib/data/entries`, SAVES). The form's revision and save id are hidden
 * fields inside the page's `<noscript>`, written here: `saveId` is fresh each
 * time the page is drawn, and a form posted twice from one drawing (a reply
 * lost, the browser sending it again) is its own save, not a conflict.
 *
 * Every refusal draws the page again with what was typed. A stale one draws it
 * with the entry's current revision, so Save again keeps the typed version;
 * any other keeps the revision the form was made from.
 */
import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { getEntry, saveEntry } from '$lib/data/entries';
import { getJournal } from '$lib/data/journals';
import { isUuid } from '$lib/data/ids';
import type { EntryBody } from '$lib/entries/body';
import { validateEntryEdit, type EntryEditErrors } from '$lib/entries/edit';
import { readSaveCheck } from '$lib/entries/revision';
import { entryMediaForLoad } from '$lib/media/entry-media.server';
import { allowanceRemaining } from '$lib/media/page.server';
import { JOURNALS, entryCrumb, journalCrumb, type Crumb } from '$lib/nav/breadcrumbs';
import { entryFontFiles } from '$lib/server/font-files';
import type { Actions, PageServerLoad } from './$types';

type EditEntryErrorsWithForm = EntryEditErrors & { form?: string };

type EditEntryResult = {
	errors: EditEntryErrorsWithForm;
	/** Echoed so a rejected submit does not throw away what was written. */
	values: { title: string; body: string; entryDate: string };
	/** The revision the drawn-again form is made from. */
	revision?: number;
	/** Changed somewhere else: the page says so, with a link to the saved version. */
	stale?: true;
};

const TRY_AGAIN = 'Could not save the changes. Try again.';

export const load: PageServerLoad = async ({ locals, params, isDataRequest }) => {
	if (!isUuid(params.journalId) || !isUuid(params.entryId)) {
		error(404, 'Entry not found.');
	}

	const user = requireUser(locals.user);
	const [entry, journal, remaining] = await Promise.all([
		getEntry(locals.supabase, params.entryId),
		getJournal(locals.supabase, params.journalId),
		allowanceRemaining(locals.supabase)
	]);

	if (entry === null || journal === null || entry.journal_id !== journal.journal_id) {
		// Same cross-check as the read view: both ids are in the address, so both
		// have to agree, or a real entry would open for editing under a heading
		// naming a journal it is not in.
		error(404, 'Entry not found.');
	}

	return {
		entry,
		journal,
		// The journal's font files this page draws, preloaded in its head.
		fontFiles: entryFontFiles('edit', journal, entry.title, entry.content),
		// For the no-JavaScript form; see the note at the top.
		saveId: crypto.randomUUID(),
		// The editor's photos, signed in one request — on a tap, streamed after the
		// text (`$lib/media/entry-media.server`) — and what the Add media menu
		// needs: whose folder new files go in, and how much room is left there.
		...(await entryMediaForLoad({ locals, isDataRequest }, user.id, entry.content)),
		owner: user.id,
		remaining,
		breadcrumbs: [
			JOURNALS,
			journalCrumb(journal.journal_id, journal.title),
			entryCrumb(journal.journal_id, entry.entry_id, entry.title),
			{ label: 'Edit' }
		] satisfies Crumb[]
	};
};

export const actions: Actions = {
	default: async ({ request, locals, params }) => {
		const submitted = await request.formData();
		const title = String(submitted.get('title') ?? '').trim();
		const body = String(submitted.get('body') ?? '');
		const entryDate = String(submitted.get('entryDate') ?? '').trim();
		const submittedDoc = submitted.get('doc');
		const saveId = String(submitted.get('saveId') ?? '');
		const check = readSaveCheck({
			revision: Number(submitted.get('revision') ?? ''),
			saveId,
			unanswered: isUuid(saveId) ? [saveId] : []
		});

		const values = { title, body, entryDate };
		const doc = typeof submittedDoc === 'string' ? submittedDoc : null;
		const owner = requireUser(locals.user).id;
		/** Drawn again from the revision this form was made from. */
		const refusal = (errors: EditEntryErrorsWithForm): EditEntryResult => ({
			errors,
			values,
			...(check === null ? {} : { revision: check.expected })
		});

		if (check === null) {
			return fail(
				400,
				refusal({ form: 'This page is out of date. Copy your text, then reload the page.' })
			);
		}

		// The textarea cannot hold photos, so what it posts must not replace a
		// body that has them — `submittedBody` explains. That needs the body as
		// stored, read only on this path: with the editor running, `doc` is the
		// whole document and nothing stored is consulted.
		let stored: EntryBody | undefined;
		if (doc === null) {
			try {
				stored = (await getEntry(locals.supabase, params.entryId))?.content;
			} catch {
				return fail(500, refusal({ form: TRY_AGAIN }));
			}
		}

		const result = validateEntryEdit({ title, entryDate, doc, body, owner, stored });

		if (!result.ok) {
			// Widened on the way out so both failure branches carry the same shape;
			// otherwise the page sees a union and `form` is missing from half of it.
			return fail(400, refusal(result.errors));
		}

		let saved: Awaited<ReturnType<typeof saveEntry>>;
		try {
			// `word_count` is deliberately not in this update, and that is what makes
			// FINDING 7-A visible from here. The reasoning is at the top of
			// `$lib/data/entries.ts`; the short version is that `UPDATE OF` keys on
			// the columns a statement *names*, this one names `content`, and so the
			// journal's rollup never fires. Naming `word_count` as well would fire it
			// — but the client is not granted UPDATE on `word_count`, so the database
			// would refuse the whole statement. That has only been true since
			// `20260921120000_narrow_client_writes`; before it the grant was
			// table-wide and a client could write any figure it liked there. The fix
			// for 7-A belongs in the rollup trigger, not in what this sends.
			saved = await saveEntry(locals.supabase, params.entryId, result.patch, check);
		} catch {
			return fail(500, refusal({ form: TRY_AGAIN }));
		}

		if (saved === null) {
			return fail(404, refusal({ form: 'That entry no longer exists.' }));
		}
		if (saved.kind === 'deleted') {
			return fail(410, refusal({ form: 'This entry is in the Recycle Bin.' }));
		}
		if (saved.kind === 'stale') {
			const errors: EditEntryErrorsWithForm = {};
			return fail(409, {
				errors,
				values,
				revision: saved.revision,
				stale: true
			} satisfies EditEntryResult);
		}

		redirect(303, `/journals/${params.journalId}/entries/${params.entryId}`);
	}
};
