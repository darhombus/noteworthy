<script lang="ts">
	/**
	 * The Storage page: how much of the 70 MB is used, and by what.
	 *
	 * Five rows that add up to the headline, each file in exactly one:
	 *
	 *   Images, Video, Audio   files a live entry shows (hidden entries are
	 *                          live), and uploads whose new entry hasn't saved
	 *   Recycle Bin            files only entries in the bin name
	 *   Waiting to be cleared  files taken out of entries that nothing names
	 *
	 * `media_breakdown()` in `20260926120000_recycle_bin` draws the lines. The
	 * last two lead to the bin, where their space can be freed now.
	 *
	 * Each figure carries its exact bytes in `data-bytes`: the sizes on screen
	 * are rounded, and need not add up to the rounded headline.
	 */
	import { resolve } from '$app/paths';
	import { tabQuery, type BinTab } from '$lib/bin/rows';
	import { formatSize } from '$lib/media/messages';
	import { barWidth, isNearlyFull, usedOfAllowance } from '$lib/media/usage';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** `bin`: the Recycle Bin tab the row's label leads to, if it leads anywhere. */
	type Row = { label: string; bytes: number; bin?: BinTab; description?: string };

	let rows = $derived<Row[]>(
		data.usage === null
			? []
			: [
					{ label: 'Images', bytes: data.usage.images },
					{ label: 'Video', bytes: data.usage.video },
					{ label: 'Audio', bytes: data.usage.audio },
					{
						label: 'Recycle Bin',
						bytes: data.usage.bin,
						bin: 'all',
						description:
							'Photos, videos and audio in deleted entries and journals. Emptying the bin frees this space.'
					},
					{
						label: 'Waiting to be cleared',
						bytes: data.usage.waiting,
						bin: 'waiting',
						description:
							'Photos, videos and audio removed from entries. Cleared automatically within 2 days, or now from the Recycle Bin.'
					}
				]
	);

	let full = $derived(data.usage !== null && isNearlyFull(data.usage.total));
</script>

<svelte:head><title>Storage · Noteworthy</title></svelte:head>

<main>
	<div class="mx-auto max-w-2xl px-4 py-10 sm:px-6">
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Storage</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			Photos, videos and audio in your entries. Text doesn’t count.
		</p>

		<section
			aria-labelledby="storage-used"
			class="mt-8 rounded-xl border border-[#E0E0E0] bg-white p-6 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			{#if data.usage === null}
				<h2 id="storage-used" class="text-base font-medium text-[#212121] dark:text-[#F5F5F5]">
					Storage used
				</h2>
				<p role="alert" class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					Couldn’t read how much storage you’re using just now. Reload the page to try again.
				</p>
			{:else}
				<h2
					id="storage-used"
					data-bytes={data.usage.total}
					class="text-base font-medium {full
						? 'text-amber-800 dark:text-amber-300'
						: 'text-[#212121] dark:text-[#F5F5F5]'}"
				>
					{usedOfAllowance(data.usage.total)}
				</h2>
				<div
					aria-hidden="true"
					class="mt-3 h-2 overflow-hidden rounded-full bg-[#E0E0E0] dark:bg-[#3A3A3A]"
				>
					<div
						data-bar
						class="h-full rounded-full {full ? 'bg-amber-500 dark:bg-amber-400' : 'bg-[#1976D2]'}"
						style:width={barWidth(data.usage.total)}
					></div>
				</div>

				<!--
					A row with an explanation has a second `dd` for the same term: it
					belongs to that row, and a screen reader reads it as part of it. A
					grid rather than a nested box, because a `dl`'s groups may hold only
					`dt` and `dd`.
				-->
				<dl class="mt-6 divide-y divide-[#E0E0E0] text-sm dark:divide-[#3A3A3A]">
					{#each rows as row (row.label)}
						<div class="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3" data-row={row.label}>
							<dt class="min-w-0 text-[#212121] dark:text-[#F5F5F5]">
								{#if row.bin}
									<a
										href="{resolve('/bin')}{tabQuery(row.bin)}"
										class="font-medium text-[#1976D2] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#90CAF9]"
									>
										{row.label}
									</a>
								{:else}
									{row.label}
								{/if}
							</dt>
							<dd class="text-[#616161] tabular-nums dark:text-[#9E9E9E]" data-bytes={row.bytes}>
								{formatSize(row.bytes)}
							</dd>
							{#if row.description}
								<dd class="col-span-2 mt-1 text-xs text-[#616161] dark:text-[#9E9E9E]">
									{row.description}
								</dd>
							{/if}
						</div>
					{/each}
				</dl>
			{/if}
		</section>
	</div>
</main>
