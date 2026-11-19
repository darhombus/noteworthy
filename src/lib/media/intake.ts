/**
 * What a file handed to the editor is, and whether it can be taken — decided
 * before anything is decoded or uploaded.
 *
 * Pure, so the rules can be pinned in Node: the browser half, decoding and
 * re-encoding, is `image.ts`.
 *
 * ---------------------------------------------------------------------------
 * HEIC
 * ---------------------------------------------------------------------------
 * iPhones take photos as HEIC. What the page receives depends on the route
 * the file took:
 *
 *   Picked on an iPhone, through the file input: iOS converts it to JPEG
 *   before the page sees it, whatever the input's `accept` says — the page is
 *   handed `image/jpeg` and a `.jpg` name.
 *
 *   Picked in Safari on a Mac: converted only when `accept` lists concrete
 *   types and not HEIC, into the first listed type the Mac can convert to.
 *   The input lists `image/jpeg` first for exactly that reason.
 *
 *   Dragged or pasted, on any computer, or picked in a browser that does not
 *   convert: the page gets the HEIC file itself, as `image/heic` or `image/heif`
 *   (or with no type, and a `.heic` name).
 *
 * HEIC is not a type Noteworthy stores, but a photo is re-encoded before it is
 * stored anyway. So a HEIC file is taken as *input*: if this browser can decode
 * it (Safari can), it is stored as WebP or JPEG like any other photo, and if it
 * cannot (Chrome and Firefox cannot), the person is told so by name rather than
 * shown a generic failure.
 */
import { FILE_LIMIT_BYTES } from './limits';
import { nounFor, tooBigMessage, unsupportedMessage, type FileNoun } from './messages';
import { ACCEPTED_TYPES, canonicalType, type AcceptedType, type MediaKind } from './types';

/**
 * What *Photo or video* asks for: concrete types, JPEG first. See HEIC above —
 * adding the video types after the photo ones does not change what a Mac does
 * with a HEIC photo, which is decided by the first image type it can convert to.
 */
export const PHOTO_OR_VIDEO_ACCEPT =
	'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime';

/**
 * What *Audio file* asks for. The extensions are there as well as the types
 * because operating systems disagree about what an `.m4a` or `.opus` is called —
 * Windows says `audio/x-m4a` — and a picker that greys out somebody's voice memo
 * over a name is a picker that looks broken.
 */
export const AUDIO_ACCEPT =
	'audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,.mp3,.m4a,.webm,.ogg,.oga,.opus';

/**
 * Video types that mean audio when somebody asked for an audio file.
 *
 * A browser names a picked file by its extension, and `.webm` and `.mp4` are
 * video extensions to every operating system — a voice memo saved as `.webm`
 * arrives as `video/webm`. Picked through *Audio file*, that is an audio file,
 * and it should be a player with no picture rather than a black box. Pasted or
 * dropped, with nothing to say otherwise, the type stands.
 */
export const AS_AUDIO: Readonly<Partial<Record<AcceptedType, AcceptedType>>> = {
	'video/webm': 'audio/webm',
	'video/mp4': 'audio/mp4'
};

const HEIC_TYPES = new Set([
	'image/heic',
	'image/heif',
	'image/heic-sequence',
	'image/heif-sequence'
]);
const HEIC_EXTENSIONS = new Set(['heic', 'heif']);

export type FileFacts = { name: string; type: string; size: number };

export type Intake =
	| {
			ok: true;
			/** Which node it becomes. */
			kind: MediaKind;
			/**
			 * The type it is stored as, when that is known before it is prepared: a
			 * file stored as it arrived. `null` for a photo, whose type is whatever
			 * its re-encoding comes out as.
			 */
			type: AcceptedType | null;
			/**
			 * Stored as it arrived, rather than re-encoded: a GIF, for its animation,
			 * and every video and audio file.
			 */
			asIs: boolean;
			/** A HEIC photo, which not every browser can decode. */
			heic: boolean;
			noun: FileNoun;
	  }
	| { ok: false; message: string };

export type IntakeOptions = {
	/** The file was picked through *Audio file*. See `AS_AUDIO`. */
	audio?: boolean;
};

function isHeic(file: FileFacts): boolean {
	const bare = file.type.split(';', 1)[0].trim().toLowerCase();
	if (HEIC_TYPES.has(bare)) {
		return true;
	}
	if (bare.length > 0) {
		return false;
	}
	const dot = file.name.lastIndexOf('.');
	return dot !== -1 && HEIC_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase());
}

/**
 * Whether `file` can go into an entry, and how.
 *
 * Refusals that can be made from the file's type and size alone are made here,
 * so nothing is decoded or uploaded for them. Anything stored as it arrived —
 * a GIF, a video, an audio file — and over the per-file limit is one; a photo
 * is not, because what is stored is the re-encoded copy, which is never more
 * than 2 MB, however large the original.
 */
export function intake(file: FileFacts, options: IntakeOptions = {}): Intake {
	if (isHeic(file)) {
		return { ok: true, kind: 'image', type: null, asIs: false, heic: true, noun: 'photo' };
	}

	const reported = canonicalType(file.type, file.name);
	if (reported === null) {
		return { ok: false, message: unsupportedMessage(file.name, file.type) };
	}

	const type = (options.audio === true ? AS_AUDIO[reported] : undefined) ?? reported;
	const { kind } = ACCEPTED_TYPES[type];
	const noun = nounFor(type);

	if (kind === 'image' && type !== 'image/gif') {
		return { ok: true, kind, type: null, asIs: false, heic: false, noun };
	}

	if (file.size > FILE_LIMIT_BYTES) {
		return { ok: false, message: tooBigMessage(noun, file.size) };
	}
	return { ok: true, kind, type, asIs: true, heic: false, noun };
}

/**
 * The pixel size in a GIF's header, or `null` if these are not a GIF's bytes.
 * The logical screen size, little-endian, straight after the six-byte signature.
 */
export function gifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 10) {
		return null;
	}
	const signature = String.fromCharCode(...bytes.subarray(0, 6));
	if (signature !== 'GIF87a' && signature !== 'GIF89a') {
		return null;
	}
	const width = bytes[6] | (bytes[7] << 8);
	const height = bytes[8] | (bytes[9] << 8);
	return width > 0 && height > 0 ? { width, height } : null;
}

/** `width` × `height` scaled to fit within `edge` on the long side, never enlarged. */
export function fitWithin(
	width: number,
	height: number,
	edge: number
): { width: number; height: number } {
	const scale = Math.min(1, edge / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}
