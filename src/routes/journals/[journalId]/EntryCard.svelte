<script lang="ts">
	/**
	 * One entry in a journal's list.
	 *
	 * The card used to be one `<a>`. It holds a menu now, so the link is the
	 * title, stretched over the card as a journal card's name is, and a tap on
	 * the date or the excerpt still opens the entry: `$lib/layout/card`.
	 *
	 * The menu holds Rename alone. Delete is on the read page only; the reason
	 * is at the top of `DeleteEntryDialog.svelte`.
	 */
	import { resolve } from '$app/paths';
	import ActionMenu from '$lib/components/ActionMenu.svelte';
	import type { Entry } from '$lib/data/entries';
	import { toExcerpt } from '$lib/entries/body';
	import { formatDay } from '$lib/format/date';
	import { CARD, CARD_LINK } from '$lib/layout/card';

	let { entry, onrename }: { entry: Entry; onrename: () => void } = $props();

	let excerpt = $derived(toExcerpt(entry.content));
</script>

<li class={CARD}>
	<div class="flex items-start gap-3">
		<div class="min-w-0 flex-1">
			<!-- `wrap-anywhere`: a 200-character title with no spaces still fits 320px. -->
			<h2 class="font-semibold wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
				<a
					href={resolve('/journals/[journalId]/entries/[entryId]', {
						journalId: entry.journal_id,
						entryId: entry.entry_id
					})}
					class={CARD_LINK}
				>
					{#if entry.title}
						{entry.title}
					{:else}
						<span class="text-[#616161] italic dark:text-[#9E9E9E]">Untitled</span>
					{/if}
				</a>
			</h2>

			<!--
				The date, and only the date. The previous version put a reading
				time here; it tells you nothing about your own diary that you did
				not already know.
			-->
			<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
				{formatDay(entry.entry_date)}
			</p>
		</div>

		<!-- Pulled up and in by its own padding, so the dots line up with the title. -->
		<div class="-mt-1.5 -mr-2">
			<ActionMenu name={entry.title ?? 'Untitled'} items={[{ label: 'Rename', run: onrename }]} />
		</div>
	</div>

	{#if excerpt}
		<p class="mt-3 line-clamp-2 text-sm text-[#212121] dark:text-[#F5F5F5]">
			{excerpt}
		</p>
	{/if}
</li>
