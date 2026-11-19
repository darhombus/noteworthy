<script lang="ts">
	/**
	 * The journal's font files an entry page draws, asked for from the page's
	 * head (`$lib/server/font-files`, `entryFontFiles`).
	 *
	 * Without a preload a face is requested only once its text is laid out, after
	 * the first paint, so the page is first drawn in the fallback. With it, the
	 * request starts as the document is read, alongside the stylesheet.
	 *
	 * `crossorigin` is required even on the app's own origin: fonts are fetched
	 * in CORS mode, and a preload without it is a different request, so
	 * Chromium and Firefox download the file twice (measured; docs/constraints.md,
	 * "Journal fonts"). Default preloads nothing, and this renders nothing.
	 */
	let { files }: { files: string[] } = $props();
</script>

<svelte:head>
	{#each files as href (href)}
		<link rel="preload" as="font" type="font/woff2" {href} crossorigin="anonymous" />
	{/each}
</svelte:head>
