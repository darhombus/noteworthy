<script lang="ts">
	/**
	 * A row of filter pills. It knows nothing about which filters: the pills are
	 * its children (`FilterPill`, or anything shaped like one), so a pill added
	 * later (Pinned, Favourites) is one more child and nothing here changes.
	 *
	 * Below `lg` the row stays on one line and scrolls sideways, as the Recycle
	 * Bin's tabs do at 320px; the negative margin lets it scroll to the screen's
	 * edge rather than stopping at the page's padding. From `lg` it wraps.
	 *
	 * The pill marked `data-selected` is scrolled into view whenever `selected`
	 * changes (and once the page runs), so a pill chosen from a link or a reload
	 * at the far end is not out of sight. Only the row scrolls, never the page:
	 * `scrollLeft` is set directly rather than through `scrollIntoView`.
	 */
	import type { Snippet } from 'svelte';

	let {
		label,
		selected,
		children
	}: {
		/** What the row filters, for screen readers. */
		label: string;
		/** A key that changes when the selected pill does. */
		selected: string;
		children: Snippet;
	} = $props();

	let row = $state<HTMLElement>();

	/** Room left beside a pill scrolled to an edge: the page's gutter. */
	const MARGIN = 16;

	$effect(() => {
		void selected;
		const pill = row?.querySelector<HTMLElement>('[data-selected]');
		if (row === undefined || pill === null || pill === undefined) {
			return;
		}
		const start = pill.offsetLeft;
		const end = start + pill.offsetWidth;
		if (start - MARGIN < row.scrollLeft) {
			row.scrollLeft = Math.max(0, start - MARGIN);
		} else if (end + MARGIN > row.scrollLeft + row.clientWidth) {
			row.scrollLeft = end + MARGIN - row.clientWidth;
		}
	});
</script>

<div
	bind:this={row}
	role="group"
	aria-label={label}
	data-filter-row
	class="relative -mx-4 scrollbar-app overflow-x-auto overscroll-x-contain px-4 py-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0"
>
	<div class="flex w-max min-w-full items-center gap-2 lg:w-auto lg:flex-wrap">
		{@render children()}
	</div>
</div>
