<script lang="ts">
	/**
	 * An entry's body, read rather than edited.
	 *
	 * This is the whole of the read side: it takes the stored `jsonb`, turns it
	 * into the typed tree in `$lib/entries/render`, and hands that to
	 * `EntryBlocks`. Nothing here builds HTML, so nothing here needs sanitising —
	 * the reasoning is in `render.ts` and the link handling is in `EntryMarks`.
	 *
	 * The classes are the same `entry-prose prose` pair the editor wears, plus
	 * `entry-read` where the two surfaces genuinely differ. That is the point: an
	 * entry should not change shape when you stop typing, and the way to be sure
	 * of it is for both views to be styled by one rule set rather than by two that
	 * agree today.
	 *
	 * Photos are signed by the page's load and handed down as `media`. The links
	 * made from them here are shared with every `EntryImage` below through
	 * context, and kept fresh for as long as the page is open (`$lib/media/links`).
	 * Captured once: the read page keys this component on the entry, so another
	 * entry is another instance with its own links. On a tap `media` is a
	 * promise the same response settles after the text, and the body's paths are
	 * what it will bring (`$lib/media/links`, A BATCH STILL ON ITS WAY).
	 */
	import { untrack } from 'svelte';
	import { mediaPaths } from '$lib/entries/media';
	import { isRenderEmpty, toRenderTree } from '$lib/entries/render';
	import { pageMediaLinks, provideMediaLinks, type PageMedia } from '$lib/media/page-links';
	import type { Json } from '$lib/types/database';
	import EntryBlocks from './EntryBlocks.svelte';

	let { content, media }: { content: Json; media: PageMedia } = $props();

	provideMediaLinks(
		pageMediaLinks(
			untrack(() => media),
			untrack(() => mediaPaths(content))
		)
	);

	let blocks = $derived(toRenderTree(content));
	let empty = $derived(isRenderEmpty(blocks));
</script>

{#if empty}
	<p class="mt-8 font-serif text-[18px] text-[#616161] italic dark:text-[#9E9E9E]">
		This entry has no body.
	</p>
{:else}
	<div class="entry-prose entry-read prose mt-8 max-w-none">
		<EntryBlocks {blocks} />
	</div>
{/if}
