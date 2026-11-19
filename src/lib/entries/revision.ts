/**
 * The revision a save is made from, on both sides of the request.
 *
 * The server half reads what a page sent (`readSaveCheck`, `readCreateAttempt`)
 * into what `saveEntry` and `createEntryOnce` in `$lib/data/entries` take. The
 * page half (`createSaveTracker`) is what a page holds between saves: the
 * revision its text was made from, and its saves that were never answered.
 * `$lib/data/entries`, SAVES, has why both exist.
 */
import { isUuid } from '$lib/data/ids';

/**
 * How many unanswered saves a page sends with each save, at most.
 *
 * A page adds one only when a save fails, and clears them all on the next
 * success, so reaching this means that many failed saves in a row. The oldest
 * is dropped first: it is the least likely to be the row's last save.
 */
export const MAX_UNANSWERED = 64;

export type SentCheck = {
	expected: number;
	saveId: string;
	unanswered: string[];
};

function idList(value: unknown): string[] | null {
	if (value === undefined) {
		return [];
	}
	if (
		!Array.isArray(value) ||
		value.length > MAX_UNANSWERED ||
		!value.every((id) => typeof id === 'string' && isUuid(id))
	) {
		return null;
	}
	return value as string[];
}

/** A save's check as the page sent it, or `null` if it is not one. */
export function readSaveCheck(sent: {
	revision?: unknown;
	saveId?: unknown;
	unanswered?: unknown;
}): SentCheck | null {
	const unanswered = idList(sent.unanswered);
	if (
		typeof sent.revision !== 'number' ||
		!Number.isSafeInteger(sent.revision) ||
		sent.revision < 1 ||
		typeof sent.saveId !== 'string' ||
		!isUuid(sent.saveId) ||
		unanswered === null
	) {
		return null;
	}
	return { expected: sent.revision, saveId: sent.saveId, unanswered };
}

/** A create's id and its page's earlier attempts, or `null` if it is not one. */
export function readCreateAttempt(sent: {
	saveId?: unknown;
	unanswered?: unknown;
}): { saveId: string; earlier: string[] } | null {
	const earlier = idList(sent.unanswered);
	if (typeof sent.saveId !== 'string' || !isUuid(sent.saveId) || earlier === null) {
		return null;
	}
	return { saveId: sent.saveId, earlier };
}

/**
 * A version 4 uuid. `crypto.randomUUID()` exists only on HTTPS and localhost,
 * and a phone testing a dev server over the LAN is neither (the new-entry
 * page's load says the same); `getRandomValues` is there everywhere.
 */
export function newSaveId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type SaveTracker = {
	/** The revision the page's text was made from; `null` before a new entry exists. */
	readonly revision: number | null;
	/** What the next save sends, under a fresh id. */
	next: () => { saveId: string; unanswered: string[] };
	/** The save `saveId` was applied, and the entry is now at `revision`. */
	saved: (revision: number) => void;
	/** The save `saveId` did not come back as applied. It may still have been. */
	unanswered: (saveId: string) => void;
	/**
	 * Whether the row's last save, `saveId`, may be this page's own: the save on
	 * its way now, or one never answered. A row written by one of those holds
	 * text this page sent, so a revision past the page's is no conflict.
	 */
	isOwn: (saveId: string | null) => boolean;
	/**
	 * The page's text is now made from `revision`, whatever came before: a
	 * choice in the conflict modal. Its unanswered saves are forgotten, since
	 * none of them can be applied on top of a revision they did not make.
	 */
	adopt: (revision: number) => void;
};

/**
 * Whether a write heard of from elsewhere (a broadcast, or the focus read) at
 * `revision`, by `saveId`, changed the entry after the text this page holds:
 * not when the page has no revision yet, already holds that revision or a
 * newer one, or made that write itself.
 */
export function changedElsewhere(
	tracker: Pick<SaveTracker, 'revision' | 'isOwn'>,
	revision: number,
	saveId: string | null
): boolean {
	return tracker.revision !== null && revision > tracker.revision && !tracker.isOwn(saveId);
}

/**
 * What a page holds between saves. One save at a time is the autosave
 * controller's rule, so `next` and the answer to it never interleave with
 * another save's.
 */
export function createSaveTracker(loaded: number | null): SaveTracker {
	let revision = loaded;
	let pending: string[] = [];
	/** The save on its way, between `next` and its answer. */
	let sending: string | null = null;

	return {
		get revision() {
			return revision;
		},
		next: () => {
			sending = newSaveId();
			return { saveId: sending, unanswered: [...pending] };
		},
		saved: (now) => {
			revision = now;
			sending = null;
			// Any earlier save still on its way is refused when it lands: its own
			// list cannot name this one, and its revision is older.
			pending = [];
		},
		unanswered: (saveId) => {
			if (sending === saveId) {
				sending = null;
			}
			pending = [...pending, saveId].slice(-MAX_UNANSWERED);
		},
		isOwn: (saveId) => saveId !== null && (saveId === sending || pending.includes(saveId)),
		adopt: (now) => {
			revision = now;
			pending = [];
		}
	};
}
