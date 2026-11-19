/**
 * A file made ready to store, whatever kind it is. Browser only.
 *
 * Photos are re-encoded (`image.ts`). Video and audio are stored exactly as
 * they arrived: compressing video in a browser is too heavy to be worth it for
 * short clips, and there is nothing in an audio file to strip that anybody
 * asked for. What they get here is the type `intake` settled on, put on the
 * Blob itself — supabase-js sends the Blob's own type, and Storage matches it
 * literally (`types.ts`) — and, for a video, the size of its picture.
 *
 * ---------------------------------------------------------------------------
 * A VIDEO'S SIZE
 * ---------------------------------------------------------------------------
 * The node carries `width` and `height` for the same reason a photo's does: so
 * the page can hold the video's space before it loads, and the text under it
 * does not jump. They are read from the file's own metadata by a `<video>`
 * element, which is the only video parser a browser has. A browser that cannot
 * play the file cannot read its size either — an iPhone's HEVC `.mov` in a
 * browser without HEVC — and that is no reason to refuse it: another device
 * may play it perfectly well. It goes up without a size, and reserves no space.
 *
 * ---------------------------------------------------------------------------
 * A "VIDEO" WITH NO PICTURE IS AUDIO
 * ---------------------------------------------------------------------------
 * A voice memo saved as `.webm` or `.mp4` — Chrome's own recorder makes the
 * first — arrives as `video/webm` or `video/mp4`, because browsers name a file
 * by its extension. Added through *Photo or video*, dropped or pasted, it would
 * be stored as a video, and a `<video>` with nothing to show draws a video-sized
 * black box behind its controls (Chromium 150px, Firefox 343px at the column's
 * width). The same metadata read that finds a video's size says so: a picture
 * 0 by 0. Such a file is stored as audio, under the audio twin of its type
 * (`AS_AUDIO`). A QuickTime file has no audio twin among the accepted types and
 * stays a video; how a video node with no picture is drawn is
 * `$lib/media/player`'s `fitSoundOnlyVideo`.
 *
 * ---------------------------------------------------------------------------
 * A WEBM WITH NO LENGTH
 * ---------------------------------------------------------------------------
 * The one change made to a video or audio file: a WebM that a `MediaRecorder`
 * wrote — Chrome's own voice recorder, a screen recorder, this app's recorder
 * where it falls back to WebM — says nothing about how long it is, and players
 * then show no length and cannot seek (Firefox not at all). Its length is
 * worked out from its own blocks and written into its header (`webm.ts`). Any
 * WebM that already has a length, which is every one a real muxer wrote, is
 * stored byte for byte as it arrived.
 */
import { MAX_DIMENSION } from '$lib/entries/document';
import { prepareImage } from './image';
import { AS_AUDIO, type Intake } from './intake';
import type { AcceptedType, MediaKind } from './types';
import { withDuration } from './webm';

export type PreparedMedia = {
	blob: Blob;
	type: AcceptedType;
	kind: MediaKind;
	/** The picture's pixel size: a photo's always, a video's when it could be read, audio's never. */
	width: number | null;
	height: number | null;
};

type Accepted = Extract<Intake, { ok: true }>;

/** How long a video's metadata gets to arrive before it goes up without a size. */
const METADATA_WAIT_MS = 5000;

function dimension(value: number): number | null {
	return Number.isInteger(value) && value >= 1 && value <= MAX_DIMENSION ? value : null;
}

export type VideoPicture =
	| { picture: true; width: number | null; height: number | null }
	/** Metadata read, and there is no picture: see A "VIDEO" WITH NO PICTURE IS AUDIO. */
	| { picture: false };

/**
 * What a video file's metadata says about its picture, or `null` if this
 * browser cannot read it. See A VIDEO'S SIZE.
 */
export async function readVideo(
	file: Blob,
	waitMs = METADATA_WAIT_MS
): Promise<VideoPicture | null> {
	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.muted = true;
	video.preload = 'metadata';
	try {
		const loaded = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), waitMs);
			video.addEventListener(
				'loadedmetadata',
				() => {
					clearTimeout(timer);
					resolve(true);
				},
				{ once: true }
			);
			video.addEventListener(
				'error',
				() => {
					clearTimeout(timer);
					resolve(false);
				},
				{ once: true }
			);
			video.src = url;
		});
		if (!loaded) {
			return null;
		}
		if (video.videoWidth === 0 && video.videoHeight === 0) {
			return { picture: false };
		}
		const width = dimension(video.videoWidth);
		const height = dimension(video.videoHeight);
		return width === null || height === null
			? { picture: true, width: null, height: null }
			: { picture: true, width, height };
	} finally {
		// Let go of the decoder as well as the URL.
		video.removeAttribute('src');
		video.load();
		URL.revokeObjectURL(url);
	}
}

/** `file`'s bytes, with a length written in if it is a WebM without one. See A WEBM WITH NO LENGTH. */
async function withLength(file: Blob, type: AcceptedType): Promise<BlobPart> {
	if (type !== 'video/webm' && type !== 'audio/webm') {
		return file;
	}
	// A file the repair does not understand goes up exactly as it came. `webm.ts`
	// does not throw on any input the tests could find; this is so that a bug
	// there could only ever cost a file its length, never its upload.
	try {
		return withDuration(new Uint8Array(await file.arrayBuffer())) ?? file;
	} catch {
		return file;
	}
}

/** The copy of `file` to store, as `intake` described it. */
export async function prepareMedia(file: File, accepted: Accepted): Promise<PreparedMedia> {
	if (accepted.kind === 'image') {
		const image = await prepareImage(file, { asIs: accepted.asIs, heic: accepted.heic });
		return { ...image, kind: 'image' };
	}

	// Video and audio always come with the type they are stored as.
	const given = accepted.type as AcceptedType;
	const read = accepted.kind === 'video' ? await readVideo(file) : null;
	const twin = read?.picture === false ? AS_AUDIO[given] : undefined;
	if (twin !== undefined) {
		return {
			blob: new Blob([await withLength(file, twin)], { type: twin }),
			type: twin,
			kind: 'audio',
			width: null,
			height: null
		};
	}
	return {
		blob: new Blob([await withLength(file, given)], { type: given }),
		type: given,
		kind: accepted.kind,
		width: read?.picture === true ? read.width : null,
		height: read?.picture === true ? read.height : null
	};
}
