/**
 * The Recycle Bin's signed thumbnail links, handed to each thumbnail.
 *
 * The same `MediaLinks` as an entry's photos (`$lib/media/links`), so the same
 * refresh: ten minutes before expiry, on return to a hidden tab, and once on a
 * failed load. What differs is that the bin page outlives its batch. An entry
 * page is keyed on its entry and makes its links once; the bin re-runs its load
 * on every change of tab and after every restore, and each run signs a fresh
 * batch. So the page makes a new `MediaLinks` per batch and hands down a getter
 * for the current one, and each thumbnail follows it, rather than keying the
 * whole list on the batch and rebuilding every row (and losing focus) whenever
 * anything reloads.
 */
import { getContext, setContext } from 'svelte';
import type { MediaLinks } from '$lib/media/links';

const KEY = Symbol('bin-thumbnail-links');

export function provideThumbnailLinks(current: () => MediaLinks): void {
	setContext(KEY, current);
}

export function thumbnailLinks(): (() => MediaLinks) | undefined {
	return getContext<(() => MediaLinks) | undefined>(KEY);
}
