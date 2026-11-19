<script lang="ts">
	import { resolve } from '$app/paths';
	import ActionMenu from '$lib/components/ActionMenu.svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import { formatDay } from '$lib/format/date';
	import { COLOR_STYLES, toColor } from '$lib/journals/appearance';
	import { CARD, CARD_LINK } from '$lib/layout/card';
	import type { Journal } from '$lib/data/journals';

	let {
		journal,
		onedit,
		ondelete
	}: {
		journal: Journal;
		onedit: () => void;
		ondelete: () => void;
	} = $props();

	let tile = $derived(COLOR_STYLES[toColor(journal.color)].tile);

	let updated = $derived(formatDay(journal.updated_at));

	/**
	 * `entry_count` is the column, not a count() over entries — it is maintained
	 * by triggers, and reading it is free where counting would be a second query
	 * per card.
	 *
	 * It is accurate for everything this PRD can do: creating, deleting and
	 * hiding an entry all fire the rollup. Two known defects will show up here
	 * once the sections that reach them land. FINDING 7-B — moving an entry
	 * between journals fires no rollup at all — makes this number wrong on both
	 * journals involved. FINDING 7-A leaves the sibling `total_word_count` stale
	 * after a body edit, so a word count added to this card later is the next
	 * thing to go wrong. Neither is fixed in this PRD by decision; both have
	 * failing-by-design assertions in tests/rls/counters.test.ts.
	 */
	let entries = $derived(journal.entry_count === 1 ? '1 entry' : `${journal.entry_count} entries`);
</script>

<!--
	`min-w-0`: a grid item is at least as wide as its content, and the name's
	`truncate` only truncates once something is narrower than the name. Without
	it a long name widened the card, the column and every card past the window
	("Large text on phones").
-->
<li class="flex min-w-0 flex-col {CARD}">
	<div class="flex items-start gap-3">
		<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {tile}">
			<JournalIcon icon={journal.icon} />
		</span>

		<div class="min-w-0 flex-1">
			<h2 class="truncate font-semibold text-[#212121] dark:text-[#F5F5F5]">
				<!--
					The name is the one link, stretched over the card, so a tap anywhere
					opens the journal and the menu still sits above it: `$lib/layout/card`.
				-->
				<a
					href={resolve('/journals/[journalId]', { journalId: journal.journal_id })}
					class={CARD_LINK}
				>
					{journal.title}
				</a>
			</h2>
			{#if journal.description}
				<p class="mt-1 line-clamp-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					{journal.description}
				</p>
			{:else}
				<p class="mt-1 text-sm text-[#9E9E9E] italic dark:text-[#757575]">No description</p>
			{/if}
		</div>

		<!-- Pulled up and in by its own padding, so the dots line up with the title. -->
		<div class="-mt-1.5 -mr-2">
			<ActionMenu
				name={journal.title}
				items={[
					{ label: 'Edit', run: onedit },
					{ label: 'Delete', destructive: true, run: ondelete }
				]}
			/>
		</div>
	</div>

	<p class="mt-4 text-sm text-[#616161] dark:text-[#9E9E9E]">
		{entries} · Updated {updated}
	</p>
</li>
