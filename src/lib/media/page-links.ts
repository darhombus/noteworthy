/**
 * A page's `MediaLinks`, wired to the server and to the page's lifetime.
 *
 * Kept apart from `links.ts` so that module stays free of SvelteKit and can be
 * driven in Node with a fake signer, fake timers and a fake visibility source.
 */
import { getContext, onMount, setContext } from 'svelte';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { deviceClock } from './clock';
import { LinkMemory, MediaLinks } from './links';
import type { SignedMedia } from './signed';

/**
 * The links this document has shown, for every page's `MediaLinks` to prefer
 * (see "THE SAME LINK AGAIN" in `links.ts`). Browser only: on the server a
 * module lives across requests and people, and nothing of one request's may be
 * kept for the next. Module memory, so it ends with the document: a reload, a
 * logout (a full POST) and anything else that loads a document start empty.
 */
const memory = browser ? new LinkMemory() : undefined;

/**
 * A page's media links as its data brings them: the batch itself, or, on a
 * tap to an entry, the promise of it, which the same response settles after
 * the text (PRD 09, Section 5; `$lib/media/entry-media.server`).
 */
export type PageMedia = SignedMedia | Promise<SignedMedia>;

/**
 * Stamps a batch from a page's data with the moment the browser has it, for
 * its links' life to be counted from. Call from a universal load: it runs as
 * the data arrives, a hover's preload included, and on the server it changes
 * nothing. A batch that follows the data is stamped when it lands, not when
 * the data arrived.
 */
export function received(media: SignedMedia): SignedMedia;
export function received(media: PageMedia): PageMedia;
export function received(media: PageMedia): PageMedia {
	if (!browser) {
		return media;
	}
	const stamp = (batch: SignedMedia): SignedMedia => ({ ...batch, receivedAt: deviceClock() });
	if (!(media instanceof Promise)) {
		return stamp(media);
	}
	const stamped = media.then(stamp);
	// Data preloaded on hover and never shown has no page to take a rejection:
	// it is not an unhandled one. A page's `MediaLinks` still sees it.
	stamped.catch(() => {});
	return stamped;
}

function isSignedMedia(value: unknown): value is SignedMedia {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const batch = value as Record<string, unknown>;
	return (
		typeof batch.urls === 'object' &&
		batch.urls !== null &&
		typeof batch.expiresAt === 'number' &&
		typeof batch.signedAt === 'number'
	);
}

/**
 * Asks `/media/sign` for fresh links. Throws on anything but a batch, including
 * a redirect: the route answers 401 when signed out rather than bouncing, but a
 * followed redirect would otherwise arrive as a 200 holding the login page.
 */
export async function signThroughServer(paths: string[]): Promise<SignedMedia> {
	// Before the request leaves: the server signs after this, so the links have
	// lived no longer than the time since.
	const sent = deviceClock();
	const response = await fetch(resolve('/media/sign'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ paths })
	});
	if (!response.ok || response.redirected) {
		throw new Error(`sign media: HTTP ${response.status}`);
	}
	const batch: unknown = await response.json();
	if (!isSignedMedia(batch)) {
		throw new Error('sign media: unexpected answer');
	}
	return { ...batch, receivedAt: sent };
}

/**
 * A page's `MediaLinks`: signing through the server, timed on `deviceClock`,
 * preferring the links this document has already shown. Not started.
 * `awaiting` is the paths a batch still on its way will be for.
 */
export function createMediaLinks(initial: PageMedia, awaiting: Iterable<string> = []): MediaLinks {
	return new MediaLinks(initial, { sign: signThroughServer, now: deviceClock, memory, awaiting });
}

/**
 * The page's links, started when it mounts and stopped when it goes. Call while
 * the component initialises. Constructing it on the server is harmless: nothing
 * is fetched and no timer runs until `start()`, which only a mount calls.
 */
export function pageMediaLinks(initial: PageMedia, awaiting: Iterable<string> = []): MediaLinks {
	const links = createMediaLinks(initial, awaiting);
	onMount(() => {
		links.start();
		return () => links.stop();
	});
	return links;
}

const KEY = Symbol('media-links');

/** Hands the page's links to every `EntryImage` below. */
export function provideMediaLinks(links: MediaLinks): void {
	setContext(KEY, links);
}

export function mediaLinks(): MediaLinks | undefined {
	return getContext<MediaLinks | undefined>(KEY);
}
