/**
 * Turns the storage paths a page is about to render into signed URLs.
 *
 * The `media` bucket is private, so a path on its own opens nothing. This is the
 * one place a path becomes something a browser can fetch, and it runs on the
 * server only (`.server.ts` keeps it out of any client bundle).
 *
 * ---------------------------------------------------------------------------
 * ONE CALL, OWN FOLDER, THE PERSON'S OWN SESSION
 * ---------------------------------------------------------------------------
 * A page collects every path it renders and asks once: Storage signs a list in a
 * single request, and a page with twenty photos should not make twenty round
 * trips to Frankfurt.
 *
 * Only paths in the caller's own folder are sent. Anything else — another
 * person's folder, or a string not in the path shape — is dropped before the
 * request and simply comes back unsigned. That is the first of two layers. The
 * second is that the client doing the signing is the request's own
 * (`event.locals.supabase`), carrying the person's session, not a service key:
 * Storage signs only what that person's select policy lets them see, which is
 * their own folder. Either layer alone would keep someone else's file unsigned.
 *
 * A path that is in the caller's folder but that Storage cannot sign — a file
 * since removed, say — is left out of `urls` too, and the rest are still signed.
 * The page decides how a missing file looks. A request that fails outright
 * throws.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { MEDIA_BUCKET, isOwnMediaPath } from './paths';
import { SIGNED_URL_SECONDS, type SignedMedia } from './signed';

export { SIGNED_URL_SECONDS, type SignedMedia };

/**
 * Signs `paths` for the person `userId`, in one request.
 *
 * `userId` is `event.locals.user.id`, and `supabase` the same request's
 * `event.locals.supabase`. Duplicates are signed once.
 */
export async function signMediaPaths(
	supabase: SupabaseClient<Database>,
	userId: string,
	paths: Iterable<string>
): Promise<SignedMedia> {
	const signedAt = Math.floor(Date.now() / 1000) * 1000;
	const expiresAt = signedAt + SIGNED_URL_SECONDS * 1000;
	const own = [...new Set(paths)].filter((path) => isOwnMediaPath(path, userId));

	if (own.length === 0) {
		return { urls: {}, expiresAt, signedAt };
	}

	const { data, error } = await supabase.storage
		.from(MEDIA_BUCKET)
		.createSignedUrls(own, SIGNED_URL_SECONDS);

	if (error !== null) {
		throw new Error(`sign media: ${error.message}`, { cause: error });
	}

	const urls: Record<string, string> = {};
	for (const signed of data) {
		if (signed.error === null && signed.path !== null && signed.signedUrl !== null) {
			urls[signed.path] = signed.signedUrl;
		}
	}
	return { urls, expiresAt, signedAt };
}
