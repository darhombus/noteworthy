/**
 * A photo, made ready to store: upright, no larger than 2048px on its long
 * side, no metadata, and 2 MB or less. Browser only — it decodes and draws.
 *
 * ---------------------------------------------------------------------------
 * ORIENTATION: ESTABLISHED, NOT ASSUMED
 * ---------------------------------------------------------------------------
 * A phone stores most photos sideways and records which way up they go in an
 * EXIF tag. Drawing the pixels as stored would put every portrait photo on its
 * side, and dropping the metadata (below) drops the tag that could have fixed
 * it afterwards. So orientation is applied while decoding, by
 * `createImageBitmap(file, { imageOrientation: 'from-image' })`.
 *
 * Checked against a JPEG with an EXIF orientation of 6 (stored landscape,
 * displayed portrait) in Chromium 153, Firefox 155 and WebKit 26.6, through
 * Playwright on Windows. All three return the bitmap upright, with width and
 * height swapped, and all three do the same with no options and with the
 * deprecated `'none'`, which the current spec treats as `'from-image'`. An
 * `<img>` drawn to a canvas comes out upright in all three too, which is what
 * the fallback below relies on for a browser with no `createImageBitmap`.
 * `e2e/entry-photos.e2e.ts` uploads that rotated file and checks the stored
 * copy's pixels, in all three engines.
 *
 * ---------------------------------------------------------------------------
 * METADATA
 * ---------------------------------------------------------------------------
 * Phone photos carry GPS coordinates, the device, the time. Nothing of the
 * original file is kept: the pixels are drawn to a canvas and the canvas is
 * encoded afresh, and a canvas has no metadata to write. All three engines
 * produce a file with no EXIF segment at all; the e2e test above searches the
 * stored bytes for the GPS tag and the camera name the fixture carries.
 *
 * ---------------------------------------------------------------------------
 * WEBP, OR JPEG WHERE THE BROWSER CANNOT WRITE WEBP
 * ---------------------------------------------------------------------------
 * WebP is smaller than JPEG at the same quality — worth having against a 70 MB
 * allowance and 5 GB of monthly bandwidth — and keeps transparency. Chrome and
 * Firefox encode it. Safari, on macOS and iOS alike, does not: asked for WebP,
 * `toBlob` quietly hands back a PNG instead, as the spec allows, and caniuse
 * lists no Safari version with WebP encoding. (Playwright's WebKit on Windows
 * *does* encode WebP, because it is built with its own image libraries, so it
 * is no evidence either way about Apple's.) Every supported browser encodes
 * JPEG, and every one decodes WebP.
 *
 * So the format is whatever the browser proves it can write: a one-pixel WebP
 * is asked for once, and if what comes back is not WebP, every photo from that
 * browser is JPEG. Both are types the bucket accepts. A JPEG is drawn over
 * white, because it has no transparency and would otherwise turn it black.
 *
 * A PNG is tried as PNG first. Screenshots are the usual PNG, they are mostly
 * flat colour, which PNG stores small and exactly, and lossy compression smears
 * the text in them. A PNG that comes out over 2 MB — a photo saved as PNG —
 * goes the same way as everything else.
 */
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE } from './limits';
import { fitWithin, gifDimensions } from './intake';
import { unreadableMessage, unshrinkableMessage } from './messages';

export type PreparedImage = {
	blob: Blob;
	type: 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif';
	width: number;
	height: number;
};

/** Thrown with a message fit to show the person, and not worth retrying. */
export class ImageRefused extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageRefused';
	}
}

/** Qualities tried in turn until the photo fits in 2 MB. */
const QUALITIES = [0.82, 0.72, 0.6, 0.45];

/** And, if none does, the size is cut to this fraction and the qualities tried again. */
const SHRINK = 0.75;
const MAX_SHRINKS = 3;

let lossyType: Promise<'image/webp' | 'image/jpeg'> | null = null;

/** WebP if this browser can write it, JPEG if not. Asked once per page. */
export function lossyOutputType(): Promise<'image/webp' | 'image/jpeg'> {
	lossyType ??= (async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 1;
		canvas.height = 1;
		const blob = await toBlob(canvas, 'image/webp', 0.8);
		return blob?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
	})();
	return lossyType;
}

/**
 * Forgets what this browser answered, so it can be asked again.
 *
 * For the test that pretends to be Safari — the browser the fallback exists for
 * and the one this project cannot run.
 */
