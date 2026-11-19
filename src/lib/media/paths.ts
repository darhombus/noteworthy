/**
 * Where a file lives in Storage, and the one shape its path may take.
 *
 * Entries store this path, never a URL: a URL goes stale, and a page resolves
 * paths to signed URLs when it renders (`sign.server.ts`). Every path is
 *
 *     <user id>/<random id>.<extension>
 *
 * with both ids as lower-case uuids and the extension taken from the file's
 * accepted type (`types.ts`). The first segment is the owner: Storage's policies
 * confine reading and writing to the caller's own folder by it, and the insert
 * policy in `20260922120000_private_media.sql` refuses any name outside this
 * shape, so nothing else can exist in the bucket to be pointed at.
 *
 * The random id is a version 4 uuid built from `crypto.getRandomValues`, not
 * `crypto.randomUUID()`. The latter exists only in a secure context — HTTPS or
 * localhost — and a phone reaching the dev server over the LAN on plain http is
 * neither. `getRandomValues` has no such restriction.
 */
import {
	ACCEPTED_EXTENSIONS,
	ACCEPTED_TYPES,
	extensionsFor,
	type AcceptedType,
	type MediaKind
} from './types';

export const MEDIA_BUCKET = 'media';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const PATH = new RegExp(`^(${UUID})/${UUID}\\.(?:${ACCEPTED_EXTENSIONS.join('|')})$`);

/** Whether `path` has the one shape a stored media path may have. */
export function isMediaPath(path: string): boolean {
	return PATH.test(path);
}

/** Whether `path` has that shape and sits in `userId`'s own folder. */
export function isOwnMediaPath(path: string, userId: string): boolean {
	return PATH.exec(path)?.[1] === userId;
}

/**
 * Whether `path` ends in an extension a file of `kind` is stored under.
 *
 * Shape only: combine it with `isMediaPath` or `isOwnMediaPath`. The entry
 * sanitiser uses the two together, so an `image` node can only point at an
 * image-shaped file in the writer's own folder.
 */
export function hasExtensionFor(path: string, kind: MediaKind): boolean {
	const dot = path.lastIndexOf('.');
	return dot !== -1 && extensionsFor(kind).includes(path.slice(dot + 1));
}

function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	// RFC 9562 version 4: the version nibble, then the variant bits.
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fresh path in `userId`'s folder for a file of `type`. */
export function newMediaPath(userId: string, type: AcceptedType): string {
	const path = `${userId}/${randomId()}.${ACCEPTED_TYPES[type].extension}`;
	if (!isOwnMediaPath(path, userId)) {
		throw new Error(`not a user id a media path can be made for: ${JSON.stringify(userId)}`);
	}
	return path;
}
