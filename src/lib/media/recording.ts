/**
 * Recording audio: which format, how long, and what to say — decided without
 * touching a microphone.
 *
 * Pure, so the rules are pinned in Node. The browser half, the microphone and
 * the recorder, is `recorder.ts`; the panel is `AudioRecorder.svelte`.
 *
 * ---------------------------------------------------------------------------
 * THE FORMAT, BY ASKING
 * ---------------------------------------------------------------------------
 * `MediaRecorder.isTypeSupported` is asked about each of `RECORDING_FORMATS` in
 * turn, and the first it accepts is used. What the engines answered, on
 * Windows (2026-09-24):
 *
 *                       mp4 (AAC)   mp4 (Opus)   Ogg Opus   WebM Opus
 *   Chromium 153        yes         yes          no         yes (its default)
 *   Firefox 155         no          no           yes        yes; Ogg is its default
 *   Playwright WebKit   — no MediaRecorder and no getUserMedia at all —
 *
 * Safari records MP4 with AAC, by Apple's documentation; no Safari was
 * available to ask.
 *
 * AAC in MP4 comes first because it is the one every browser plays, Safari on
 * every iPhone included, and a journal recorded on a laptop is read on a
 * phone. It also carries its own length: Chromium's MP4 recording reported
 * 7.57 s for an 8 s recording and seeked. Ogg is next, for Firefox: its Ogg
 * recordings have a length and seek, and its WebM ones have neither. WebM is
 * last, for a browser that offers nothing else; its missing length is repaired
 * before upload (`webm.ts`).
 *
 * ---------------------------------------------------------------------------
 * 30 MINUTES MUST FIT IN 25 MB
 * ---------------------------------------------------------------------------
 * Every engine records at 128 kbps unless told otherwise — about 28 MB for
 * half an hour, which Storage would refuse after the person had spoken for all
 * of it. Measured on white noise (the worst case for an encoder) over 20 s:
 *
 *                                   asked 64 kbps    30 minutes
 *   Chromium 153, AAC in MP4        98–100 kbps      21.0–21.4 MB
 *   Chromium 153, Opus in WebM      65 kbps          13.9 MB
 *   Firefox 155, Opus in Ogg        65 kbps          14.0 MB
 *   (any, left at its default)      118–133 kbps     25.4–28.5 MB
 *
 * Chromium's AAC encoder will not go below 96 kbps — it says so in
 * `audioBitsPerSecond` after construction — so asking for 64 is not enough on
 * its own, and Safari's encoder could not be measured. So the length is
 * guaranteed by size, not by trusting a bitrate:
 *
 *   Before recording, the panel says how long the recording can be: 30:00, or
 *   less if the space left in the allowance (or the 25 MB for one file) would
 *   run out first at the rate the recorder says it will use.
 *
 *   While recording, the bytes actually written are counted, and the expected
 *   end is worked out again from the rate they arrive at. A minute before the
 *   end, the panel says so.
 *
 *   Recording stops by itself, and keeps everything, at 30:00 or when the next
 *   few seconds would no longer fit — whichever comes first — and says which.
 *
 * So a recording is never refused for its size after it was made. The upload
 * queue still checks size and space at the recording's turn, as for any file:
 * another upload queued ahead of it can take the space it was planned for, and
 * then the queue says so with both figures.
 */
import { FILE_LIMIT_BYTES } from './limits';
import { formatLeft, formatSize } from './messages';
import { ACCEPTED_TYPES, canonicalType, type AcceptedType } from './types';

/** In order of preference: see THE FORMAT, BY ASKING. */
export const RECORDING_FORMATS = [
	'audio/mp4;codecs=mp4a.40.2',
	'audio/mp4',
	'audio/ogg;codecs=opus',
	'audio/webm;codecs=opus',
	'audio/webm'
] as const;

/** What the recorder is asked for. Chromium's AAC encoder will not go this low. */
export const RECORDING_BITS_PER_SECOND = 64_000;

/** The longest a recording can be. */
export const RECORDING_MAX_MS = 30 * 60_000;

/** How often the recorder hands over what it has, which is how the bytes are counted. */
export const RECORDING_SLICE_MS = 1000;

/** A recording shorter than this is not worth starting: there is no space for one. */
export const RECORDING_MIN_MS = 10_000;

/**
 * Held back from the space a recording may use: the last slice, which arrives
 * after Stop, and some slack for an encoder running over its rate. Seconds of
 * the recorder's rate, plus a fixed amount for the file's own header.
 */
