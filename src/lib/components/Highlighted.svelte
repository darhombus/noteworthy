<script lang="ts">
	/**
	 * Text with its search matches marked: each `Segment` rendered as text, the
	 * matched ones inside a `<mark>`. Never `{@html}`: titles and snippets are
	 * the person's own writing, and a `<script>` in one is words to show.
	 *
	 * The highlight is the entry body's own (`mark` in `layout.css`): `#FDF3C7`
	 * under `#212121` in light mode (14.4:1), `#4A3D00` under `#F5F5F5` in dark
	 * (9.8:1). Without the body's padding, which would open a gap inside a word
	 * matched in part ("**run**ning").
	 *
	 * No markup may sit between a `</mark>` and the text beside it: it would be
	 * drawn as a space inside the word. Whitespace at the edges of a block's
	 * body is trimmed by Svelte, so the formatting below is safe; the component
	 * test checks the text comes out whole.
	 *
	 * With `words`, the marks are placed again on the same text for those words
	 * (`highlight`, the server's own rules), ignoring where the server put them:
	 * the field's words as typed, ahead of the answer for them (`markWords` in
	 * `$lib/search/results`).
	 */
	import { highlight, type Segment } from '$lib/search/text';

	let { parts, words = null }: { parts: Segment[]; words?: string[] | null } = $props();

	let shown = $derived(
		words === null ? parts : highlight(parts.map((part) => part.text).join(''), words)
	);
</script>

{#each shown as part, index (index)}{#if part.match}<mark
			class="rounded-[0.2em] bg-[#FDF3C7] text-[#212121] dark:bg-[#4A3D00] dark:text-[#F5F5F5]"
			>{part.text}</mark
		>{:else}{part.text}{/if}{/each}