export function forgetOutputType(): void {
	lossyType = null;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

function sizeOf(source: Drawable): { width: number; height: number } {
	if (source instanceof HTMLImageElement) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	return { width: source.width, height: source.height };
}

async function decodeWithElement(file: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(file);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return image;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** The file's pixels, upright. See ORIENTATION above. */
async function decode(file: File, heic: boolean): Promise<Drawable> {
	if (typeof createImageBitmap === 'function') {
		try {
			return await createImageBitmap(file, { imageOrientation: 'from-image' });
		} catch {
			// Fall through to the element, which some decoders accept when the
			// bitmap path does not. A file neither can read is refused below.
		}
	}
	try {
		return await decodeWithElement(file);
	} catch {
		throw new ImageRefused(unreadableMessage(file.name, heic));
	}
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

/**
 * `source` drawn at `width` × `height`.
 *
 * Halved step by step while it is more than twice the target, then drawn at
 * the target. One large reduction in a single `drawImage` samples too few of
 * the source's pixels and leaves a 12-megapixel photo looking jagged at 2048px,
 * in Firefox especially, which ignores `imageSmoothingQuality`. Each step's
 * canvas is also a quarter of the last, which keeps the largest one well under
 * the canvas area older iPhones will allocate.
 */
function drawAt(
	source: Drawable,
	width: number,
	height: number,
	background: string | null
): HTMLCanvasElement {
	let current: Drawable = source;
	let size = sizeOf(source);

	while (size.width / 2 >= width && size.height / 2 >= height) {
		const half = canvasOf(Math.round(size.width / 2), Math.round(size.height / 2));
		const context = half.getContext('2d');
		if (context === null) {
			break;
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage(current, 0, 0, half.width, half.height);
		if (current instanceof HTMLCanvasElement) {
			current.width = 0;
		}
		current = half;
		size = { width: half.width, height: half.height };
	}

	const target = canvasOf(width, height);
	const context = target.getContext('2d');
	if (context === null) {
		throw new ImageRefused('This photo is too large for this browser to open.');
	}
	if (background !== null) {
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);
	}
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(current, 0, 0, width, height);
	if (current instanceof HTMLCanvasElement && current !== target) {
		current.width = 0;
	}
	return target;
}

async function prepareGif(file: File): Promise<PreparedImage> {
	const size = gifDimensions(new Uint8Array(await file.slice(0, 10).arrayBuffer()));
	if (size === null) {
		throw new ImageRefused(unreadableMessage(file.name, false));
	}
	// The file itself, retyped: `canonicalType` already decided it is a GIF, and
	// the upload has to carry exactly the type the bucket lists.
	return { blob: new Blob([file], { type: 'image/gif' }), type: 'image/gif', ...size };
}

/**
 * The copy of `file` to store. `asIs` and `heic` come from `intake`.
 *
 * Throws `ImageRefused` with a message for the person when the file cannot be
 * decoded, or cannot be brought under 2 MB at any size tried.
 */
export async function prepareImage(
	file: File,
	options: { asIs: boolean; heic: boolean }
): Promise<PreparedImage> {
	if (options.asIs) {
		return prepareGif(file);
	}

	const source = await decode(file, options.heic);
	const original = sizeOf(source);
	if (original.width === 0 || original.height === 0) {
		throw new ImageRefused(unreadableMessage(file.name, options.heic));
	}

	try {
		let { width, height } = fitWithin(original.width, original.height, IMAGE_MAX_EDGE);
		const lossy = await lossyOutputType();
		const png = file.type === 'image/png';
		let smallest = Number.POSITIVE_INFINITY;

		for (let shrink = 0; shrink <= MAX_SHRINKS; shrink += 1) {
			if (png) {
				const canvas = drawAt(source, width, height, null);
				const blob = await toBlob(canvas, 'image/png');
				canvas.width = 0;
				if (blob !== null && blob.type === 'image/png' && blob.size <= IMAGE_MAX_BYTES) {
					return { blob, type: 'image/png', width, height };
				}
			}

			const canvas = drawAt(source, width, height, lossy === 'image/jpeg' ? '#ffffff' : null);
			try {
				for (const quality of QUALITIES) {
					const blob = await toBlob(canvas, lossy, quality);
					if (blob === null || blob.type !== lossy) {
						throw new ImageRefused('This photo is too large for this browser to open.');
					}
					if (blob.size <= IMAGE_MAX_BYTES) {
						return { blob, type: lossy, width, height };
					}
					smallest = Math.min(smallest, blob.size);
				}
			} finally {
				canvas.width = 0;
			}

			({ width, height } = fitWithin(width, height, Math.floor(Math.max(width, height) * SHRINK)));
		}

		throw new ImageRefused(unshrinkableMessage(smallest));
	} finally {
		if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
			source.close();
		}
	}
}