const HEADROOM_SECONDS = 5;
const HEADROOM_BYTES = 64 * 1024;

/** How much faster than it says a recorder is assumed to write, until it has been measured. */
const RATE_MARGIN = 1.1;

/** How long before the measured rate is trusted over the recorder's own figure. */
const MEASURE_AFTER_MS = 5000;

/** When the panel starts saying the end is near. */
export const WARN_BEFORE_END_MS = 60_000;

export type RecordingFormat = { mimeType: string; type: AcceptedType };

export type RecordingSupport =
	| ({ ok: true } & RecordingFormat)
	| { ok: false; reason: 'insecure' | 'unavailable' | 'format'; message: string };

export type RecordingEnvironment = {
	/** `window.isSecureContext`. */
	secure: boolean;
	/** Whether `navigator.mediaDevices.getUserMedia` exists. */
	microphone: boolean;
	/** Whether `MediaRecorder` exists. */
	recorder: boolean;
	isTypeSupported: (type: string) => boolean;
};

export const RECORDING_INSECURE =
	'Recording needs a secure (https) connection. This page was opened over plain http, where browsers don’t allow the microphone.';

export const RECORDING_UNAVAILABLE =
	'This browser can’t record audio. You can still add an audio file recorded elsewhere.';

export const RECORDING_NO_FORMAT =
	'This browser can’t record in a format Noteworthy stores (MP4, Ogg or WebM audio). You can still add an audio file recorded elsewhere.';

/** Whether this browser can record, and in what, or why not. */
export function recordingSupport(env: RecordingEnvironment): RecordingSupport {
	// Checked first: over plain http the microphone API is simply missing, and
	// "this browser can't record" would send somebody looking for another browser
	// when the answer is the address.
	if (!env.secure) {
		return { ok: false, reason: 'insecure', message: RECORDING_INSECURE };
	}
	if (!env.microphone || !env.recorder) {
		return { ok: false, reason: 'unavailable', message: RECORDING_UNAVAILABLE };
	}
	for (const mimeType of RECORDING_FORMATS) {
		const type = canonicalType(mimeType);
		if (
			type !== null &&
			ACCEPTED_TYPES[type].kind === 'audio' &&
			safely(env.isTypeSupported, mimeType)
		) {
			return { ok: true, mimeType, type };
		}
	}
	return { ok: false, reason: 'format', message: RECORDING_NO_FORMAT };
}

function safely(ask: (type: string) => boolean, type: string): boolean {
	try {
		return ask(type);
	} catch {
		return false;
	}
}

/** The type a recorder reported once it started, as it will be stored. */
export function recordedType(reported: string, asked: AcceptedType): AcceptedType {
	const type = canonicalType(reported);
	// A recorder that reports nothing, or a video type for sound only, is taken
	// at what it was asked for — the container is the same.
	return type !== null && ACCEPTED_TYPES[type].kind === 'audio' ? type : asked;
}

/** What ends a recording: the 30 minutes, the 25 MB of one file, or the space left. */
export type RecordingLimit = 'time' | 'file' | 'space';

export type RecordingPlan = {
	/** The most the recording may weigh when it stops. */
	budget: number;
	/** What the budget is short of: one file's limit, or the allowance when less is left. */
	room: 'file' | 'space';
	/** How long it can go on, at the rate the recorder says it will use. */
	limitMs: number;
	/** What decides that. */
	limitedBy: RecordingLimit;
	/** Bytes a second the plan assumed. */
	rate: number;
};

/**
 * How long a recording can be, before it starts.
 *
 * `remaining` is the allowance left, or `null` if it could not be read — in
 * which case only the per-file limit is planned for, and the upload's own
 * check has the last word. `bitsPerSecond` is what the recorder says it will
 * write (`audioBitsPerSecond` after construction), which for Chromium's AAC is
 * its 96 kbps floor rather than what was asked.
 */
export function planRecording(remaining: number | null, bitsPerSecond: number): RecordingPlan {
	const rate = (Math.max(bitsPerSecond, RECORDING_BITS_PER_SECOND) / 8) * RATE_MARGIN;
	const space = remaining === null ? Number.POSITIVE_INFINITY : Math.max(0, remaining);
	const room = space < FILE_LIMIT_BYTES ? 'space' : 'file';
	const budget = Math.max(
		0,
		Math.min(FILE_LIMIT_BYTES, space) - HEADROOM_BYTES - rate * HEADROOM_SECONDS
	);
	const byteLimitMs = Math.floor(budget / rate) * 1000;

	return byteLimitMs >= RECORDING_MAX_MS
		? { budget, room, limitMs: RECORDING_MAX_MS, limitedBy: 'time', rate }
		: { budget, room, limitMs: byteLimitMs, limitedBy: room, rate };
}

