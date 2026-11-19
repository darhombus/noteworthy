/**
 * `./saved-first` wired to the window and to SvelteKit's `navigating`, which
 * is set before a navigation asks for its page's data. Created on first use,
 * in the browser: the entry pages call it from `entryAutosave`.
 */
import { navigating } from '$app/state';
import { createSavedFirst, type SavedFirst } from './saved-first';

let instance: SavedFirst | null = null;

export function savedFirst(): SavedFirst {
	instance ??= createSavedFirst(window, () => navigating.to !== null);
	return instance;
}
