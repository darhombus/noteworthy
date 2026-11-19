/**
 * Giving a recorded WebM the length its recorder never wrote down.
 *
 * Pure, and works on bytes, so it is pinned in Node against real recorders'
 * output (`tests/fixtures/recorded-*.webm`).
 *
 * ---------------------------------------------------------------------------
 * WHY A RECORDING HAS NO LENGTH
 * ---------------------------------------------------------------------------
 * `MediaRecorder` writes WebM as it goes, so it cannot know the length when it
 * writes the header, and neither engine goes back to fill it in:
 *
 *   Chromium 153 writes an Info with no Duration at all.
 *   Firefox 155 writes a Duration of 0, as a placeholder it never replaces.
 *
 * Both leave the Segment and every Cluster of unknown size, and write no Cues.
 * A player then reports the length as `Infinity`: Chromium's shows no length and
 * a timeline that cannot be dragged, and Firefox's cannot seek at all, even in a
 * file it holds whole in memory. Checked in both, on the files these fixtures
 * were made from.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS CHANGED, AND WHAT IS LEFT ALONE
 * ---------------------------------------------------------------------------
 * The length comes from the file itself: the timestamp of its last block, plus
 * the gap before it as that block's own length. A clock kept while recording
 * would be close, but not the file's own answer.
 *
 * A Duration of 0 or less, or one that is not a number, is overwritten where it
 * stands, so nothing moves. A missing one is inserted at the start of Info,
 * which moves everything after it along by eleven bytes or so. That is safe
 * only because nothing in these files points at a byte position: an index that
 * did — a SeekHead with entries in it, or Cues — would point at the wrong
 * place afterwards. So a file carrying either is left exactly as it arrived; a
 * muxer that writes an index writes a Duration too, and such a file is not one
 * this is for. The same goes for anything that does not parse as WebM: nothing
 * here throws, and nothing it does not understand is touched.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const SEEK_HEAD = 0x114d9b74;
const INFO = 0x1549a966;
const TIMECODE_SCALE = 0x2ad7b1;
const DURATION = 0x4489;
const TRACKS = 0x1654ae6b;
const CLUSTER = 0x1f43b675;
const CUES = 0x1c53bb6b;
const CHAPTERS = 0x1043a770;
const TAGS = 0x1254c367;
const ATTACHMENTS = 0x1941a469;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;

/** The Segment's own children. Inside a Cluster of unknown size, one of these ends it. */
const TOP_LEVEL = new Set([SEEK_HEAD, INFO, TRACKS, CLUSTER, CUES, CHAPTERS, TAGS, ATTACHMENTS]);

/** Matroska's default: timestamps in milliseconds. */
const DEFAULT_SCALE = 1_000_000;

type Header = {
	id: number;
	/** Where the element starts, its ID's first byte. */
	start: number;
	/** Where its size field starts, and how many bytes that field takes. */
	sizeAt: number;
	sizeLength: number;
	/** `null` for an element of unknown size. */
	size: number | null;
	/** Where its data starts. */
	data: number;
};

function readId(bytes: Uint8Array, at: number): { id: number; length: number } | null {
	const first = bytes[at];
	if (first === undefined || first === 0) {
		return null;
	}
	const length = Math.clz32(first) - 23;
	if (length > 4 || at + length > bytes.length) {
		return null;
	}
	let id = 0;
	for (let index = 0; index < length; index += 1) {
		id = id * 256 + bytes[at + index];
	}
	return { id, length };
}

function readSize(bytes: Uint8Array, at: number): { size: number | null; length: number } | null {
	const first = bytes[at];
	if (first === undefined || first === 0) {
		return null;
	}
	const length = Math.clz32(first) - 23;
	if (at + length > bytes.length) {
		return null;
	}
	let value = first & (0xff >> length);
	let allOnes = value === 0xff >> length;
	for (let index = 1; index < length; index += 1) {
		const byte = bytes[at + index];
		value = value * 256 + byte;
		allOnes &&= byte === 0xff;
	}
	return { size: allOnes ? null : value, length };
}

function readHeader(bytes: Uint8Array, at: number): Header | null {
	const id = readId(bytes, at);
	if (id === null) {
		return null;
	}
	const size = readSize(bytes, at + id.length);
	if (size === null) {
		return null;
	}
	return {
		id: id.id,
		start: at,
		sizeAt: at + id.length,
		sizeLength: size.length,
		size: size.size,
		data: at + id.length + size.length
	};
}

