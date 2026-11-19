<script lang="ts">
	/**
	 * A waiting file's picture: the photo itself, small, or an icon for video
	 * and audio (a frame of a video would mean loading the video).
	 *
	 * The photo's link comes from the page's `MediaLinks`, through
	 * `$lib/bin/thumbnail-links`, the way `EntryImage` gets its own: the server's
	 * render already has it, a failed load asks for a fresh one once, and the
	 * link is refreshed before it expires. Decorative: the row says what it is.
	 */
	import type { LinkState } from '$lib/media/links';
	import { thumbnailLinks } from '$lib/bin/thumbnail-links';

	let { path, kind }: { path: string; kind: 'Photo' | 'Video' | 'Audio' | 'File' } = $props();

	const links = thumbnailLinks();

	// svelte-ignore state_referenced_locally
	let link = $state<LinkState>(
		kind === 'Photo' && links ? links().state(path) : { status: 'missing' }
	);

	// Follows the page's current links; a new batch after a reload re-subscribes.
	$effect(() => {
		if (kind !== 'Photo' || links === undefined) {
			return;
		}
		return links().subscribe(path, (next) => (link = next));
	});

	let element = $state<HTMLImageElement | null>(null);

	// A load or failure that happened before this ran, as in `EntryImage`.
	$effect(() => {
		const image = element;
		if (image === null || !image.complete || link.status !== 'ready' || links === undefined) {
			return;
		}
		if (image.naturalWidth > 0) {
			links().loaded(path);
		} else {
			links().failed(path, link.url);
		}
	});
</script>

<span
	class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#F5F5F5] text-[#616161] dark:bg-[#2C2C2C] dark:text-[#9E9E9E]"
>
	{#if kind === 'Photo' && link.status === 'ready'}
		<img
			bind:this={element}
			src={link.url}
			alt=""
			loading="lazy"
			decoding="async"
			data-thumbnail
			class="h-full w-full object-cover"
			onload={() => links?.().loaded(path)}
			onerror={() => {
				if (link.status === 'ready') {
					links?.().failed(path, link.url);
				}
			}}
		/>
	{:else if kind === 'Photo' && link.status === 'pending'}
		<span aria-hidden="true" class="h-full w-full"></span>
	{:else}
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			data-icon={kind.toLowerCase()}
			class="h-6 w-6"
		>
			{#if kind === 'Video'}
				<rect x="3" y="6" width="13" height="12" rx="2" />
				<path d="m16 10 5-3v10l-5-3" />
			{:else if kind === 'Audio'}
				<path d="M9 18V5l11-2v13" />
				<circle cx="6" cy="18" r="3" />
				<circle cx="17" cy="16" r="3" />
			{:else}
				<!-- A photo that could not be loaded, or a file of no known kind. -->
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<circle cx="9" cy="9" r="2" />
				<path d="m21 15-5-5L5 21" />
			{/if}
		</svg>
	{/if}
</span>
