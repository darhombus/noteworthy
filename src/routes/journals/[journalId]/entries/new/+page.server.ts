import { error, fail, redirect } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import { createEntry } from '$lib/data/entries';
import { getJournal } from '$lib/data/journals';
import { isUuid } from '$lib/data/ids';
import { isBlank } from '$lib/entries/body';
import { submittedBody } from '$lib/entries/edit';
import { allowanceRemaining } from '$lib/media/page.server';
import type { SignedMedia } from '$lib/media/signed';
import { JOURNALS, journalCrumb, type Crumb } from '$lib/nav/breadcrumbs';
import { entryFontFiles } from '$lib/server/font-files';
import type { Actions, PageServerLoad } from './$types';

const MAX_TITLE = 200;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type NewEntryErrors = {
	title?: string;
	body?: string;
	entryDate?: string;
	form?: string;
};

type NewEntryResult = {
	errors: NewEntryErrors;
	/** Echoed so a rejected submit does not throw away what was written. */
	values: { title: string; body: string; entryDate: string };
};

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!isUuid(params.journalId)) {
		error(404, 'Journal not found.');
	}

	const user = requireUser(locals.user);
	const [journal, remaining] = await Promise.all([
		getJournal(locals.supabase, params.journalId),
		allowanceRemaining(locals.supabase)
	]);

	if (journal === null) {
		error(404, 'Journal not found.');
	}

	// The whole journal, for one title. It is a single round trip either way, and
	// it is the same read the page beside this one does, so it stays warm.
	return {
		journal,
		// The journal's font, upright and regular: what the first keystroke draws.
		fontFiles: entryFontFiles('new', journal, null, { type: 'doc', content: [] }),
		// Nothing to sign yet: a new entry holds no photos until one is uploaded,
		// and the browser shows those from the file it already has.
		media: { urls: {}, signedAt: Date.now(), expiresAt: Date.now() } satisfies SignedMedia,
		owner: user.id,
		remaining,
		// The id the entry will have, chosen before it exists, so that autosave can
		// send its first save again without making a second entry — see
		// `createEntryOnce`. Chosen here rather than in the browser because
		// `crypto.randomUUID()` only exists there on HTTPS or localhost, and a
		// phone testing a dev server over the LAN is neither. One per visit: the
		// page captures it once and a later load cannot move it.
		entryId: crypto.randomUUID(),
		breadcrumbs: [
			JOURNALS,
			journalCrumb(journal.journal_id, journal.title),
			{ label: 'New entry' }
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

		// `body` is echoed and `doc` is not. With the editor running, a refused
		// submit leaves the page mounted and the editor still holding its own
		// document, so there is nothing to put back; the echo is for the textarea,
		// which with no JavaScript is re-rendered from scratch.
		const values = { title, body, entryDate };
		const errors: NewEntryErrors = {};

		if (title.length > MAX_TITLE) {
			errors.title = `Keep the title to ${MAX_TITLE} characters or fewer.`;
		}

		// Through the same door as an edit: the editor's `doc` is rebuilt by the
		// sanitiser rather than trusted, and the textarea's `body` is turned into
		// paragraphs by `toBody`. See `submittedBody`. Nothing is stored yet, so
		// there is no stored body for the textarea rule to protect.
		const parsed = submittedBody(typeof submittedDoc === 'string' ? submittedDoc : null, body, {
			owner: requireUser(locals.user).id
		});
		const content = parsed.ok ? parsed.content : null;

		// The title is optional — `entries.title` is nullable, and an untitled
		// entry is a normal thing to write. The body is not: an entry with neither
		// is nothing at all, and there would be no way to tell it apart from a
		// misfire later. A photo on its own is something (`isBlank`).
		if (!parsed.ok) {
			errors.body = parsed.message;
		} else if (isBlank(parsed.content)) {
			errors.body = 'Write something before saving.';
		}

		// An empty date is not an error. Leaving `entry_date` off the insert lets
		// the column default — CURRENT_DATE — apply, which is what "today" means
		// in the database's own timezone rather than a guess made here.
		if (entryDate.length > 0 && !DATE_ONLY.test(entryDate)) {
			errors.entryDate = 'Give the date as a real day, or leave it blank for today.';
		}

		if (content === null || Object.keys(errors).length > 0) {
			return fail(400, { errors, values } satisfies NewEntryResult);
		}

		let entryId: string;

		try {
			// No owner is named. `entries` has no `user_id` — RLS reaches ownership
			// through the journal — so naming the journal is naming the owner, and
			// a journal that is not this person's fails the policy rather than
			// writing a row they cannot see.
			const created = await createEntry(locals.supabase, {
				journal_id: params.journalId,
				title: title.length > 0 ? title : null,
				content,
				...(entryDate.length > 0 ? { entry_date: entryDate } : {})
			});
			entryId = created.entry_id;
		} catch {
			// Assigned onto the declared `errors` rather than returned as a fresh
			// object literal. A literal here infers as `{ form: string }`, which
			// unions with `NewEntryErrors` in the page's `ActionData` and makes
			// every `form.errors.title` read fail to compile — the same trap the
			// signup action records.
			errors.form = 'Could not save the entry. Try again.';
			return fail(500, { errors, values } satisfies NewEntryResult);
		}

		// Straight to the entry as it now reads. The list is one step back and
		// will have it; seeing what you just wrote rendered is the confirmation
		// worth giving.
		redirect(303, `/journals/${params.journalId}/entries/${entryId}`);
	}
};
