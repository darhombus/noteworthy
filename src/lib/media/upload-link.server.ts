/**
 * Signed upload links: how a file reaches Storage without the browser holding
 * a session.
 *
 * The browser asks `/media/upload` for a link, saying the file's type and size,
 * and uploads the file to Storage with it. This decides whether to give one.
 * The server makes the path, never the browser, so a path is always
 * `<user id>/<random id>.<extension>` in the caller's own folder, with the
 * extension of the type it was asked for.
 *
 * ---------------------------------------------------------------------------
 * WHAT STORAGE ENFORCES, AND WHAT THIS ADDS
 * ---------------------------------------------------------------------------
 * Measured on storage-api v1.77.5 (`docs/constraints.md`, "Media and
 * Storage"). A link is made as the person, through `locals.supabase`, so the
 * insert policy runs then: folder, name shape, and "something is left". It sees
 * the link request's own size and type, not the file's. The upload with the
 * link runs as Storage's superuser and meets only the bucket's own limits (25
 * MB, the accepted types) and `fn_media_allowance_enforce()`, the trigger that
 * holds the allowance on the kept row, with its real size.
 *
 * A link is bound to one path, once (a second upload there is a 409), and
 * lasts two hours. It is not bound to a size or a type. So the checks here are
 * for the person, not for the bound: they turn a file that cannot fit into the
 * queue's own words before anything is sent. Somebody who lies about the size
 * gets a link, uploads, and is refused by the trigger.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';
import { FILE_LIMIT_BYTES } from './limits';
import {
	noSpaceMessage,
	nounFor,
	refusedMessage,
	SPACE_UNKNOWN,
	tooBigMessage,
	unsupportedMessage
} from './messages';
import { allowanceRemaining } from './page.server';
import { MEDIA_BUCKET, newMediaPath } from './paths';
import { ACCEPTED_TYPES, type AcceptedType } from './types';

/** What the browser asks for: a link for a file of this type and size. */
export type LinkRequest = { type: string; size: number };

export type LinkRefusal = {
	ok: false;
	status: number;
	/**
	 * `type`, `too-big` and `no-space` are the file; `allowance` and `storage`
	 * are this server or Storage failing to answer.
	 */
	reason: 'invalid' | 'type' | 'too-big' | 'no-space' | 'allowance' | 'storage';
	message: string;
	/** Bytes left, with `no-space`, so the queue can say it with its own noun. */
	remaining?: number;
};

export type LinkIssued = {
	ok: true;
	path: string;
	/** Where to PUT the file. Holds the token; good for one upload, to `path`. */
	url: string;
	/** Bytes left before this file. */
	remaining: number;
};

/** The answer to a body `readLinkRequest` would not read. */
export const INVALID_LINK_REQUEST: LinkRefusal = {
	ok: false,
	status: 400,
	reason: 'invalid',
	message: 'Could not read what was sent.'
};

/**
 * The request body, or `null` if it is not one.
 *
 * Exactly `type` and `size`. A body naming a `path` is refused rather than
 * ignored: the path is this server's to make, and a client sending one is a
 * client that has misunderstood that.
 */
export function readLinkRequest(body: unknown): LinkRequest | null {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return null;
	}
	const keys = Object.keys(body).sort();
	if (keys.length !== 2 || keys[0] !== 'size' || keys[1] !== 'type') {
		return null;
	}
	const { type, size } = body as Record<string, unknown>;
	if (typeof type !== 'string' || typeof size !== 'number' || !Number.isSafeInteger(size)) {
		return null;
	}
	return size > 0 ? { type, size } : null;
}

/**
 * Whether `type` is one the bucket stores, exactly as it will be sent. The
 * browser normalises (`canonicalType`) before it asks, so anything else here
 * is a client that skipped that, and Storage would store it as sent.
 */
function isAcceptedType(type: string): type is AcceptedType {
	return Object.hasOwn(ACCEPTED_TYPES, type);
}

/** Checks `request` against the limits, as `userId`, and makes a link if it fits. */
export async function issueUploadLink(
	supabase: SupabaseClient<Database>,
	userId: string,
	request: LinkRequest
): Promise<LinkIssued | LinkRefusal> {
	const { type, size } = request;
	if (!isAcceptedType(type)) {
		return { ok: false, status: 415, reason: 'type', message: unsupportedMessage('', type) };
	}
	const noun = nounFor(type);

	if (size > FILE_LIMIT_BYTES) {
		return { ok: false, status: 413, reason: 'too-big', message: tooBigMessage(noun, size) };
	}

	// As the person: the same function, and the same rows, the policy reads.
	const remaining = await allowanceRemaining(supabase);
	if (remaining === null) {
		return { ok: false, status: 503, reason: 'allowance', message: SPACE_UNKNOWN };
	}
	if (size > remaining) {
		return {
			ok: false,
			status: 403,
			reason: 'no-space',
			message: noSpaceMessage(noun, size, remaining),
			remaining
		};
	}

	const path = newMediaPath(userId, type);
	try {
		const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
		if (error !== null) {
			const status = 'status' in error && typeof error.status === 'number' ? error.status : 502;
			return {
				ok: false,
				status: 502,
				reason: 'storage',
				message: refusedMessage(status, error.message)
			};
		}
		return { ok: true, path, url: data.signedUrl, remaining };
	} catch (thrown) {
		return {
			ok: false,
			status: 502,
			reason: 'storage',
			message: refusedMessage(502, thrown instanceof Error ? thrown.message : String(thrown))
		};
	}
}
