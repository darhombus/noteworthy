<script lang="ts">
	/**
	 * One video or audio file in the read view, played by the browser's own
	 * player, from its path through the page's links.
	 *
	 * The editor's node view (`$lib/entries/player-node`) is the same thing built
	 * by hand inside ProseMirror, and both hand the element to `$lib/media/player`
	 * for the keys and the links, so the two cannot come to behave differently.
	 *
	 * The server renders the element with the link the load signed, so the player
	 * shows its length before any script has run. After that the element's `src`
	 * is never bound: Svelte writing a refreshed link into it would restart
	 * playback, and deciding when a fresh link can go in without anybody noticing
	 * is the player module's job. So `first` is read once, here, and the links
	 * after it are handed to the player module.
	 *
	 * `preload="metadata"` for the same reason photos load lazily: signed links
	 * are rarely cached, and nothing but the length is fetched until somebody
	 * presses play.
	 */
	import { mediaRatio } from '$lib/media/collapsed';
	import type { LinkState } from '$lib/media/links';
	import { unplayableMessage } from '$lib/media/messages';
	import { mediaLinks } from '$lib/media/page-links';
	import {
		bindPlayerKeys,
		createPlayerSource,
		fitSoundOnlyVideo,
		type PlayerKind,
		type PlayerSource
	} from '$lib/media/player';

	let {
		kind,
		path,
		width = null,
		height = null
	}: { kind: PlayerKind; path: string; width?: number | null; height?: number | null } = $props();

	const links = mediaLinks();

	// A plain initial read, so the server renders the signed link into the page.
	// svelte-ignore state_referenced_locally
	let link = $state<LinkState>(links?.state(path) ?? { status: 'missing' });
	// svelte-ignore state_referenced_locally
	const first = link.status === 'ready' ? link.url : undefined;

	let figure = $state<HTMLElement | null>(null);
	let media = $state<HTMLMediaElement | null>(null);
	let source = $state.raw<PlayerSource | null>(null);

	$effect(() => links?.subscribe(path, (next) => (link = next)));

	$effect(() => {
		const element = media;
		const wrapper = figure;
		if (element === null || wrapper === null) {
			return;
		}
		const unbind = bindPlayerKeys(wrapper, element, kind);
		const unfit = element instanceof HTMLVideoElement ? fitSoundOnlyVideo(element) : () => {};
		const created = createPlayerSource(
			element,
			{ loaded: () => links?.loaded(path), failed: (url) => links?.failed(path, url) },
			element.getAttribute('src')
		);
		source = created;
		return () => {
			source = null;
			created.destroy();
			unbind();
			unfit();
		};
	});

	$effect(() => {
		if (link.status === 'ready') {
			source?.set(link.url);
		}
	});
</script>

<!-- `--media-ratio` feeds the height cap; see `.entry-media` in `layout.css`. -->
<figure
	class="entry-media"
	data-media-kind={kind}
	style:--media-ratio={kind === 'video' ? mediaRatio(width, height) : null}
	bind:this={figure}
>
	{#if link.status === 'missing'}
		<p class="entry-media-missing">{unplayableMessage(kind)}</p>
	{:else if kind === 'video'}
		<!-- No captions track: captions are a later decision, as alt text is for photos. -->
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={media}
			src={first}
			controls
			preload="metadata"
			tabindex="0"
			aria-label="Video"
			width={width ?? undefined}
			height={height ?? undefined}
		></video>
	{:else}
		<audio bind:this={media} src={first} controls preload="metadata" tabindex="0" aria-label="Audio"
		></audio>
	{/if}
</figure>
