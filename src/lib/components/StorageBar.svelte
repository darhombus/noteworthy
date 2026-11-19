<script lang="ts">
	/**
	 * "34% of storage used", with a thin bar under it, linking to the Storage page.
	 *
	 * The words are the link's name and say everything; the bar is decoration for
	 * the eye and hidden from assistive technology, so a screen reader hears one
	 * sentence and not a second, unlabelled figure. Amber from 90%, in the text as
	 * well as the bar, so the warning does not rest on colour in a thin strip
	 * alone.
	 */
	import { resolve } from '$app/paths';
	import { barWidth, isNearlyFull, usedSummary } from '$lib/media/usage';

	let { used }: { used: number } = $props();

	let full = $derived(isNearlyFull(used));
</script>

<a
	href={resolve('/settings/storage')}
	data-nearly-full={full ? 'true' : undefined}
	class="block rounded-lg px-3 py-2 text-xs hover:underline focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 {full
		? 'text-amber-800 dark:text-amber-300'
		: 'text-[#616161] hover:text-[#212121] dark:text-[#9E9E9E] dark:hover:text-[#F5F5F5]'}"
>
	{usedSummary(used)}
	<span
		aria-hidden="true"
		class="mt-1.5 block h-1 overflow-hidden rounded-full bg-[#E0E0E0] dark:bg-[#3A3A3A]"
	>
		<span
			data-bar
			class="block h-full rounded-full {full ? 'bg-amber-500 dark:bg-amber-400' : 'bg-[#1976D2]'}"
			style:width={barWidth(used)}
		></span>
	</span>
</a>
