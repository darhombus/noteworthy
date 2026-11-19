<script lang="ts">
	/**
	 * One photo in the read view, drawn from its path through the page's links.
	 *
	 * The link comes from `MediaLinks` (see `$lib/media/links`), not from the
	 * document, so a refresh is a new `src` here and nothing else. The first render
	 * — the server's — already has the link the load signed, so the photo is in
	 * the HTML and starts loading before any script has run.
	 *
	 * `loading="lazy"`, because signed links are rarely cached and the free tier's
	 * bandwidth is 5 GB a month: a photo nobody scrolls to should cost nothing.
	 * The stored pixel size, when the node has it, is on the element, so the photo
	 * holds its place in the page before it arrives and the text below it does not
	 * jump as it does.
	 *
	 * A failed load is reported to the links, which fetch a fresh one once; a
	 * second failure shows "could not be loaded" in place of the photo. Svelte
	 * replays a load or error event that fired before hydration, so a link that
	 * had already died by then is still caught.
	 */
	import { mediaRatio } from '$lib/media/collapsed';
	import type { LinkState } from '$lib/media/links';
	import { mediaLinks } from '$lib/media/page-links';

	let { path, width, height }: { path: string; width: number | null; height: number | null } =
		$props();

	const links = mediaLinks();

	// A plain initial read, so the server renders the signed link straight into
	// the page; the subscription below takes over in the browser.
	// svelte-ignore state_referenced_locally
	let link = $state<LinkState>(links?.state(path) ?? { status: 'missing' });

	$effect(() => links?.subscribe(path, (next) => (link = next)));

	let element = $state<HTMLImageElement | null>(null);

	/**
	 * What happened before this component was running.
	 *
	 * The server rendered the `<img>` with the link it signed, so the browser may
	 * have loaded — or failed to load — the photo well before any of this ran,
	 * and the `load` or `error` that says so has already been and gone. The
	 * element remembers: `complete` with no pixels is a failure. Without this, a
	 * link that had already expired when the page arrived would sit there broken,
	 * because the one thing that asks for a fresh one never fired.
	 */
	$effect(() => {
		const image = element;
		if (image === null || !image.complete || link.status !== 'ready') {
			return;
		}
		if (image.naturalWidth > 0) {
			links?.loaded(path);
		} else {
			links?.failed(path, link.url);
		}
	});

	let ratio = $derived(width !== null && height !== null ? `${width} / ${height}` : undefined);
</script>

<!-- `--media-ratio` feeds the height cap; see `.entry-media` in `layout.css`. -->
<figure class="entry-media" style:--media-ratio={mediaRatio(width, height)}>
	{#if link.status === 'ready'}
		<!--
			"Photo" is the whole of what can be said about it. There is no alt text
			to write one from — captions and alt text are a later decision — and an
			empty alt would tell somebody using a screen reader that the entry has
			nothing here at all. The lint rule is about "image of…" padding in front
			of a real description, which this is not.
		-->
		<!-- svelte-ignore a11y_img_redundant_alt -->
		<img
			bind:this={element}
			src={link.url}
			alt="Photo"
			loading="lazy"
			decoding="async"
			width={width ?? undefined}
			height={height ?? undefined}
			onload={() => links?.loaded(path)}
			onerror={() => {
				if (link.status === 'ready') {
					links?.failed(path, link.url);
				}
			}}
		/>
	{:else if link.status === 'pending'}
		<div class="entry-media-pending" style:aspect-ratio={ratio} aria-hidden="true"></div>
	{:else}
		<p class="entry-media-missing">This photo couldn’t be loaded.</p>
	{/if}
</figure>
