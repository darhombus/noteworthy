/**
 * "This entry was just saved", between the tabs of one browser.
 *
 * A tab that saves an entry posts its id and new revision on a
 * `BroadcastChannel`; an edit page open on that entry in another tab hears it
 * at once and shows the conflict modal before anything is typed there
 * (`./conflict.svelte`). Rename on a journal's page posts too.
 *
 * `BroadcastChannel` reaches every other page of the same browser profile on
 * this origin, and nothing else: not another browser, not another device
 * (those are found on focus, by the conflict module's read). Measured in
 * Chromium, Firefox and WebKit: a post is not delivered to the channel object
 * that sent it, but IS delivered to any other object on the same channel in
 * the same page. So every post names the document it came from (`TAB`), and a
 * page ignores its own whatever object heard it.
 */
import { newSaveId } from './revision';

const CHANNEL = 'noteworthy:entry-saved';

/** This document. Fresh on every load, so a reloaded tab is a new one. */
const TAB = newSaveId();

export type EntrySaved = {
	entryId: string;
	revision: number;
	/** The save that wrote it, or `null` for a write made without one (rename). */
	saveId: string | null;
};

type Message = EntrySaved & { tab: string };

function channel(): BroadcastChannel | null {
	return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
}

/** One for the document's life, so nothing posted is lost to a close. */
let posting: BroadcastChannel | null = null;

/** Tells the other tabs. Does nothing where there is no `BroadcastChannel`. */
export function postSaved(saved: EntrySaved): void {
	posting ??= channel();
	posting?.postMessage({ ...saved, tab: TAB } satisfies Message);
}

function isMessage(data: unknown): data is Message {
	if (typeof data !== 'object' || data === null) {
		return false;
	}
	const message = data as Record<string, unknown>;
	return (
		typeof message.tab === 'string' &&
		typeof message.entryId === 'string' &&
		typeof message.revision === 'number' &&
		(typeof message.saveId === 'string' || message.saveId === null)
	);
}

/** Hears other tabs' saves of `entryId`. Returns the way to stop. */
export function onSaved(entryId: string, listener: (saved: EntrySaved) => void): () => void {
	const listening = channel();
	if (listening === null) {
		return () => {};
	}
	listening.onmessage = (event: MessageEvent<unknown>) => {
		const data = event.data;
		if (isMessage(data) && data.tab !== TAB && data.entryId === entryId) {
			listener({ entryId: data.entryId, revision: data.revision, saveId: data.saveId });
		}
	};
	return () => listening.close();
}