export type RecordingProgress = {
	/** Where the recording is now expected to end, in whole seconds. */
	endsAtMs: number;
	/** What that end is. */
	endsBy: RecordingLimit;
	/** Whether it is near enough to say so. */
	nearEnd: boolean;
	/** Set when the recording should stop now, and why. */
	stop: RecordingLimit | null;
};

/**
 * Where a recording stands, from how long it has run and how many bytes the
 * recorder has handed over. See 30 MINUTES MUST FIT IN 25 MB.
 */
export function recordingProgress(
	plan: RecordingPlan,
	elapsedMs: number,
	bytes: number
): RecordingProgress {
	// The recorder's own figure at first, and what it actually writes once there
	// is enough of it to measure — never less than its own figure, so a quiet
	// start cannot promise more time than the rate it said it would use allows.
	const measured = elapsedMs >= MEASURE_AFTER_MS ? (bytes / elapsedMs) * 1000 : 0;
	const rate = Math.max(plan.rate, measured);
	const bySizeMs =
		Math.floor((elapsedMs + (Math.max(0, plan.budget - bytes) / rate) * 1000) / 1000) * 1000;

	const bySize = bySizeMs < plan.limitMs;
	const endsAtMs = bySize ? bySizeMs : plan.limitMs;
	const endsBy = bySize ? plan.room : plan.limitedBy;

	// By the clock at the planned limit, and by the bytes the moment the budget
	// is spent, whatever the clock says.
	const stop = bytes >= plan.budget ? plan.room : elapsedMs >= plan.limitMs ? plan.limitedBy : null;
	return { endsAtMs, endsBy, nearEnd: endsAtMs - elapsedMs <= WARN_BEFORE_END_MS, stop };
}

/** `m:ss`, or `h:mm:ss` past an hour, as a player shows a time. */
export function formatClock(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const seconds = String(total % 60).padStart(2, '0');
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
		: `${minutes}:${seconds}`;
}

/** What the panel says before recording starts, about how long it can be. */
export function limitNote(plan: RecordingPlan, remaining: number | null): string {
	const length = formatClock(plan.limitMs);
	if (plan.limitedBy === 'time') {
		return `A recording can be up to ${length} long.`;
	}
	if (plan.limitedBy === 'file') {
		return `This recording can be up to ${length} long: one file can be at most ${formatSize(FILE_LIMIT_BYTES)}.`;
	}
	return `This recording can be up to ${length} long: you have ${formatLeft(remaining ?? 0)} of space left.`;
}

/** There is not enough space to be worth starting. */
export function noRoomToRecord(remaining: number): string {
	return `You have ${formatLeft(remaining)} of space left, which isn’t enough for a recording. Remove some photos, video or audio from your entries to make room.`;
}

/** Said a minute before the end: what ends it, and that nothing is lost when it does. */
export function nearEndNote(endsBy: RecordingLimit): string {
	const then = 'Recording will stop by itself then, and keep everything.';
	switch (endsBy) {
		case 'time':
			return `Less than a minute left: a recording can be up to ${formatClock(RECORDING_MAX_MS)}. ${then}`;
		case 'file':
			return `Less than a minute left before this recording reaches the ${formatSize(FILE_LIMIT_BYTES)} one file can be. ${then}`;
		case 'space':
			return `Less than a minute left before your storage space runs out. ${then}`;
	}
}

/** Why a recording stopped by itself, once it has. */
export function stoppedNote(reason: RecordingLimit, elapsedMs: number): string {
	const at = formatClock(elapsedMs);
	switch (reason) {
		case 'time':
			return `Recording stopped by itself at ${at}, the longest a recording can be. Everything up to then is kept.`;
		case 'file':
			return `Recording stopped by itself at ${at}: it had reached the ${formatSize(FILE_LIMIT_BYTES)} one file can be. Everything up to then is kept.`;
		case 'space':
			return `Recording stopped by itself at ${at}: it had used the space you have left. Everything up to then is kept.`;
	}
}

