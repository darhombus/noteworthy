<script lang="ts">
	import type { Crumb } from '$lib/nav/breadcrumbs';

	let { crumbs }: { crumbs: Crumb[] } = $props();
</script>

<!--
	No crumb is wider than the bar. Each is at most 16rem, and its item at most
	the trail's width (`max-w-full`), inside which the crumb truncates: at large
	text 16rem alone is 384px and pushed the page past a phone's window ("Large
	text on phones"). `min-w-0` on the trail lets it narrow inside the bar.
-->
<nav aria-label="Breadcrumb" class="min-w-0">
	<ol class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
		{#each crumbs as crumb, index (crumb.label + index)}
			<li class="flex max-w-full items-center gap-x-2">
				{#if index > 0}
					<span aria-hidden="true" class="text-[#9E9E9E] dark:text-[#757575]">›</span>
				{/if}

				{#if crumb.href && index < crumbs.length - 1}
					<a
						href={crumb.href}
						class="max-w-[16rem] truncate text-[#616161] hover:text-[#1976D2] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#9E9E9E] dark:hover:text-[#90CAF9]"
					>
						{crumb.label}
					</a>
				{:else}
					<!--
						The last crumb is where you already are, so it is text with
						`aria-current` rather than a link back to this same page. Any href it
						was given is ignored here on purpose — the trail is built by the
						loads, and this is the one place that knows which crumb is last.
					-->
					<span
						aria-current="page"
						class="max-w-[16rem] truncate font-medium text-[#212121] dark:text-[#F5F5F5]"
					>
						{crumb.label}
					</span>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
