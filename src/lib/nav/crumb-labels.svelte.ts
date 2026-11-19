/**
 * A crumb's label as the page on screen has it now, over the one its load
 * wrote.
 *
 * The trail is built by the loads (`./breadcrumbs`), so it names things as
 * they were when the page was loaded. The edit page renames its entry as the
 * title is typed, and the crumb linking to the entry follows: the field, the
 * crumb and the tab's title say the same thing, and the save status is the one
 * place that says whether it is stored. Leaving by that crumb waits for the
 * save (`$lib/navigation/saved-first`), so the page it opens names the entry
 * the same way.
 *
 * Context, not module state: on the server a module lives across requests.
 * Only an effect writes here, and effects run in the browser alone.
 */
import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { Crumb } from './breadcrumbs';

const KEY = Symbol('crumb-labels');

/** The root layout's: returns the trail with each live label in place. */
export function provideCrumbLabels(): (crumbs: Crumb[]) => Crumb[] {
	const labels = new SvelteMap<string, string>();
	setContext(KEY, labels);
	return (crumbs) =>
		crumbs.map((crumb) => {
			const label = crumb.href === undefined ? undefined : labels.get(crumb.href);
			return label === undefined ? crumb : { ...crumb, label };
		});
}

/**
 * Shows `label()` on the crumb that links to `href()`, for as long as the
 * calling component lives. Call while it initialises.
 */
export function liveCrumbLabel(href: () => string, label: () => string): void {
	const labels = getContext<SvelteMap<string, string> | undefined>(KEY);
	$effect(() => {
		if (labels === undefined) {
			return;
		}
		const key = href();
		labels.set(key, label());
		return () => {
			labels.delete(key);
		};
	});
}
