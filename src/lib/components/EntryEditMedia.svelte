<script lang="ts">
	/**
	 * One photo, video or audio file on the edit page before the editor arrives,
	 * drawn as the editor's node view will draw it (`$lib/entries/image-node`,
	 * `$lib/entries/player-node`, `createFold` in `$lib/entries/collapse`).
	 *
	 * The same figure, element for element where it takes room: the
	 * `entry-media-foldable` class (an audio player gives up its collapse
	 * button's width for it), the body wrapper, the stored size and the ratio the
	 * height cap reads, and the collapse button in its corner. The collapsed row
	 * is left out: the editor builds it hidden, and every item opens expanded
	 * (`$lib/entries/collapse`, NOTHING IS STORED). A photo is drawn from the
	 * page's links, which the editor's view then shows from the same link, so
	 * the browser has the picture already.
	 *
	 * `inert`, the whole figure: nothing in it can be pressed, focused or played
	 * until the editor's own figure takes its place. A player started here would
	 * stop the moment it was replaced, and the collapse button has nothing to
	 * collapse yet. So the players are drawn with `controls`, which is what gives
	 * an audio player its height, but without a link — nothing is fetched for
	 * them twice — and a tap anywhere on the figure does nothing at all.
	 */
	import { FOLD_ICONS, KIND_NAMES, mediaRatio } from '$lib/media/collapsed';
	import type { LinkState } from '$lib/media/links';
	import { unplayableMessage } from '$lib/media/messages';
	import { mediaLinks } from '$lib/media/page-links';
	import type { MediaKind } from '$lib/media/types';

	let {
		kind,
		path,
		width = null,
		height = null,
		selected = false
	}: {
		kind: MediaKind;
		path: string;
		width?: number | null;
		height?: number | null;
		/** The editor opens with this item selected: see `$lib/entries/opening`. */
		selected?: boolean;
	} = $props();

	const links = mediaLinks();

	// svelte-ignore state_referenced_locally
	let link = $state<LinkState>(links?.state(path) ?? { status: 'missing' });

	$effect(() => links?.subscribe(path, (next) => (link = next)));

	let sized = $derived(kind === 'audio' ? null : mediaRatio(width, height));
	let shape = $derived(sized === null ? undefined : `${width} / ${height}`);
	let noun = $derived(KIND_NAMES[kind].toLowerCase());
</script>

<figure
	class="entry-media entry-media-foldable"
	class:ProseMirror-selectednode={selected}
	data-media-kind={kind === 'image' ? undefined : kind}
	style:--media-ratio={sized}
	inert
>
	<div class="entry-media-body">
		{#if kind === 'image'}
			{#if link.status === 'ready'}
				<!-- svelte-ignore a11y_img_redundant_alt -->
				<img
					src={link.url}
					alt="Photo"
					loading="lazy"
					decoding="async"
					draggable="false"
					width={sized === null ? undefined : width}
					height={sized === null ? undefined : height}
				/>
			{:else if link.status === 'pending'}
				<div class="entry-media-pending" style:aspect-ratio={shape} aria-hidden="true"></div>
			{:else}
				<p class="entry-media-missing">This photo couldn’t be loaded.</p>
			{/if}
		{:else if link.status === 'missing'}
			<p class="entry-media-missing">{unplayableMessage(kind)}</p>
		{:else if kind === 'video' && link.status === 'pending'}
			<div class="entry-media-pending" style:aspect-ratio={shape} aria-hidden="true"></div>
		{:else if kind === 'video'}
			<video
				controls
				preload="none"
				aria-label="Video"
				width={sized === null ? undefined : width}
				height={sized === null ? undefined : height}
			></video>
		{:else}
			<audio controls preload="none" aria-label="Audio"></audio>
		{/if}
	</div>
	<button
		type="button"
		class="entry-media-collapse"
		aria-expanded="true"
		aria-label="Collapse {noun}"
		title="Collapse {noun}"
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			class="entry-media-collapse-icon"
		>
			{#each FOLD_ICONS.collapse as d (d)}<path {d} />{/each}
		</svg>
	</button>
</figure>
