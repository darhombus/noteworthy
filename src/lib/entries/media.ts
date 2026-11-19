/**
 * The media an entry body holds, read off its document.
 *
 * Every question the app asks about an entry's files goes through here: which
 * paths a page has to sign, whether a body is blank (a photo on its own is not),
 * how close an entry is to the cap, and whether the plain-text fallback can be
 * trusted with it. No imports beyond the column's type, so the server, the
 * editor and the read view can all use it without pulling anything else in.
 *
 * `MEDIA_NODE_TYPES` has one type per kind of media, named as the kinds in
 * `$lib/media/types` are. `document.ts` says why they are separate types rather
 * than one.
 */
import type { Json } from '$lib/types/database';

export const MEDIA_NODE_TYPES = ['image', 'video', 'audio'] as const;

export type MediaNodeType = (typeof MEDIA_NODE_TYPES)[number];

export type MediaRef = { type: MediaNodeType; path: string };

/** The same bound as the walks in `document.ts` and `render.ts`. */
const MAX_DEPTH = 24;

function isMediaType(value: unknown): value is MediaNodeType {
	return (MEDIA_NODE_TYPES as readonly unknown[]).includes(value);
}

/** Whether a ProseMirror node is a photo, video or audio item. */
export function isMediaNode(node: { type: { name: string } }): boolean {
	return isMediaType(node.type.name);
}

function collect(nodes: Json | undefined, depth: number, into: MediaRef[]): void {
	if (!Array.isArray(nodes) || depth > MAX_DEPTH) {
		return;
	}

	for (const node of nodes) {
		if (typeof node !== 'object' || node === null || Array.isArray(node)) {
			continue;
		}

		if (isMediaType(node.type)) {
			const attrs = node.attrs;
			const path =
				typeof attrs === 'object' && attrs !== null && !Array.isArray(attrs) ? attrs.path : null;
			if (typeof path === 'string') {
				into.push({ type: node.type, path });
			}
			continue;
		}

		collect(node.content, depth + 1, into);
	}
}

/**
 * Every media node in the body, in document order, as its type and its path.
 *
 * Nothing is validated here: a node is counted if it has a string path. What a
 * path is allowed to be is the sanitiser's question, and what may be signed is
 * the signer's.
 */
export function mediaIn(body: Json): MediaRef[] {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return [];
	}
	const found: MediaRef[] = [];
	collect(body.content, 1, found);
	return found;
}

export function countMedia(body: Json): number {
	return mediaIn(body).length;
}

export function hasMedia(body: Json): boolean {
	return countMedia(body) > 0;
}

/** Each path once, for signing. */
export function mediaPaths(body: Json): string[] {
	return [...new Set(mediaIn(body).map((ref) => ref.path))];
}
