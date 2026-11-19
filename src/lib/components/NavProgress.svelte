<script lang="ts">
	/**
	 * A thin bar across the top of the window while a client-side navigation
	 * waits for the next page: a tap on a phone has no hover to preload on, and
	 * over a slow mobile connection the page's data is a round trip to Frankfurt away, so the old
	 * page would otherwise sit there looking as if the tap did nothing.
	 *
	 * Shown only once a navigation has taken `SHOW_AFTER_MS` (`$lib/nav/progress`),
	 * so a fast one never flashes it; gone the moment the page changes.
	 * `navigating` is SvelteKit's, set for links, `goto`, Back and Forward and
	 * form redirects, never for the shallow `replaceState` the search pages
	 * follow their query with.
	 *
	 * `fixed` and drawn over the top 2px of whatever is there, so it moves
	 * nothing: not the page, not the breadcrumb bar, not the editor's pinned
	 * toolbar under it. `pointer-events-none`, so it takes no tap. Above the
	 * sticky bars (`z-20`), below the top layer, where an open modal dialog is;
	 * every dialog the app has closes as a navigation starts.
	 *
	 * Its growth says time is passing, not how much is done: nothing knows that.
	 * It eases towards 90% and stops there. With reduced motion it is drawn
	 * whole and still.
	 */
	import { onDestroy } from 'svelte';
	import { navigating } from '$app/state';
	import { delayedFlag, SHOW_AFTER_MS } from '$lib/nav/progress';

	let shown = $state(false);

	const flag = delayedFlag(SHOW_AFTER_MS, (up) => {
		shown = up;
	});

	$effect(() => {
		if (navigating.to !== null) {
			flag.start();
		} else {
			flag.stop();
		}
	});

	onDestroy(() => flag.stop());
</script>

{#if shown}
	<div
		role="progressbar"
		aria-label="Loading page"
		data-nav-progress
		class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
	>
		<div class="nav-progress h-full origin-left bg-[#1976D2] dark:bg-[#90CAF9]"></div>
	</div>
{/if}

<style>
	.nav-progress {
		animation: nav-progress 10s cubic-bezier(0.1, 0.6, 0.2, 1) forwards;
	}

	@keyframes nav-progress {
		from {
			transform: scaleX(0.1);
		}
		to {
			transform: scaleX(0.9);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.nav-progress {
			animation: none;
		}
	}
</style>
