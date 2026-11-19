<script lang="ts">
	/**
	 * Reading an entry. Not a form — there is no input, no contenteditable and
	 * nothing to submit. The whole page is text.
	 *
	 * The body is now rendered as itself: headings, lists, blockquotes and marks,
	 * through `EntryBody`, which walks the stored document and emits Svelte
	 * elements. The flat list of lines this page used to draw is gone, and so is
	 * the reason it existed. What never changed is the stored shape — the same
	 * documents that used to render as lines render as documents now, with nothing
	 * migrated.
	 *
	 * Nothing on this page builds HTML from an entry, which is the whole of its
	 * security posture. `EntryBody`, `EntryBlocks` and `EntryMarks` between them
	 * carry the reasoning; the short version is that there is no `{@html}` and
	 * therefore no sanitiser to get wrong, and the only value the browser acts on
	 * rather than displays — a link's `href` — is re-checked at render time.
	 */
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ActionMenu from '$lib/components/ActionMenu.svelte';
	import EntryBody from '$lib/components/EntryBody.svelte';
	import FontPreloads from '$lib/components/FontPreloads.svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import DeleteEntryDialog from './DeleteEntryDialog.svelte';
	import { preloadEditorWhenIdle } from '$lib/entries/editor-import';
	import { formatDay } from '$lib/format/date';
	import { COLOR_STYLES, toColor } from '$lib/journals/appearance';
	import { entryType } from '$lib/journals/fonts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let tile = $derived(COLOR_STYLES[toColor(data.journal.color)].tile);

	let confirm: DeleteEntryDialog;

	// Edit is tapped from here: have the editor's code ready for it. See
	// `$lib/entries/editor-import`.
	onMount(preloadEditorWhenIdle);

	let editHref = $derived(
		resolve('/journals/[journalId]/entries/[entryId]/edit', {
			journalId: data.journal.journal_id,
			entryId: data.entry.entry_id
		})
	);
</script>

<svelte:head>
	<title>{data.entry.title ?? 'Untitled'} · {data.journal.title} · Noteworthy</title>
</svelte:head>

<FontPreloads files={data.fontFiles} />

<main>
	<div class="mx-auto max-w-2xl px-4 py-10 sm:px-6">
		<!--
			No back link here any more. The shell's breadcrumb carries the journal and
			leads back to it, and two links with the same name on one page is one
			link too many.
		-->
		<span class="inline-flex items-center gap-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
			<span class="flex h-6 w-6 items-center justify-center rounded {tile}">
				<JournalIcon icon={data.journal.icon} class="h-4 w-4" />
			</span>
			{data.journal.title}
		</span>

		<!-- The journal's font and size, for the title and the body alone (`layout.css`, ENTRY FONTS). -->
		<article class="mt-6" {...entryType(data.journal)}>
			<header class="border-b border-[#E0E0E0] pb-6 dark:border-[#3A3A3A]">
				<div class="flex items-start gap-3">
					<h1
						class="entry-title min-w-0 flex-1 font-semibold wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
					>
						{#if data.entry.title}
							{data.entry.title}
						{:else}
							<span class="text-[#616161] italic dark:text-[#9E9E9E]">Untitled</span>
						{/if}
					</h1>

					<!--
						Editing is a link to a separate page, not a mode this one slips into.
						An entry that is open is being read; changing it is a thing you ask
						for. The pencil is a plain link, so it works with no script, as the
						edit page does. It is the menu button's size and colours, so the
						two read as one row of controls; its name is for screen readers,
						since the icon says it to everyone else.
					-->
					<div class="mt-0.5 flex shrink-0 items-center gap-1">
						<a
							href={editHref}
							class="flex h-9 w-9 items-center justify-center rounded-lg text-[#616161] hover:bg-[#F5F5F5] hover:text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#9E9E9E] dark:hover:bg-[#2C2C2C] dark:hover:text-[#F5F5F5]"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
								class="h-5 w-5"
							>
								<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
								<path d="m14.5 5.5 3 3" />
							</svg>
							<span class="sr-only">Edit entry</span>
						</a>
						<ActionMenu
							name={data.entry.title ?? 'Untitled'}
							items={[{ label: 'Delete', destructive: true, run: () => confirm.open() }]}
						/>
					</div>
				</div>
				<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					<!--
						`entry_date` — the day it is about. `created_at` is when it was
						typed, which is a different question and not one this page asks.
					-->
					{formatDay(data.entry.entry_date)}
				</p>
			</header>

			<!-- Keyed on the entry, so its photos' links belong to this entry alone. -->
			{#key data.entry.entry_id}
				<EntryBody content={data.entry.content} media={data.media} />
			{/key}
		</article>
	</div>
</main>

<!-- Outside `<main>`, as on the journal list: a modal dialog is drawn above the page wherever it sits. -->
<DeleteEntryDialog bind:this={confirm} title={data.entry.title ?? 'Untitled'} />
