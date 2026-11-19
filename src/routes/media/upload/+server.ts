/**
 * A signed upload link for one file, and the allowance left.
 *
 * POST `{ type, size }` answers `{ path, url, remaining }`: the queue uploads
 * the file to `url` and puts `path` in the entry. A refusal is
 * `{ reason, message }` with the status the reason calls for, and `remaining`
 * with `no-space`. See `$lib/media/upload-link.server`.
 *
 * GET answers `{ remaining }`, for the queue to say why Storage refused a file
 * after all (`$lib/media/upload-queue`).
 *
 * Answers 401 rather than a redirect when nobody is signed in, like
 * `/media/sign` — `hooks.server.ts` names it in `JSON_ROUTES`.
 */
import { json } from '@sveltejs/kit';
import { allowanceRemaining } from '$lib/media/page.server';
import {
	INVALID_LINK_REQUEST,
	issueUploadLink,
	readLinkRequest
} from '$lib/media/upload-link.server';
import { SPACE_UNKNOWN } from '$lib/media/messages';
import type { RequestHandler } from './$types';

const SIGNED_OUT = { reason: 'signed-out', message: 'You have been signed out.' };

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user === null) {
		return json(SIGNED_OUT, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		body = null;
	}
	const asked = readLinkRequest(body);
	if (asked === null) {
		const { reason, message, status } = INVALID_LINK_REQUEST;
		return json({ reason, message }, { status });
	}

	const answer = await issueUploadLink(locals.supabase, locals.user.id, asked);
	if (answer.ok) {
		const { path, url, remaining } = answer;
		return json({ path, url, remaining });
	}
	const { status, reason, message, remaining } = answer;
	return json(remaining === undefined ? { reason, message } : { reason, message, remaining }, {
		status
	});
};

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.user === null) {
		return json(SIGNED_OUT, { status: 401 });
	}
	const remaining = await allowanceRemaining(locals.supabase);
	if (remaining === null) {
		return json({ reason: 'allowance', message: SPACE_UNKNOWN }, { status: 503 });
	}
	return json({ remaining });
};
