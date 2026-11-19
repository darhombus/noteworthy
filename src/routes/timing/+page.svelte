<script lang="ts">
	/**
	 * On and Off for the timing readout, in this browser only. Two plain forms,
	 * so they work without JavaScript; the server answers each with a redirect
	 * back here. `data.timing` is the root layout's reading of the cookie.
	 */
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const button =
		'rounded-lg border px-4 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none disabled:cursor-default disabled:opacity-50';
</script>

<svelte:head><title>Timing · Noteworthy</title></svelte:head>

<main>
	<div class="mx-auto max-w-xl px-4 py-10 sm:px-6">
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Timing readout</h1>
		<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
			A small box in a corner of every page that records how long the last 30 taps, page loads,
			returns to the app and photos, videos and recordings took, for this browser only. It keeps
			them until the page is closed or reloaded and sends them nowhere; Copy puts them on the
			clipboard. It records no titles, names, words or addresses.
		</p>

		<p class="mt-6 text-sm text-[#212121] dark:text-[#F5F5F5]" data-timing-state>
			The readout is <strong>{data.timing ? 'on' : 'off'}</strong> in this browser.
		</p>

		<div class="mt-4 flex gap-3">
			<form method="POST" action="?/on">
				<button
					type="submit"
					disabled={data.timing}
					class="{button} border-[#1976D2] bg-[#1976D2] text-white hover:bg-[#1565C0] dark:border-[#90CAF9] dark:bg-[#90CAF9] dark:text-[#121212] dark:hover:bg-[#64B5F6]"
				>
					On
				</button>
			</form>
			<form method="POST" action="?/off">
				<button
					type="submit"
					disabled={!data.timing}
					class="{button} border-[#E0E0E0] text-[#212121] hover:bg-[#F5F5F5] dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Off
				</button>
			</form>
		</div>
	</div>
</main>