/** An unsigned integer of at most eight bytes, or `null` for a field that cannot be one. */
function readUint(bytes: Uint8Array, at: number, length: number): number | null {
	if (length < 1 || length > 8 || at + length > bytes.length) {
		return null;
	}
	let value = 0;
	for (let index = 0; index < length; index += 1) {
		value = value * 256 + bytes[at + index];
	}
	return value;
}

function readFloat(bytes: Uint8Array, at: number, length: number): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset + at, length);
	return length === 4 ? view.getFloat32(0) : length === 8 ? view.getFloat64(0) : Number.NaN;
}

/** The `size` in an EBML size field `length` bytes long; `null` if it does not fit. */
function encodeSize(size: number, length: number): Uint8Array | null {
	// All ones means "unknown", so the largest value a field can hold is one less.
	if (length < 1 || length > 8 || size >= 2 ** (7 * length) - 1) {
		return null;
	}
	const out = new Uint8Array(length);
	let rest = size;
	for (let index = length - 1; index >= 0; index -= 1) {
		out[index] = rest % 256;
		rest = Math.floor(rest / 256);
	}
	out[0] |= 0x80 >> (length - 1);
	return out;
}

export type WebmFacts = {
	segment: Header;
	info: Header;
	/** Nanoseconds per timestamp unit. */
	scale: number;
	/** The Duration element, if Info has one, and what it holds. */
	duration: { header: Header; value: number } | null;
	/** A SeekHead with entries, or Cues: something that points at byte positions. */
	indexed: boolean;
	/** How many blocks the clusters hold. */
	blocks: number;
	/** The last block's timestamp and the one before it, in timestamp units. */
	last: number | null;
	previous: number | null;
};

/** Reads a WebM's structure, or `null` if these bytes are not one this understands. */
export function readWebm(bytes: Uint8Array): WebmFacts | null {
	const ebml = readHeader(bytes, 0);
	if (
		ebml === null ||
		ebml.id !== EBML ||
		ebml.size === null ||
		ebml.data + ebml.size > bytes.length
	) {
		return null;
	}
	const segment = readHeader(bytes, ebml.data + ebml.size);
	if (segment === null || segment.id !== SEGMENT) {
		return null;
	}
	// A Segment that says it is longer than the file is a file cut short.
	if (segment.size !== null && segment.data + segment.size > bytes.length) {
		return null;
	}
	const segmentEnd = segment.size === null ? bytes.length : segment.data + segment.size;

	/** Whether an element of known size ends within `limit`. Anything else is not understood. */
	const fits = (element: Header, limit: number): boolean =>
		element.size !== null && element.data + element.size <= limit;

	let info: Header | null = null;
	let scale = DEFAULT_SCALE;
	let duration: WebmFacts['duration'] = null;
	let indexed = false;
	let blocks = 0;
	let last: number | null = null;
	let previous: number | null = null;

	const block = (clusterTime: number, at: number, end: number): boolean => {
		// A block starts with its track number (a size-style integer), then a
		// signed 16-bit timestamp relative to its cluster's.
		const track = readSize(bytes, at);
		if (track === null || at + track.length + 2 > end) {
			return false;
		}
		const view = new DataView(bytes.buffer, bytes.byteOffset + at + track.length, 2);
		const time = clusterTime + view.getInt16(0);
		blocks += 1;
		if (last === null || time >= last) {
			previous = last;
			last = time;
		}
		return true;
	};

	let at = segment.data;
	while (at < segmentEnd) {
		const element = readHeader(bytes, at);
		if (element === null) {
			return null;
		}

		if (element.id === CLUSTER) {
			// Children until the cluster's end — or, when its size is unknown, until
			// the next top-level element or the end of the file.
			if (element.size !== null && !fits(element, segmentEnd)) {
				return null;
			}
			const end = element.size === null ? segmentEnd : element.data + element.size;
			let time = 0;
			let child = element.data;
			while (child < end) {
				const inner = readHeader(bytes, child);
				if (inner === null) {
					return null;
				}
				if (element.size === null && TOP_LEVEL.has(inner.id)) {
					break;
				}
				// A block that runs past the end is a file cut off mid-block.
				if (!fits(inner, end)) {
					return null;
				}
				const innerEnd = inner.data + (inner.size as number);
				if (inner.id === TIMECODE) {
					const read = readUint(bytes, inner.data, inner.size as number);
					if (read === null) {
						return null;
					}
					time = read;
				} else if (inner.id === SIMPLE_BLOCK) {
					if (!block(time, inner.data, innerEnd)) {
						return null;
					}
				} else if (inner.id === BLOCK_GROUP) {
					let part = inner.data;
					while (part < innerEnd) {
						const piece = readHeader(bytes, part);
						if (piece === null || !fits(piece, innerEnd)) {
							return null;
						}
						if (
							piece.id === BLOCK &&
							!block(time, piece.data, piece.data + (piece.size as number))
						) {
							return null;
						}
						part = piece.data + (piece.size as number);
					}
				}
				child = innerEnd;
			}
			at = child;
			continue;
		}

		// Only a cluster may be of unknown size; anything else cannot be walked
		// past. And nothing may run past the Segment's end.
		if (element.size === null || !fits(element, segmentEnd)) {
			return null;
		}

		if (element.id === INFO) {
			info = element;
			let child = element.data;
			while (child < element.data + element.size) {
				const inner = readHeader(bytes, child);
				if (inner === null || !fits(inner, element.data + element.size)) {
					return null;
				}
				if (inner.size === null) {
					return null;
				}
				if (inner.id === TIMECODE_SCALE) {
					const read = readUint(bytes, inner.data, inner.size);
					if (read === null) {
						return null;
					}
					scale = read || DEFAULT_SCALE;
				} else if (inner.id === DURATION) {
					duration = { header: inner, value: readFloat(bytes, inner.data, inner.size) };
				}
				child = inner.data + inner.size;
			}
		} else if (element.id === CUES || (element.id === SEEK_HEAD && element.size > 0)) {
			indexed = true;
		}
		at = element.data + element.size;
	}

	if (info === null) {
		return null;
	}
	return { segment, info, scale, duration, indexed, blocks, last, previous };
}

