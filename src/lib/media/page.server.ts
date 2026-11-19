/**
 * What a page's load needs about media, gathered in one place so the read
 * view, the edit page, the new-entry page, the shell and the Storage page ask
 * the same way.
 *
 * None of these functions throws. A page whose photos could not be signed is still a
 * page worth rendering — its text is fine, and the browser asks again for the
 * links (`$lib/media/links`) — and an allowance that could not be read only
 * means the Add media menu shows no figure. Failing the whole load over either
 * would turn a Storage hiccup into an entry nobody can open.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mediaPaths } from '$lib/entries/media';
import type { Database, Json } from '$lib/types/database';
import { signMediaPaths, SIGNED_URL_SECONDS, type SignedMedia } from './sign.server';
import type { MediaBreakdown } from './usage';

/** Every path the body renders, signed in one request. */
export function signEntryMedia(
	supabase: SupabaseClient<Database>,
	userId: string,
	body: Json
): Promise<SignedMedia> {
	return signPageMedia(supabase, userId, mediaPaths(body));
}

/** `paths`, signed in one request, for a page that is not one entry's (the Recycle Bin's). */
export async function signPageMedia(
	supabase: SupabaseClient<Database>,
	userId: string,
	paths: Iterable<string>
): Promise<SignedMedia> {
	try {
		return await signMediaPaths(supabase, userId, paths);
	} catch (thrown) {
		console.warn('media: signing a page’s paths failed', thrown);
		// Nothing signed, and a lifetime that is already over, so the browser's
		// first move is to ask for fresh links.
		const now = Date.now();
		return { urls: {}, signedAt: now, expiresAt: now - SIGNED_URL_SECONDS * 1000 };
	}
}

/**
 * Bytes left in the caller's allowance, or `null` if the database would not say.
 *
 * Read through `media_allowance_remaining()`, the function Storage's insert
 * policy calls, so the figure the menu shows is the one an upload is held to.
 */
export async function allowanceRemaining(
	supabase: SupabaseClient<Database>
): Promise<number | null> {
	try {
		const { data, error } = await supabase.rpc('media_allowance_remaining');
		return error === null && typeof data === 'number' ? data : null;
	} catch {
		return null;
	}
}

/**
 * The caller's usage by kind, with the bin's files and the waiting files apart,
 * or `null` if the database would not say.
 *
 * One call to `media_breakdown()`, which works it all out inside the database:
 * the sizes are in `storage.objects` and the references in the entry bodies,
 * and bringing either here to join would mean shipping every body over the
 * wire to read a handful of paths out of it.
 */
export async function mediaBreakdown(
	supabase: SupabaseClient<Database>
): Promise<MediaBreakdown | null> {
	try {
		const { data, error } = await supabase.rpc('media_breakdown').single();
		return error === null ? data : null;
	} catch {
		return null;
	}
}