/**
 * What a browser tells somebody who refused the microphone to do about it. By
 * user agent, because this is about where each browser keeps the setting, and
 * no feature test can say that.
 */
function howToAllow(userAgent: string): string {
	if (
		/iPhone|iPad|iPod/.test(userAgent) ||
		(/Macintosh/.test(userAgent) && /Mobile\//.test(userAgent))
	) {
		return 'To allow it, tap the page menu (aA or the icon) in the address bar, choose Website Settings, and set Microphone to Allow. Then choose Record audio again.';
	}
	if (/Firefox\//.test(userAgent)) {
		return 'To allow it, click the crossed-out microphone in the address bar and clear the block, then choose Record audio again.';
	}
	if (/Android/.test(userAgent)) {
		return 'To allow it, tap the icon at the left of the address bar, choose Permissions, and allow Microphone. Then choose Record audio again.';
	}
	if (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent)) {
		return 'To allow it, open Safari’s Settings, choose Websites, then Microphone, and set this site to Allow. Then choose Record audio again.';
	}
	return 'To allow it, click the icon at the left of the address bar, turn on Microphone, then choose Record audio again.';
}

export function describeThrown(thrown: unknown): { name: string; message: string } {
	if (typeof thrown === 'object' && thrown !== null) {
		const { name, message } = thrown as { name?: unknown; message?: unknown };
		return {
			name: typeof name === 'string' ? name : '',
			message: typeof message === 'string' ? message : String(thrown)
		};
	}
	return { name: '', message: String(thrown) };
}

/** What went wrong asking for the microphone, and what to do about it. */
export function microphoneMessage(thrown: unknown, userAgent: string): string {
	// Read off the object rather than by `instanceof`: a `DOMException` is not an
	// `Error` in every engine.
	const { name, message } = describeThrown(thrown);
	const detail = message;

	switch (name) {
		case 'NotAllowedError':
		case 'PermissionDeniedError':
		case 'SecurityError':
			// Chromium says "by system" when the operating system refused, not the
			// person: the browser's own setting is already Allow.
			if (/system/i.test(detail)) {
				return 'Your computer’s privacy settings don’t let this browser use the microphone. Allow it there (Windows: Settings › Privacy › Microphone; Mac: System Settings › Privacy & Security › Microphone), then choose Record audio again.';
			}
			return `Noteworthy isn’t allowed to use the microphone. ${howToAllow(userAgent)}`;
		case 'NotFoundError':
		case 'DevicesNotFoundError':
		case 'OverconstrainedError':
			return 'No microphone was found. Connect one, then choose Record audio again.';
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return 'The microphone couldn’t be started. Another app may be using it: close that app, then choose Record audio again.';
		default:
			return `The microphone couldn’t be started (${name.length > 0 ? `${name}: ` : ''}${detail}).`;
	}
}

/** The recorder itself failed partway. */
export function recorderFailedMessage(detail: string): string {
	return `Recording stopped because the browser’s recorder failed (${detail}). Anything recorded before that is kept.`;
}

/** Stopped before the recorder had handed over any sound. */
export const NOTHING_RECORDED =
	'Nothing was recorded: it was stopped before any sound reached the recorder. Choose Record audio to try again.';

/** Asked before leaving with a recording running or not yet added. */
export const RECORDING_NOT_ADDED =
	'A recording hasn’t been added to this entry yet. Leaving now would lose it. Leave anyway?';

/** A recording's file name, which is what its placeholder shows: `Recording 2026-09-24 14.03.m4a`. */
export function recordingName(at: Date, type: AcceptedType): string {
	const pad = (value: number): string => String(value).padStart(2, '0');
	const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
	return `Recording ${day} ${pad(at.getHours())}.${pad(at.getMinutes())}.${ACCEPTED_TYPES[type].extension}`;
}

/**
 * How loud a slice of samples is, from 0 to 1, for the level meter: its RMS in
 * decibels, from −60 dB (silence, as far as a meter is concerned) to 0.
 */
export function levelOf(samples: Float32Array): number {
	if (samples.length === 0) {
		return 0;
	}
	let sum = 0;
	for (const sample of samples) {
		sum += sample * sample;
	}
	const rms = Math.sqrt(sum / samples.length);
	if (rms <= 0) {
		return 0;
	}
	const decibels = 20 * Math.log10(rms);
	return Math.min(1, Math.max(0, (decibels + 60) / 60));
}
