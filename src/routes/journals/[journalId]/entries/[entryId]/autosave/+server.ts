/**
 * The write the editor makes while somebody is typing.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ENDPOINT AND NOT THE FORM ACTION NEXT DOOR
 * ---------------------------------------------------------------------------
 * The action is still there and still does the same job for a submit with no
 * JavaScript. What it cannot do is tell the editor *why* a save failed, and
 * under autosave that is most of the work: a dropped network, an expired
 * session, a rejected document and a broken server are four different things to
 * say to somebody, and three of them are recoverable in different ways. A form
 * action answers with an `ActionResult` whose failures are all `fail(status)`
 * and whose redirects `fetch` follows silently — an expired session would come
 * back as a 200 holding the login page, which reads as success.
 *
 * So: a JSON endpoint with real status codes, and a `reason` in the body that
 * names the case rather than making the client infer it from a number.
 *
 * ---------------------------------------------------------------------------
 * 401 RATHER THAN A REDIRECT
 * ---------------------------------------------------------------------------
 * `hooks.server.ts` bounces an unauthenticated request to `/login`, which is
 * right for a page and wrong for this. That file names this route so it answers
 * 401 instead — see the note there. Nothing in this handler can do it, because
 * the hook runs first and the redirect never reaches here.
 *
 * ---------------------------------------------------------------------------
 * CREATING, FROM THE NEW-ENTRY PAGE
 * ---------------------------------------------------------------------------
 * The new-entry page autosaves too, and its first save has no row to update. It
 * picks the entry's id itself before anything is written, posts here under that
 * id with `create: true`, and keeps posting `create: true` until one of those
 * attempts has answered. `createEntryOnce` makes repeating it harmless — see
 * the note there for why a lost reply is the case that matters.
 *
 * Creating is asked for, never inferred. An update that finds no row answers
 * with an error, as it always has, rather than falling through to an insert:
 * the edit page for an entry deleted in another tab must not quietly bring it
 * back.
 *
 * ---------------------------------------------------------------------------
 * THE REVISION
 * ---------------------------------------------------------------------------
 * An update names the revision its text was made from, a fresh `saveId`, and
 * the page's saves that were never answered (`$lib/entries/revision`).
 * `saveEntry` applies it only from that revision or on top of one of those
 * saves; `$lib/data/entries`, SAVES, has why. The answers:
 *
 *   200 `{ updatedAt, revision }`  applied; `revision` is the entry's now.
 *   409 `reason: 'stale'`          changed somewhere else; `revision` is the
 *                                  entry's now. Nothing was written.
 *   410 `reason: 'deleted'`        in the Recycle Bin. Nothing was written.
 *   404 `reason: 'not-found'`      no such entry for this person.
 *
 * A create names no revision: its row does not exist yet. Its `unanswered`
 * are the page's earlier creates, which a repeat is held to.
 *
 * ---------------------------------------------------------------------------
 * GET: HAS IT CHANGED SOMEWHERE ELSE?
 * ---------------------------------------------------------------------------
 * An open entry page asks, when it is shown or focused again, for the entry's
 * revision and the save it was last written by (`$lib/entries/conflict.svelte`):
 * `{ revision, lastSaveId }`, one select of two small columns by the key. With
 * `?text`, for "Use the saved version", the title, date and body as well. On
 * this route so that it is answered as a save is: 401 rather than a redirect
 * (`hooks.server.ts`), refused while a password is being chosen, never stored.
 * 410 for an entry in the Recycle Bin, 404 for none.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT CHECK
 * ---------------------------------------------------------------------------
 * On an update, `journalId` is in the path and is not read. The edit page's
 * load already cross-checked that the entry belongs to that journal, RLS scopes
 * the update to entries the caller owns, and `saveEntry` filters on
 * `entry_id` — so re-reading the entry here would buy nothing but a second
 * round trip on every save, against a database that is ~250ms away. A create
 * does read it: that is the journal the new row goes into.
 */
import { json } from '@sveltejs/kit';
import { createEntryOnce, readEntryVersion, saveEntry, type SaveOutcome } from '$lib/data/entries';
import { isUuid } from '$lib/data/ids';
import { firstError, validateEntryEdit } from '$lib/entries/edit';
import { readCreateAttempt, readSaveCheck } from '$lib/entries/revision';
import type { RequestHandler } from './$types';

/** What the editor posts. Anything else is a 400. */
type AutosaveBody = {
	title?: unknown;
	entryDate?: unknown;
	doc?: unknown;
	/** `true` from the new-entry page until its row exists. */
	create?: unknown;
	/** The revision the text was made from. Not sent with a create. */
	revision?: unknown;
	saveId?: unknown;
	unanswered?: unknown;
};

