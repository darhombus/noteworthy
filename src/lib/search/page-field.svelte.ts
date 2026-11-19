/**
 * The search page's own field, as the shell sees it.
 *
 * On `/search` the top bar's icon and Ctrl/Cmd+K focus the page's field rather
 * than opening the modal over a page that is already search. The root layout
 * provides the holder; the search page's `LiveSearchForm` puts its field in it
 * for as long as it is on screen. The journal page's form does not: there the
 * icon searches every journal, which is the modal's job.
 *
 * A context rather than a DOM query, so that which field counts is said by the
 * page that owns it, not guessed from markup.
 */
import { getContext, setContext } from 'svelte';

export type PageSearchField = { field: HTMLInputElement | null };

const KEY = Symbol('page-search-field');

/** Called once by the root layout. */
export function providePageSearchField(): PageSearchField {
	const holder: PageSearchField = { field: null };
	setContext(KEY, holder);
	return holder;
}

/**
 * Called during component initialisation by the form that is the page's
 * search, with a getter for its field (bound once mounted). Released when the
 * component goes.
 */
export function claimPageSearchField(get: () => HTMLInputElement | undefined): void {
	const holder = getContext<PageSearchField | undefined>(KEY);
	if (holder === undefined) {
		return;
	}
	$effect(() => {
		const field = get() ?? null;
		holder.field = field;
		return () => {
			if (holder.field === field) {
				holder.field = null;
			}
		};
	});
}
