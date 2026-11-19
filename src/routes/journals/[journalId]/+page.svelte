<script lang="ts">
	/**
	 * A journal: its header, a search of its entries, and the entries.
	 *
	 * The search is `LiveSearchForm`, as on `/search`, limited to this journal.
	 * While a query is shown its results take the entry list's place; cleared,
	 * the list is back, from the data already loaded. The results carry no card
	 * menus, so Rename is only ever on the list, and its `invalidateAll` re-runs
	 * the load for the URL the page was loaded with: see WHAT SHALLOW ROUTING
	 * COSTS in `LiveSearchForm.svelte`.
	 *
	 * `{#key}` on the journal: going from one journal's page to another's keeps
	 * this component, and the search must start again for the new journal.
	 */
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import LiveSearchForm from '$lib/components/LiveSearchForm.svelte';
	import { preloadEditorWhenIdle } from '$lib/entries/editor-import';
	import { COLOR_STYLES, toColor } from '$lib/journals/appearance';
	import EntryCard from './EntryCard.svelte';
	import RenameEntryDialog from './RenameEntryDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let renamer: RenameEntryDialog;

	// New entry is tapped from here: have the editor's code ready for it. See
	// `$lib/entries/editor-import`.
	onMount(preloadEditorWhenIdle);

	let tile = $derived(COLOR_STYLES[toColor(data.journal.color)].tile);
</script>

<main>
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<!-- The way back to the journal list is the breadcrumb in the shell. -->
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div class="flex min-w-0 items-start gap-3">
				<span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg {tile}">
					<JournalIcon icon={data.journal.icon} class="h-6 w-6" />
				</span>
				<div class="min-w-0">
					<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
						{data.journal.title}
					</h1>
					{#if data.journal.description}
						<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
							{data.journal.description}
						</p>
					{/if}
				</div>
			</div>

			<a
				href={resolve('/journals/[journalId]/entries/new', { journalId: data.journal.journal_id })}
				class="shrink-0 rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
			>
				New entry
			</a>
		</div>

		<div class="mt-6">
			{#key data.journal.journal_id}
				<LiveSearchForm
					path={resolve('/journals/[journalId]', { journalId: data.journal.journal_id })}
					query={data.query}
					outcome={data.outcome}
					filters={data.filters}
					journal={{ id: data.journal.journal_id, name: data.journal.title }}
					label="Search this journal"
					title={(shown) =>
						`${shown === '' ? '' : `${shown} · `}${data.journal.title} · Noteworthy`}
					idle={list}
				/>
			{/key}
		</div>
	</div>
</main>

{#snippet list()}
	{#if data.entries.length === 0}
		<div
			class="rounded-xl border border-dashed border-[#E0E0E0] bg-white px-6 py-16 text-center dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			<h2 class="text-lg font-medium text-[#212121] dark:text-[#F5F5F5]">Nothing written yet</h2>
			<p class="mx-auto mt-2 max-w-sm text-sm text-[#616161] dark:text-[#9E9E9E]">
				This journal is empty. The first entry is the hard one.
			</p>
			<a
				href={resolve('/journals/[journalId]/entries/new', {
					journalId: data.journal.journal_id
				})}
				class="mt-6 inline-block rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
			>
				Write the first entry
			</a>
		</div>
	{:else}
		<ul class="space-y-3">
			{#each data.entries as entry (entry.entry_id)}
				<EntryCard {entry} onrename={() => void renamer.open(entry)} />
			{/each}
		</ul>
	{/if}
{/snippet}

<!-- Outside `<main>`, as on the journal list: a modal dialog is drawn above the page wherever it sits. -->
<RenameEntryDialog bind:this={renamer} />
