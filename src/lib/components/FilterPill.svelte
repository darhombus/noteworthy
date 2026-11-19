<script lang="ts" module>
	/**
	 * A pill's look, chosen or not: shared with anything in a `FilterRow` that
	 * is not a button (the journal picker is a `<select>`).
	 */
	export const PILL =
		'shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none';
	export const PILL_ON =
		'border-[#1976D2] bg-[#1976D2] font-medium text-white dark:border-[#90CAF9] dark:bg-[#1E3A5F] dark:text-[#F5F5F5]';
	export const PILL_OFF =
		'border-[#E0E0E0] bg-white text-[#212121] hover:border-[#1976D2] dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:hover:border-[#90CAF9]';
</script>

<script lang="ts">
	/**
	 * One pill in a `FilterRow`: a toggle button, `aria-pressed` when chosen and
	 * marked `data-selected` for the row to scroll to.
	 *
	 * `name` and `value` make it a submit button, for a pill that should still
	 * do something without JavaScript (it submits the form it is in, with its
	 * value). `onchoose` is then called with the click, and the pill prevents the
	 * submission itself.
	 */
	import type { Snippet } from 'svelte';

	let {
		pressed,
		onchoose,
		name,
		value,
		children
	}: {
		pressed: boolean;
		onchoose: () => void;
		/** Submits the form without JavaScript: the parameter and its value. */
		name?: string;
		value?: string;
		children: Snippet;
	} = $props();
</script>

<button
	type={name === undefined ? 'button' : 'submit'}
	{name}
	{value}
	aria-pressed={pressed}
	data-selected={pressed || undefined}
	onclick={(event) => {
		event.preventDefault();
		onchoose();
	}}
	class="{PILL} {pressed ? PILL_ON : PILL_OFF}"
>
	{@render children()}
</button>
