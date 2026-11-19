<script lang="ts">
	/**
	 * Custom's From and To fields. Either may be empty. Plain date fields named
	 * `since` and `until`, so without JavaScript the form they are in submits
	 * them and the load searches those days.
	 *
	 * Each field is rendered with the day it was created with: not
	 * `value={since}`, which Svelte writes whenever the expression's effect
	 * re-runs, over whatever is being typed (docs/constraints.md, "Search inside
	 * a journal"). A date field half typed reads as `''`, so a rewrite there
	 * would put the old day back mid-year. Whoever needs the fields to show
	 * other days makes new ones (a `{#key}` in `SearchFilterRow`).
	 *
	 * `value={initial…}` is still in the effect that `reversed` re-runs, and
	 * that write is skipped only because it equals the last one Svelte made. On
	 * fields that were hydrated it is not skipped (after hydration Svelte's
	 * record of it is `null`), and the starting day was written back over a From
	 * that reversed the days (measured). The fields a person types in are never
	 * the hydrated ones: `LiveSearchForm` makes them again after every
	 * navigation, hydration included (`custom += 1`). See docs/constraints.md,
	 * "Inputs written by an expression".
	 *
	 * A day read from a field that is not yet a whole day is `null`: empty, as
	 * far as the search is concerned.
	 */
	import { untrack } from 'svelte';
	import { isDay } from '$lib/search/filters';

	let {
		since,
		until,
		reversed,
		onchange
	}: {
		/** The days the fields start with. Read once. */
		since: string | null;
		until: string | null;
		/** To is before From: said under the fields. */
		reversed: boolean;
		onchange: (days: { since: string | null; until: string | null }) => void;
	} = $props();

	const id = $props.id();
	const initial = untrack(() => ({ since: since ?? '', until: until ?? '' }));

	let from = $state<HTMLInputElement>();
	let to = $state<HTMLInputElement>();

	const day = (field: HTMLInputElement | undefined) =>
		field !== undefined && isDay(field.value) ? field.value : null;

	function changed() {
		onchange({ since: day(from), until: day(to) });
	}
</script>

<div class="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2" data-custom-days>
	<div class="flex flex-col gap-1">
		<label for="{id}-since" class="text-sm text-[#616161] dark:text-[#9E9E9E]">From</label>
		<input
			bind:this={from}
			id="{id}-since"
			name="since"
			type="date"
			value={initial.since}
			oninput={changed}
			aria-invalid={reversed || undefined}
			aria-describedby={reversed ? `${id}-reversed` : undefined}
			class="rounded-lg border border-[#E0E0E0] bg-white px-3 py-1.5 text-sm text-[#212121] [color-scheme:light] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:[color-scheme:dark]"
		/>
	</div>
	<div class="flex flex-col gap-1">
		<label for="{id}-until" class="text-sm text-[#616161] dark:text-[#9E9E9E]">To</label>
		<input
			bind:this={to}
			id="{id}-until"
			name="until"
			type="date"
			value={initial.until}
			oninput={changed}
			aria-invalid={reversed || undefined}
			aria-describedby={reversed ? `${id}-reversed` : undefined}
			class="rounded-lg border border-[#E0E0E0] bg-white px-3 py-1.5 text-sm text-[#212121] [color-scheme:light] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:[color-scheme:dark]"
		/>
	</div>
</div>
{#if reversed}
	<p id="{id}-reversed" role="alert" class="mt-2 text-sm text-[#C62828] dark:text-[#EF9A9A]">
		“To” is before “From”. Change one of them to search.
	</p>
{/if}