const OUT_OF_DATE = {
	reason: 'invalid',
	message: 'this page is out of date. Copy your text, then reload.'
} as const;

/** The answer for a save that was refused, or that found nothing. */
function refused(outcome: Exclude<SaveOutcome, { kind: 'saved' }> | null): Response {
	if (outcome === null) {
		return json({ reason: 'not-found', message: 'That entry no longer exists.' }, { status: 404 });
	}
	if (outcome.kind === 'deleted') {
		return json(
			{ reason: 'deleted', message: 'This entry is in the Recycle Bin.' },
			{ status: 410 }
		);
	}
	return json(
		{
			reason: 'stale',
			message: 'This entry changed somewhere else.',
			revision: outcome.revision
		},
		{ status: 409 }
	);
}

export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (locals.user === null) {
		return json({ reason: 'signed-out', message: 'You have been signed out.' }, { status: 401 });
	}
	if (!isUuid(params.entryId) || !isUuid(params.journalId)) {
		return refused(null);
	}
	try {
		const version = await readEntryVersion(
			locals.supabase,
			params.entryId,
			url.searchParams.has('text')
		);
		if (version === null || version.deleted) {
			return refused(version === null ? null : { kind: 'deleted' });
		}
		return json({
			revision: version.revision,
			lastSaveId: version.lastSaveId,
			...(version.text === null
				? {}
				: {
						title: version.text.title ?? '',
						entryDate: version.text.entry_date,
						content: version.text.content
					})
		});
	} catch {
		return json({ reason: 'server', message: 'Could not read the entry.' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request, locals, params }) => {
	// Belt and braces with the hook, which already answers 401 for this route
	// when nobody is signed in. If that rule is ever edited away, this is what
	// stops the endpoint running against an anonymous client.
	if (locals.user === null) {
		return json({ reason: 'signed-out', message: 'You have been signed out.' }, { status: 401 });
	}

	if (!isUuid(params.entryId) || !isUuid(params.journalId)) {
		return refused(null);
	}

	let body: AutosaveBody;
	try {
		body = (await request.json()) as AutosaveBody;
	} catch {
		return json({ reason: 'invalid', message: 'Could not read what was sent.' }, { status: 400 });
	}

	const result = validateEntryEdit({
		title: typeof body.title === 'string' ? body.title : '',
		entryDate: typeof body.entryDate === 'string' ? body.entryDate : '',
		doc: typeof body.doc === 'string' ? body.doc : null,
		// This path never carries the textarea's text — the textarea is gone by
		// the time autosave exists — so there is nothing for `toBody` to fall
		// back to, and a missing `doc` is simply an invalid request.
		body: '',
		// Whose folder a photo's path has to be in. From the verified session,
		// never from anything the request says.
		owner: locals.user.id
	});

	if (!result.ok) {
		return json(
			{ reason: 'invalid', message: firstError(result.errors), errors: result.errors },
			{ status: 400 }
		);
	}

	try {
		// `word_count` is deliberately not named here, for the reasons set out at
		// the top of `$lib/data/entries.ts`. Autosave is the surface that makes
		// FINDING 7-A worst — a body that used to be written once per edit is now
		// written every few seconds — and it is still not this file's to fix.
		if (body.create === true) {
			const attempt = readCreateAttempt(body);
			if (attempt === null) {
				return json(OUT_OF_DATE, { status: 400 });
			}
			const created = await createEntryOnce(
				locals.supabase,
				params.entryId,
				{ journal_id: params.journalId, ...result.patch },
				attempt
			);
			if (created === null) {
				// The id is taken by a row this person may not write. A random uuid
				// colliding by accident is not a real prospect, so this is a client
				// sending an id it did not generate, and there is nothing to retry.
				return json(
					{ reason: 'conflict', message: 'This entry could not be created.' },
					{ status: 409 }
				);
			}
			if (created.kind !== 'saved') {
				return refused(created);
			}
			return json({ updatedAt: created.entry.updated_at, revision: created.entry.revision });
		}

		const check = readSaveCheck(body);
		if (check === null) {
			// A page from before revisions existed, still open across a deploy. Its
			// save cannot be checked, so it is not applied.
			return json(OUT_OF_DATE, { status: 400 });
		}
		const saved = await saveEntry(locals.supabase, params.entryId, result.patch, check);
		if (saved === null || saved.kind !== 'saved') {
			return refused(saved);
		}
		return json({ updatedAt: saved.entry.updated_at, revision: saved.entry.revision });
	} catch {
		return json({ reason: 'server', message: 'Could not save. Try again.' }, { status: 500 });
	}
};