/** The length a WebM's own blocks add up to, in milliseconds, or `null` for none. */
export function measuredMs(facts: WebmFacts): number | null {
	if (facts.last === null) {
		return null;
	}
	const own = facts.previous === null ? 0 : Math.max(0, facts.last - facts.previous);
	return ((facts.last + own) * facts.scale) / 1_000_000;
}

function float64(value: number): Uint8Array {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setFloat64(0, value);
	return out;
}

/**
 * `bytes` with a Duration that says how long they are, or `null` if they are
 * better left as they are: they already have one, they are not WebM, they hold
 * no blocks, or they carry an index that moving bytes would break. See WHAT IS
 * CHANGED above.
 */
export function withDuration(bytes: Uint8Array): Uint8Array<ArrayBuffer> | null {
	const facts = readWebm(bytes);
	if (facts === null) {
		return null;
	}
	if (
		facts.duration !== null &&
		Number.isFinite(facts.duration.value) &&
		facts.duration.value > 0
	) {
		return null;
	}
	const ms = measuredMs(facts);
	if (ms === null || ms <= 0) {
		return null;
	}
	// In the file's own timestamp units.
	const units = (ms * 1_000_000) / facts.scale;

	const existing = facts.duration;
	if (existing !== null && (existing.header.size === 4 || existing.header.size === 8)) {
		const out = bytes.slice();
		const view = new DataView(out.buffer, existing.header.data, existing.header.size);
		if (existing.header.size === 4) {
			view.setFloat32(0, units);
		} else {
			view.setFloat64(0, units);
		}
		return out;
	}
	if (existing !== null || facts.indexed) {
		return null;
	}

	// Duration, eight bytes of float: ID 0x4489, size 0x88.
	const element = new Uint8Array([0x44, 0x89, 0x88, ...float64(units)]);
	const info = facts.info;
	const infoSize = (info.size ?? 0) + element.length;
	// The same width of size field if the new size fits in it, and wider if not.
	let infoField: Uint8Array | null = null;
	for (let length = info.sizeLength; length <= 8 && infoField === null; length += 1) {
		infoField = encodeSize(infoSize, length);
	}
	if (infoField === null) {
		return null;
	}
	const grown = element.length + infoField.length - info.sizeLength;

	let segmentField: Uint8Array | null = null;
	if (facts.segment.size !== null) {
		segmentField = encodeSize(facts.segment.size + grown, facts.segment.sizeLength);
		if (segmentField === null) {
			return null;
		}
	}

	const out = new Uint8Array(bytes.length + grown);
	out.set(bytes.subarray(0, info.sizeAt), 0);
	out.set(infoField, info.sizeAt);
	out.set(element, info.sizeAt + infoField.length);
	out.set(bytes.subarray(info.data), info.sizeAt + infoField.length + element.length);
	if (segmentField !== null) {
		out.set(segmentField, facts.segment.sizeAt);
	}
	return out;
}
