import { error, fail } from '@sveltejs/kit';
import { NOTICE_COOKIE, PASSWORD_CHANGED } from '$lib/auth/recovery';
import { DataError } from '$lib/data/errors';
import { createJournal, deleteJournal, listJournals, updateJournal } from '$lib/data/journals';
import { isJournalColor, isJournalIcon } from '$lib/journals/appearance';
import type { JournalFont, TextSize } from '$lib/journals/fonts';
import { readTypeFields, type JournalFormErrors } from '$lib/journals/form';
import type { Crumb } from '$lib/nav/breadcrumbs';
import type { NoticeName } from '$lib/toast/notices';
import type { Actions, PageServerLoad } from './$types';

/** Matches the old project's limits, which the column itself does not enforce. */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 500;

type JournalErrors = JournalFormErrors;

/**
 * Which dialog a failure belongs to, so the page knows where to show it. There
 * are no `values` here: the dialog holds what was typed in component state and
 * stays open across a rejected submit, so there is nothing to echo back.
 */
type JournalActionResult = {
	intent: 'create' | 'edit' | 'delete';
	errors: JournalErrors;
};

/**
 * The hook redirects an anonymous request to /login before any load runs, so
 * this is unreachable. It exists because `locals.user` is typed nullable and the
 * alternative is a non-null assertion that would hide a real regression if the
 * guard were ever narrowed.
 */
function requireUser(user: App.Locals['user']) {
	if (!user) {
		error(401, 'Not signed in.');
	}
	return user;
}

export const load: PageServerLoad = async ({ locals, cookies }) => {
	// Set by `/reset-password` on its redirect here, and shown once: read and
	// deleted on the same response, so a reload does not show it again. Drawn
	// as a toast by the root layout (`$lib/toast/notices`).
	const passwordChanged = cookies.get(NOTICE_COOKIE) === PASSWORD_CHANGED;
	if (passwordChanged) {
		cookies.delete(NOTICE_COOKIE, { path: '/' });
	}
	const notice: NoticeName | null = passwordChanged ? 'password-changed' : null;

	// Soft-deleted and hidden journals are filtered inside the query layer, not
	// here. A read failure throws and becomes a 500 — there is no half of this
	// page worth rendering without the list.
	return {
		notice,
		journals: await listJournals(locals.supabase),
		// One crumb, unlinked: this is the top of the trail and the page you are on.
		breadcrumbs: [{ label: 'Journals' }] satisfies Crumb[]
	};
};

type Parsed = {
	fields: {
		title: string;
		description: string | null;
		color: string;
		icon: string;
		font?: JournalFont;
		text_size?: TextSize;
	};
	errors: JournalErrors;
};

function parse(submitted: FormData): Parsed {
	const title = String(submitted.get('title') ?? '').trim();
	const description = String(submitted.get('description') ?? '').trim();
	const color = String(submitted.get('color') ?? '');
	const icon = String(submitted.get('icon') ?? '');
	// Left out when the form does not send them (`readTypeFields`).
	const type = readTypeFields(submitted);

	const errors: JournalErrors = { ...type.errors };

	if (title.length === 0) {
		errors.title = 'Give the journal a name.';
	} else if (title.length > MAX_TITLE) {
		errors.title = `Keep the name to ${MAX_TITLE} characters or fewer.`;
	}

	if (description.length > MAX_DESCRIPTION) {
		errors.description = `Keep the description to ${MAX_DESCRIPTION} characters or fewer.`;
	}

	// The database has no CHECK behind either of these — the palette is a
	// presentation decision and lives in the app — so this is the only thing
	// standing between a hand-made POST and an unrenderable value in the column.
	if (!isJournalColor(color)) {
		errors.color = 'Pick a colour.';
	}

	if (!isJournalIcon(icon)) {
		errors.icon = 'Pick an icon.';
	}

	return {
		// An empty description is stored as NULL rather than '', so "no
		// description" is one value in the column instead of two.
		fields: {
			title,
			description: description.length > 0 ? description : null,
			color,
			icon,
			...type.fields
		},
		errors
	};
}

/**
 * A write the database refused, in words.
 *
 * `PGRST116` is PostgREST for "your filter matched no row". Every write here
 * ends in `.single()` behind a `journal_id` and a `deleted_at IS NULL` filter,
 * so it means the journal is gone — deleted in another tab, most likely — not
 * that anything is broken.
 */
function describe(failure: unknown, fallback: string): JournalErrors {
	if (failure instanceof DataError && failure.postgrest.code === 'PGRST116') {
		return { form: 'That journal no longer exists. Refresh to see the current list.' };
	}
	return { form: fallback };
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const user = requireUser(locals.user);
		const { fields, errors } = parse(await request.formData());

		if (Object.keys(errors).length > 0) {
			return fail(400, { intent: 'create', errors } satisfies JournalActionResult);
		}

		try {
			// `user_id` is passed because the INSERT policy's WITH CHECK requires it.
			// Nothing else on this page names an owner: RLS scopes the rest.
			await createJournal(locals.supabase, user.id, fields);
		} catch (failure) {
			return fail(500, {
				intent: 'create',
				errors: describe(failure, 'Could not create the journal. Try again.')
			} satisfies JournalActionResult);
		}
	},

	edit: async ({ request, locals }) => {
		requireUser(locals.user);
		const submitted = await request.formData();
		const journalId = String(submitted.get('journal_id') ?? '');
		const { fields, errors } = parse(submitted);

		if (journalId.length === 0) {
			errors.form = 'Could not tell which journal to change.';
		}

		if (Object.keys(errors).length > 0) {
			return fail(400, { intent: 'edit', errors } satisfies JournalActionResult);
		}

		try {
			// `is_favorite` is deliberately not here. It changes the list's sort and
			// wants a filter control beside it, which is separate work.
			await updateJournal(locals.supabase, journalId, fields);
		} catch (failure) {
			return fail(500, {
				intent: 'edit',
				errors: describe(failure, 'Could not save the changes. Try again.')
			} satisfies JournalActionResult);
		}
	},

	delete: async ({ request, locals }) => {
		requireUser(locals.user);
		const journalId = String((await request.formData()).get('journal_id') ?? '');

		if (journalId.length === 0) {
			return fail(400, {
				intent: 'delete',
				errors: { form: 'Could not tell which journal to delete.' }
			} satisfies JournalActionResult);
		}

		try {
			// Soft delete. The entries go with it through the trigger built in
			// section 1, so there is nothing to clean up here. Deleting a journal
			// that is already gone is a no-op rather than an error — the update
			// carries its own `deleted_at IS NULL` filter and matches no row.
			await deleteJournal(locals.supabase, journalId);
		} catch (failure) {
			return fail(500, {
				intent: 'delete',
				errors: describe(failure, 'Could not delete the journal. Try again.')
			} satisfies JournalActionResult);
		}
	}
};
