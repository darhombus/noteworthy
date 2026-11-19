/**
 * Fresh signed links, for a page that has been open long enough to need them.
 *
 * A page is rendered with its photos already signed, for an hour. What asks
 * here is `$lib/media/links` in the browser: ten minutes before those links
 * expire, when a tab comes back from being hidden past that point, when a photo
 * fails to load, and for a path the page was not rendered with (a photo pasted
 * in from another entry). One request for all of them, as on the server.
 *
 * Signing stays on the server, through `signMediaPaths` and the person's own
 * session: only paths in their folder are sent, and Storage signs only what
 * their read policy shows them. Anything else simply comes back unsigned.
 *
 * Answers 401 rather than a redirect when nobody is signed in, like the
 * autosave endpoint and for the same reason — `hooks.server.ts` names it in
 * `JSON_ROUTES`.
 */
import { json } from '@sveltejs/kit';
import { MAX_MEDIA_PER_ENTRY } from '$lib/media/limits';
import { signMediaPaths } from '$lib/media/sign.server';
import type { RequestHandler } from './$types';

/**
 * More than one entry's worth, for a page that has had photos pasted in from
 * elsewhere, and far short of anything that makes one request expensive.
 */
const MAX_PATHS = MAX_MEDIA_PER_ENTRY * 5;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (locals.user === null) {
		return json({ reason: 'signed-out', message: 'You have been signed out.' }, { status: 401 });
	}

	let paths: unknown;
	try {
		paths = ((await request.json()) as { paths?: unknown }).paths;
	} catch {
		return json({ reason: 'invalid', message: 'Could not read what was sent.' }, { status: 400 });
	}

	if (
		!Array.isArray(paths) ||
		paths.length > MAX_PATHS ||
		!paths.every((path): path is string => typeof path === 'string')
	) {
		return json({ reason: 'invalid', message: 'Could not read what was sent.' }, { status: 400 });
	}

	try {
		return json(await signMediaPaths(locals.supabase, locals.user.id, paths));
	} catch {
		return json({ reason: 'server', message: 'Could not sign the links.' }, { status: 500 });
	}
};
