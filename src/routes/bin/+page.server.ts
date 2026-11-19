import { fail } from '@sveltejs/kit';
import { requireUser } from '$lib/auth/require';
import type { Deleted } from '$lib/bin/forever';
import { removeFiles } from '$lib/bin/remove.server';
import { BIN_CONTENTS, parseTab, showsWaiting } from '$lib/bin/rows';
import {
	binBytes,
	deleteEntryForever,
	deleteJournalForever,
	emptyBin,
	isWaitingFile,
	listBinItems,
	listWaitingFiles,
	restoreEntry,
	restoreJournal
} from '$lib/data/bin';
import { DataError } from '$lib/data/errors';
import { isUuid } from '$lib/data/ids';
import { signPageMedia } from '$lib/media/page.server';
import type { Crumb } from '$lib/nav/breadcrumbs';
import type { Actions, PageServerLoad } from './$types';

/**
 * The Recycle Bin. Reads the entries and journals (`bin_items()`), the waiting
 * files (`waiting_files()`) and the bytes Empty bin would free
 * (`media_breakdown()`), the three in parallel, whichever tab is showing:
 * Empty bin is at the top of every tab and empties everything, so every tab
 * needs every count. In parallel they cost one round trip, the same as the
 * one or two Section 2 read. Only the photos the tab shows are signed, in one
 * batch like any page's photos; no request at all when there are none.
 *
 * `now` is the server's clock, for the first render's "days left". The page
 * takes over with the browser's clock once it runs.
 *
 * Re-run on every change of `?tab=` (SvelteKit tracks `url.searchParams`),
 * after a restore by `use:enhance`, and after deleting for good by
 * invalidating `BIN_CONTENTS`.
 */
export const load: PageServerLoad = async ({ locals, url, depends }) => {
	const user = requireUser(locals.user);
	depends(BIN_CONTENTS);
	const tab = parseTab(url.searchParams.get('tab'));

	const [items, waiting, bytes] = await Promise.all([
		listBinItems(locals.supabase),
		listWaitingFiles(locals.supabase),
		binBytes(locals.supabase)
	]);

	const photos = showsWaiting(tab)
		? waiting.filter((file) => file.type.startsWith('image/')).map((file) => file.path)
		: [];

	return {
		tab,
		items,
		waiting,
		bytes,
		thumbnails: await signPageMedia(locals.supabase, user.id, photos),
		now: Date.now(),
		breadcrumbs: [{ label: 'Recycle Bin' }] satisfies Crumb[]
	};
};

/** Postgres' `no_data_found`, which the bin's functions raise for anything not in the bin. */
const NOT_IN_BIN = 'P0002';

/** `object_not_in_prerequisite_state`: a journal in the bin that still holds a live entry. */
const HOLDS_LIVE_ENTRY = '55000';

type ActionFailure = { message: string };

function isCode(failure: unknown, code: string): boolean {
	return failure instanceof DataError && failure.postgrest.code === code;
}

export const actions: Actions = {
	/**
	 * Restores one entry or journal. The kind and id come from the row's menu;
	 * the function decides, from `auth.uid()`, whether it is the caller's to
	 * restore, so a forged id restores nothing.
	 *
	 * An entry whose journal is in the bin brings the journal back with it. The
	 * page asks first; the database does it either way, because an entry cannot
	 * be live in a deleted journal.
	 */
	restore: async ({ request, locals }) => {
		requireUser(locals.user);
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const id = String(form.get('id') ?? '');

		if ((kind !== 'entry' && kind !== 'journal') || !isUuid(id)) {
			return fail(400, {
				message: 'Couldn’t tell what to restore. Reload the page and try again.'
			} satisfies ActionFailure);
		}

		try {
			if (kind === 'entry') {
				await restoreEntry(locals.supabase, id);
			} else {
				await restoreJournal(locals.supabase, id);
			}
		} catch (failure) {
			if (isCode(failure, NOT_IN_BIN)) {
				return fail(404, {
					message:
						'That’s no longer in the Recycle Bin. It may have been restored in another tab. The list is up to date now.'
				} satisfies ActionFailure);
			}
			return fail(500, { message: 'Couldn’t restore it. Try again.' } satisfies ActionFailure);
		}

		return { restored: { kind, id } };
	},

	/**
	 * Deletes one entry or journal for good: the rows in the database function,
	 * then the files it returns through Storage. As with restoring, the function
	 * decides from `auth.uid()` what is the caller's.
	 */
	deleteForever: async ({ request, locals }) => {
		const user = requireUser(locals.user);
		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const id = String(form.get('id') ?? '');

		if ((kind !== 'entry' && kind !== 'journal') || !isUuid(id)) {
			return fail(400, {
				message: 'Couldn’t tell what to delete. Reload the page and try again.'
			} satisfies ActionFailure);
		}

		let paths: string[];
		try {
			paths =
				kind === 'entry'
					? await deleteEntryForever(locals.supabase, id)
					: await deleteJournalForever(locals.supabase, id);
		} catch (failure) {
			if (isCode(failure, NOT_IN_BIN)) {
				return { deleted: kind, gone: true, filesLeft: 0 } satisfies Deleted;
			}
			if (isCode(failure, HOLDS_LIVE_ENTRY)) {
				return fail(409, {
					message:
						'This journal holds an entry saved after it was deleted, so it wasn’t deleted. Restore the journal to see that entry.'
				} satisfies ActionFailure);
			}
			return fail(500, { message: 'Couldn’t delete it. Try again.' } satisfies ActionFailure);
		}

		const files = await removeFiles(locals.supabase, user.id, paths);
		return { deleted: kind, gone: false, filesLeft: files.left.length } satisfies Deleted;
	},

	/**
	 * Delete now, on a waiting file. Only a file that is still waiting: in the
	 * caller's folder, with a release record, and named by no entry row. One an
	 * entry names again since the list was drawn (an undo, say) is left alone.
	 */
	clearFile: async ({ request, locals }) => {
		const user = requireUser(locals.user);
		const form = await request.formData();
		const path = String(form.get('path') ?? '');

		if (!path.startsWith(`${user.id}/`) || path.length > 200) {
			return fail(400, {
				message: 'Couldn’t tell which file to delete. Reload the page and try again.'
			} satisfies ActionFailure);
		}

		let waiting: boolean;
		try {
			waiting = await isWaitingFile(locals.supabase, path);
		} catch {
			return fail(500, { message: 'Couldn’t delete it. Try again.' } satisfies ActionFailure);
		}
		if (!waiting) {
			return { deleted: 'file', gone: true, filesLeft: 0 } satisfies Deleted;
		}

		const files = await removeFiles(locals.supabase, user.id, [path]);
		return { deleted: 'file', gone: false, filesLeft: files.left.length } satisfies Deleted;
	},

	/**
	 * Empty bin: every entry and journal in the bin, then their files and every
	 * waiting file. A second press finds nothing and removes nothing.
	 */
	emptyBin: async ({ locals }) => {
		const user = requireUser(locals.user);

		let paths: string[];
		try {
			paths = await emptyBin(locals.supabase);
		} catch {
			return fail(500, {
				message: 'Couldn’t empty the Recycle Bin. Try again.'
			} satisfies ActionFailure);
		}

		const files = await removeFiles(locals.supabase, user.id, paths);
		return { deleted: 'bin', gone: false, filesLeft: files.left.length } satisfies Deleted;
	}
};
