/**
 * The file types an entry can hold, and how a browser's report of a file's type
 * becomes one of them.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TYPE IS NORMALISED BEFORE UPLOAD
 * ---------------------------------------------------------------------------
 * The `media` bucket accepts the keys of `ACCEPTED_TYPES`, and Storage compares
 * them without regard to case. What it stores depends on how the file is sent
 * (storage-api v1.94.2, hosted and local from 2026-11-16; v1.77.5 refused a raw
 * `AUDIO/WEBM` with 415, v1.73.1 also a raw `audio/webm;codecs=opus`, and the
 * form's case folding was seen only on v1.73.1):
 *
 *   raw body, type in the Content-Type header
 *       `audio/webm;codecs=opus`  accepted, stored as sent, parameters and all
 *       `AUDIO/WEBM`              accepted, stored as sent, in capitals
 *   multipart form, type on the file part (what supabase-js sends for a Blob)
 *       `audio/webm;codecs=opus`  accepted, stored as `audio/webm`
 *       `AUDIO/WEBM`              accepted, stored as `audio/webm`
 *   either way
 *       `audio/x-m4a`, `audio/mp3` refused, 415
 *
 * Chrome's recorder reports `audio/webm;codecs=opus`, Safari's `audio/mp4`, and
 * Chrome on Windows calls an `.m4a` file `audio/x-m4a`. So the upload decides the
 * type itself, with `canonicalType`, and sends exactly that: the app's uploads
 * are a raw PUT to a signed link (`upload.ts`), with `content-type` set to that
 * type, and the app's server refuses to make a link for any type not exactly a
 * key of `ACCEPTED_TYPES`, case included, though Storage would take it. The prepared file
 * is also a Blob made with `new Blob([file], { type })`, so its own `type`
 * agrees with the header. That habit dates from uploading with supabase-js,
 * which ignores `contentType` when it is handed a Blob and sends a form with
 * the Blob's own `type` instead; anything that still uploads that way (a test,
 * a script) needs it. Then the stored type is the same whichever way the file
 * travelled, and no alias depends on which path happens to forgive it.
 *
 * Extensions come from the type, never from the person's file name, and are what
 * the storage path ends in (`paths.ts`). The insert policy in
 * `20260922120000_private_media.sql` lists the same extensions.
 */

export type MediaKind = 'image' | 'video' | 'audio';

export const ACCEPTED_TYPES = {
	'image/jpeg': { kind: 'image', extension: 'jpg' },
	'image/png': { kind: 'image', extension: 'png' },
	'image/gif': { kind: 'image', extension: 'gif' },
	'image/webp': { kind: 'image', extension: 'webp' },
	'video/mp4': { kind: 'video', extension: 'mp4' },
	'video/webm': { kind: 'video', extension: 'webm' },
	'video/quicktime': { kind: 'video', extension: 'mov' },
	'audio/webm': { kind: 'audio', extension: 'webm' },
	'audio/mpeg': { kind: 'audio', extension: 'mp3' },
	'audio/mp4': { kind: 'audio', extension: 'm4a' },
	'audio/ogg': { kind: 'audio', extension: 'ogg' }
} as const satisfies Record<string, { kind: MediaKind; extension: string }>;

export type AcceptedType = keyof typeof ACCEPTED_TYPES;

/** Every extension a stored path may end in. */
export const ACCEPTED_EXTENSIONS: readonly string[] = [
	...new Set(Object.values(ACCEPTED_TYPES).map(({ extension }) => extension))
];

/**
 * Other names browsers give the same formats.
 *
 * Only ones seen in practice: `audio/x-m4a` and `audio/m4a` for an `.m4a` file,
 * `audio/mp3` for an `.mp3`, and `image/jpg` from some Android apps. `audio/aac`
 * is not an alias — it is a raw AAC stream rather than an MP4 container — and is
 * not accepted.
 */
const ALIASES: Readonly<Record<string, AcceptedType>> = {
	'audio/x-m4a': 'audio/mp4',
	'audio/m4a': 'audio/mp4',
	'audio/mp3': 'audio/mpeg',
	'image/jpg': 'image/jpeg'
};

/**
 * Used only when the browser reports no type at all, which it does for an
 * extension the operating system does not recognise.
 */
const BY_EXTENSION: Readonly<Record<string, AcceptedType>> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	webp: 'image/webp',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	ogg: 'audio/ogg',
	oga: 'audio/ogg',
	opus: 'audio/ogg'
};

/**
 * The extensions a stored file of `kind` may end in.
 *
 * `webm` is in two lists, because WebM holds video or audio alike. That is why
 * an entry's media node says which kind it is by its own type — `image`, and in
 * later sections `video` and `audio` — rather than leaving the extension to say.
 */
export function extensionsFor(kind: MediaKind): readonly string[] {
	return [
		...new Set(
			Object.values(ACCEPTED_TYPES)
				.filter((accepted) => accepted.kind === kind)
				.map(({ extension }) => extension)
		)
	];
}

function isAccepted(type: string): type is AcceptedType {
	return Object.hasOwn(ACCEPTED_TYPES, type);
}

/**
 * The accepted type a file should be uploaded as, or `null` if it is not one
 * Noteworthy stores.
 *
 * `reported` is `File.type` or `Blob.type`. Parameters are dropped
 * (`audio/webm;codecs=opus` is `audio/webm`), case is folded and aliases are
 * mapped. The file name is consulted only when nothing was reported: a type that
 * *was* reported and is not accepted stays refused, whatever the name claims.
 */
export function canonicalType(reported: string, fileName = ''): AcceptedType | null {
	const bare = reported.split(';', 1)[0].trim().toLowerCase();

	if (bare.length > 0) {
		if (isAccepted(bare)) {
			return bare;
		}
		return Object.hasOwn(ALIASES, bare) ? ALIASES[bare] : null;
	}

	const dot = fileName.lastIndexOf('.');
	const extension = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
	return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : null;
}
