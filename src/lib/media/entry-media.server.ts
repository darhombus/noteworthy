/**
 * An entry's media links for the read page's and the edit page's loads: on a
 * tap, sent after the text rather than before it (PRD 09, Section 5).
 *
 * A client's data request (`__data.json`: a tap, Back, a preload, an
 * `invalidate`) gets the signing as a promise, which SvelteKit streams: the
 * entry's text goes as soon as it is read, and the links follow in the same
 * response when Storage has signed them. A document — the first page of a
 * visit, a reload, every page without JavaScript — awaits them, so its HTML
 * has every photo and player with its link, exactly as before: a document's
 * promise would be streamed too, into a page with no script to take it.
 *
 * An entry with nothing to sign is awaited whatever the request: the signing
 * returns before sending anything (`signMediaPaths`), and a promise would only
 * add a chunk to the response.
 *
 * `Server-Timing`: an awaited signing is `sign`, as before. A streamed one
 * has finished after the header has gone, so it is marked `sign-stream` (a
 * count, 1, sent as a duration), and its time is the response's download: the
 * readout's `dl`, from the text's first byte to the links' last. Its Storage
 * call is not in `sb-stor` for the same reason.
 *
 * Never rejects: `signEntryMedia` turns a failed signing into a batch with
 * nothing signed, which the browser asks `/media/sign` about.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { mediaPaths } from '$lib/entries/media';
import type { Json } from '$lib/types/database';
import { signEntryMedia } from './page.server';
import type { SignedMedia } from './signed';

export async function entryMediaForLoad(
	event: Pick<RequestEvent, 'locals' | 'isDataRequest'>,
	userId: string,
	body: Json
): Promise<{ media: SignedMedia | Promise<SignedMedia> }> {
	const { locals } = event;
	const sign = () => signEntryMedia(locals.supabase, userId, body);
	if (event.isDataRequest && mediaPaths(body).length > 0) {
		locals.timing.record('sign-stream', 1);
		return { media: sign() };
	}
	return { media: await locals.timing.measure('sign', sign) };
}
