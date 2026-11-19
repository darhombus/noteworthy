/**
 * The network calls an upload makes from the browser.
 *
 * The browser holds no session it can use: it asks this app's server for a
 * signed upload link (`/media/upload`), then sends the file to Storage with
 * it. The server checks the size against the allowance and makes the path
 * (`$lib/media/upload-link.server`). The file itself goes straight to Storage,
 * not through the server: a video or audio file can be 25 MB, and a Vercel
 * function refuses a request body over 4.5 MB.
 *
 * Every call asks for a fresh link, except a retry of an upload that never got
 * an answer (`unanswered`, below). A link lasts two hours and is checked when
 * its upload starts, so one that ran out is only ever a failure that Try again
 * fixes.
 */
import {
	OFFLINE,
	SIGNED_OUT,
	SPACE_UNKNOWN,
	nounFor,
	refusedMessage,
	tooBigMessage
} from './messages';
import type { PreparedMedia } from './prepare';
import { UploadRefused } from './upload-queue';

const LINKS = '/media/upload';

/**
 * Kept as stored files were before links: `max-age=3600` is what supabase-js
 * sent as `cacheControl` with every upload. A raw body with no header would be
 * stored as `no-cache`. A signed download is not served with it, locally
 * (storage-api v1.94.2) or on hosted: Storage sends an `Expires` an hour on
 * instead, and no `Cache-Control` (docs/constraints.md, "Media and Storage").
 */
const CACHE_CONTROL = 'max-age=3600';

type Refusal = { reason?: unknown; message?: unknown; remaining?: unknown };

async function readJson(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function refusalOf(body: unknown): Refusal {
	return typeof body === 'object' && body !== null ? (body as Refusal) : {};
}

/** Bytes left in the allowance, as the server reads it. `null` when signed out. */
export async function remainingAllowance(): Promise<number | null> {
	const response = await fetch(LINKS, { headers: { accept: 'application/json' } });
	if (response.status === 401) {
		return null;
	}
	const body = refusalOf(await readJson(response));
	if (!response.ok || typeof body.remaining !== 'number') {
		throw new Error(`allowance: ${response.status}`);
	}
	return body.remaining;
}

type Link = { path: string; url: string; remaining: number };

/** A link for `prepared`, or the server's refusal as the queue shows it. */
async function askForLink(prepared: PreparedMedia): Promise<Link> {
	let response: Response;
	try {
		response = await fetch(LINKS, {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ type: prepared.type, size: prepared.blob.size })
		});
	} catch {
		throw new UploadRefused(OFFLINE, { retryable: true });
	}

	const body = await readJson(response);
	if (response.ok) {
		const link = body as Partial<Link> | null;
		if (
			typeof link?.path === 'string' &&
			typeof link.url === 'string' &&
			typeof link.remaining === 'number'
		) {
			return { path: link.path, url: link.url, remaining: link.remaining };
		}
		throw new UploadRefused(refusedMessage(response.status, 'no link in the answer'), {
			retryable: true
		});
	}

	const refusal = refusalOf(body);
	const message = typeof refusal.message === 'string' ? refusal.message : '';
	switch (refusal.reason) {
		case 'signed-out':
			throw new UploadRefused(SIGNED_OUT, { retryable: true });
		case 'no-space':
			if (typeof refusal.remaining === 'number') {
				throw new UploadRefused(message, { retryable: true, remaining: refusal.remaining });
			}
			break;
		case 'too-big':
			throw new UploadRefused(tooBigMessage(nounFor(prepared.type), prepared.blob.size), {
				retryable: false
			});
		case 'type':
			throw new UploadRefused(message, { retryable: false });
		case 'allowance':
			throw new UploadRefused(SPACE_UNKNOWN, { retryable: true });
	}
	throw new UploadRefused(refusedMessage(response.status, message), { retryable: true });
}

/**
 * Storage's refusal, from its body: it answers most refusals with HTTP 400 and
 * puts the real status in `statusCode` (`"403"` for the allowance trigger,
 * `"413"` for size, `"415"` for type).
 */
function storageCode(status: number, body: unknown): { code: string; message: string } {
	const raw = refusalOf(body) as { statusCode?: unknown; message?: unknown };
	return {
		code: typeof raw.statusCode === 'string' ? raw.statusCode : String(status),
		message: typeof raw.message === 'string' ? raw.message : ''
	};
}

/**
 * Links whose upload was sent and never answered, by the file they were for.
 *
 * A connection that drops during the upload can drop after Storage has the
 * whole file: on a phone switching to aeroplane mode, the request fails in the
 * browser while Storage stores what it received. That file is real, counts
 * against the allowance, and no entry names it. A retry with a fresh link
 * would store a second. So Try again sends to the same link: Storage answers
 * 409 if the first one arrived, which means it is stored, and stores it if
 * not. Either way, one file. The queue keeps the same `PreparedMedia` across a
 * retry (it is not encoded twice), which is what this is keyed by; a `WeakMap`,
 * so a file removed from the queue takes its link with it.
 *
 * Only within the link's two hours: after that Storage refuses the link
 * before it looks for the file, this forgets it, and the next Try again asks
 * for a fresh one. A first file that did arrive is then left for
 * `remove_unused_media()`, which removes a file no entry names at its first
 * nightly run once the file is a day old.
 */
const unanswered = new WeakMap<PreparedMedia, Link>();

/**
 * Stores `prepared` under a path the server makes, and returns the path with
 * the allowance as it stood before this file.
 *
 * A raw body, typed exactly as `prepared.type`, which is already one of the
 * accepted types (`canonicalType`): Storage stores a raw body's type as sent.
 * `x-upsert: false`: a link is for a fresh path, and one file.
 */
export async function storePrepared(
	prepared: PreparedMedia
): Promise<{ path: string; remaining: number }> {
	const kept = unanswered.get(prepared);
	const link = kept ?? (await askForLink(prepared));

	let response: Response;
	try {
		response = await fetch(link.url, {
			method: 'PUT',
			headers: {
				'content-type': prepared.type,
				'cache-control': CACHE_CONTROL,
				'x-upsert': 'false'
			},
			body: prepared.blob
		});
	} catch {
		unanswered.set(prepared, link);
		throw new UploadRefused(OFFLINE, { retryable: true });
	}
	unanswered.delete(prepared);

	if (response.ok) {
		return { path: link.path, remaining: link.remaining };
	}

	const { code, message } = storageCode(response.status, await readJson(response));
	if (kept !== undefined && (response.status === 409 || code === '409')) {
		// The unanswered upload arrived after all. Nobody else holds this link,
		// and Storage writes the row only once the bytes are stored.
		return { path: link.path, remaining: link.remaining };
	}
	if (response.status === 413 || code === '413') {
		throw new UploadRefused(tooBigMessage(nounFor(prepared.type), prepared.blob.size), {
			retryable: false
		});
	}
	if (code === '403') {
		// The allowance trigger, or the policy behind it: the queue reads the
		// allowance again to say which, with numbers.
		throw new UploadRefused(refusedMessage(response.status, message), {
			retryable: true,
			policy: true
		});
	}
	// An expired or spoiled link among them: Try again asks for a fresh one.
	throw new UploadRefused(refusedMessage(response.status, message), { retryable: true });
}
