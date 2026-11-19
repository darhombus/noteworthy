/**
 * The trail shown above every page in the shell.
 *
 * Built by each page's load function rather than derived from the URL in the
 * layout. A URL carries ids, not names — `/journals/9f3a…/entries/1c7b…` cannot
 * be turned into `Journals › Stuff › Vacation` without the rows, and the load
 * has already fetched them. Deriving it in the layout would mean fetching them
 * a second time.
 *
 * The last crumb is the page you are on. It carries no `href` and renders as
 * text with `aria-current`, so the trail never offers a link to where you
 * already are.
 */
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

export type Crumb = {
	label: string;
	/**
	 * Omitted on the final crumb, which is the current page.
	 *
	 * `ResolvedPathname` rather than `string`, and built by `resolve()` below.
	 * That is not decoration: it is the branded type `resolve()` returns, it is
	 * what carries a base path if one is ever configured, and it is what lets
	 * `Breadcrumbs.svelte` write `href={crumb.href}` without tripping
	 * `svelte/no-navigation-without-resolve`. A plain string would compile and
	 * fail lint, which is the rule doing its job.
	 */
	href?: ResolvedPathname;
};

/** Every trail starts here, because Journals is the only built section. */
export const JOURNALS: Crumb = { label: 'Journals', href: resolve('/journals') };

/** The crumb for a journal, linked — used by everything below a journal. */
export function journalCrumb(journalId: string, title: string): Crumb {
	return { label: title, href: resolve('/journals/[journalId]', { journalId }) };
}

/** The crumb for an entry, linked — used by the pages below an entry. */
export function entryCrumb(journalId: string, entryId: string, title: string | null): Crumb {
	return {
		label: title ?? 'Untitled',
		href: resolve('/journals/[journalId]/entries/[entryId]', { journalId, entryId })
	};
}
