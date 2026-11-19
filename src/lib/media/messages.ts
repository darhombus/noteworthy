/**
 * Everything the app says about a file it will not, or could not, take.
 *
 * One rule runs through all of it: say what happened, with the numbers. "This
 * GIF is 31 MB. The limit for one file is 25 MB." rather than "Upload failed".
 * A person who is told the number knows what to do next — pick a smaller file,
 * or clear some space — and a person who is told "failed" presses Try again on
 * something that will fail again.
 *
 * ---------------------------------------------------------------------------
 * HOW THE NUMBERS ARE ROUNDED
 * ---------------------------------------------------------------------------
 * Megabytes are binary, as everywhere else (`limits.ts`). One decimal under
 * 10 MB and whole numbers above, which is as precise as anybody reads a file
 * size — except where rounding would make the sentence contradict itself. A
 * 25.3 MB file is not "25 MB" in a message saying the limit is 25 MB, and a
 * 1.84 MB photo refused with 1.81 MB left is not "1.8 MB, and you have 1.8 MB
 * left". In those two cases the figures gain decimals until they read the way
 * the comparison came out. Space left is rounded down, so it is never
 * overstated.
 */
import { ALLOWANCE_BYTES, FILE_LIMIT_BYTES, MAX_MEDIA_PER_ENTRY, MB } from './limits';
import { ACCEPTED_TYPES, type AcceptedType } from './types';

/** A file's name, quoted, or a generic noun when the browser gave it none. */
function called(name: string): string {
	return name.trim().length > 0 ? `“${name}”` : 'This file';
}

function defaultDigits(bytes: number): number {
	return bytes < 10 * MB ? 1 : 0;
}

function megabytes(bytes: number, digits: number, round: (value: number) => number): number {
	const factor = 10 ** digits;
	return round((bytes / MB) * factor) / factor;
}

function show(value: number, digits: number): string {
	const text = value.toFixed(digits);
	return `${digits > 0 ? text.replace(/\.?0+$/, '') : text} MB`;
}

/** A file's size, to the nearest tenth of a megabyte, or megabyte above 10 MB. */
export function formatSize(bytes: number): string {
	if (bytes <= 0) {
		return '0 MB';
	}
	const digits = defaultDigits(bytes);
	const value = megabytes(bytes, digits, Math.round);
	// A 30 KB file is not "0 MB".
	return value === 0 ? '0.1 MB' : show(value, digits);
}

/** Space left, rounded down so it is never more than there is. */
export function formatLeft(bytes: number): string {
	if (bytes <= 0) {
		return '0 MB';
	}
	const digits = defaultDigits(bytes);
	return show(megabytes(bytes, digits, Math.floor), digits);
}

/** `bytes`, shown with enough decimals to read as more than `limit`. */
function showOver(bytes: number, limit: number): string {
	for (let digits = defaultDigits(bytes); digits <= 2; digits += 1) {
		const value = megabytes(bytes, digits, Math.round);
		if (value * MB > limit) {
			return show(value, digits);
		}
	}
	return show(megabytes(bytes, 2, Math.ceil), 2);
}

/** What a person calls a file of each kind, in "This ___ is 31 MB". */
export type FileNoun = 'photo' | 'GIF' | 'video' | 'audio file';

/** The noun for a file stored as `type`. */
export function nounFor(type: AcceptedType): FileNoun {
	if (type === 'image/gif') {
		return 'GIF';
	}
	const { kind } = ACCEPTED_TYPES[type];
	return kind === 'image' ? 'photo' : kind === 'video' ? 'video' : 'audio file';
}

export function tooBigMessage(noun: FileNoun, bytes: number): string {
	return `This ${noun} is ${showOver(bytes, FILE_LIMIT_BYTES)}. The limit for one file is ${show(FILE_LIMIT_BYTES / MB, 0)}.`;
}

export function noSpaceMessage(noun: FileNoun, bytes: number, left: number): string {
	if (left <= 0) {
		return `This ${noun} is ${formatSize(bytes)}, and you have no space left: all ${show(ALLOWANCE_BYTES / MB, 0)} is in use.`;
	}
	// More decimals until the two figures read the way round they are.
	for (let digits = Math.min(defaultDigits(bytes), defaultDigits(left)); digits <= 2; digits += 1) {
		const size = megabytes(bytes, digits, Math.round);
		const spare = megabytes(left, digits, Math.floor);
		if (size > spare) {
			return `This ${noun} is ${show(size, digits)}, and you have ${show(spare, digits)} left.`;
		}
	}
	return `This ${noun} is ${formatSize(bytes)}, and you have only a little less than that left.`;
}

/** Shown when the entry is already full, before anything is uploaded. */
export const ENTRY_FULL = `This entry already holds ${MAX_MEDIA_PER_ENTRY} photos, videos and recordings, the most one entry can. Remove one to add another.`;

/** Shown when a save arrives holding more than the cap. */
export function tooManyMessage(count: number): string {
	return `An entry can hold at most ${MAX_MEDIA_PER_ENTRY} photos, videos and recordings. This one has ${count}.`;
}

export function unsupportedMessage(name: string, type: string): string {
	const reported = type.trim().length > 0 ? ` (${type.split(';', 1)[0].trim()})` : '';
	return `${called(name)} can’t be added${reported}. Photos can be JPEG, PNG, GIF or WebP; videos MP4, WebM or MOV; audio MP3, M4A, WebM or Ogg.`;
}

/** Anything else that went wrong adding a file, with whatever the browser said. */
export function notAddedMessage(noun: FileNoun, detail: string): string {
	return `This ${noun} couldn’t be added (${detail}).`;
}

/**
 * A video or audio file that would not play, even with a fresh link. The link
 * is the one cause the app can fix, and it already tried; what is left is a
 * format this browser cannot play — an iPhone's HEVC video in a browser without
 * HEVC, say — or a damaged file.
 */
export function unplayableMessage(kind: 'video' | 'audio'): string {
	return kind === 'video'
		? 'This video couldn’t be played. This browser may not support its format.'
		: 'This audio couldn’t be played. This browser may not support its format.';
}

/**
 * The browser handed over a file it cannot decode. HEIC is the case worth
 * naming: iPhones take photos in it, and a browser other than Safari cannot
 * read it.
 */
export function unreadableMessage(name: string, heic: boolean): string {
	return heic
		? `${called(name)} is a HEIC photo, which this browser can’t open. Choose it from your Photos library on the phone itself, or save it as a JPEG first.`
		: `${called(name)} couldn’t be opened as a photo. The file may be damaged.`;
}

/** The photo came out over the per-photo size at every setting that was tried. */
export function unshrinkableMessage(bytes: number): string {
	return `This photo couldn’t be made small enough to store: the smallest version came out at ${formatSize(bytes)}, and a photo can be at most 2 MB.`;
}

export const OFFLINE = 'The upload didn’t reach the server. Check your connection, then try again.';

export const SIGNED_OUT =
	'You’ve been signed out, so the upload couldn’t be stored. Sign in again in another tab, then try again.';

export const SPACE_UNKNOWN =
	'Couldn’t check how much space you have left, so nothing was uploaded. Check your connection, then try again.';

/** Storage refused for a reason this app has no better words for; the code is still news. */
export function refusedMessage(status: number, detail: string): string {
	const why = detail.trim().length > 0 ? `: ${detail.trim()}` : '';
	return `The server refused the upload (error ${status}${why}).`;
}
