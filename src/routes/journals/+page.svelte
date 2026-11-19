<script lang="ts">
	import JournalCard from './JournalCard.svelte';
	import JournalDialog from './JournalDialog.svelte';
	import DeleteJournalDialog from './DeleteJournalDialog.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The dialogs own their own fields and errors; the page only says when to
	// open them and on what. Bound instances rather than `open` props, so there
	// is no boolean to keep in step with what the element is actually doing.
	let editor: JournalDialog;
	let confirm: DeleteJournalDialog;

	let count = $derived(
		data.journals.length === 1 ? '1 journal' : `${data.journals.length} journals`
	);
</script>

<svelte:head><title>Journals · Noteworthy</title></svelte:head>

<main>
	<div class="mx-auto max-w-5xl px-4 py-10 sm:px-6">
		<div class="flex flex-wrap items-center justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Journals</h1>
				{#if data.journals.length > 0}
					<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">{count}</p>
				{/if}
			</div>

			{#if data.journals.length > 0}
				<button
					type="button"
					onclick={() => editor.open(null)}
					class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
				>
					New journal
				</button>
			{/if}
		</div>

		{#if data.journals.length === 0}
			<!--
				Reachable: every account is created with one journal, so this is what
				somebody sees after deleting it — not a first-run screen. The wording
				assumes they had one and chose otherwise.
			-->
			<div
				class="mt-10 rounded-xl border border-dashed border-[#E0E0E0] bg-white px-6 py-16 text-center dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
			>
				<h2 class="text-lg font-medium text-[#212121] dark:text-[#F5F5F5]">No journals yet</h2>
				<p class="mx-auto mt-2 max-w-sm text-sm text-[#616161] dark:text-[#9E9E9E]">
					A journal is where entries live. Make one and you can start writing.
				</p>
				<button
					type="button"
					onclick={() => editor.open(null)}
					class="mt-6 rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
				>
					Create a journal
				</button>
			</div>
		{:else}
			<ul class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.journals as journal (journal.journal_id)}
					<JournalCard
						{journal}
						onedit={() => editor.open(journal)}
						ondelete={() => confirm.open(journal)}
					/>
				{/each}
			</ul>
		{/if}
	</div>
</main>

<JournalDialog bind:this={editor} />
<DeleteJournalDialog bind:this={confirm} />
