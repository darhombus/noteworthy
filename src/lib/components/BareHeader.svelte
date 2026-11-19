<script lang="ts">
	/**
	 * The top of a page drawn without the shell (`page.data.bare`): the app's
	 * name, and Log out for somebody signed in. Nothing else, so it offers no
	 * navigation: the name is text, not a link to the journals.
	 *
	 * Log out is the shell's own: a plain form POST to `/logout`, no
	 * `use:enhance`, so it works without JavaScript and ends the document it was
	 * pressed in ("A page that outlived its session").
	 */
	let { signedIn }: { signedIn: boolean } = $props();
</script>

<header class="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
	<span class="font-semibold text-[#212121] dark:text-[#F5F5F5]">Noteworthy</span>
	{#if signedIn}
		<form method="POST" action="/logout">
			<button
				type="submit"
				class="rounded-lg border border-[#E0E0E0] px-3 py-1.5 text-sm text-[#212121] hover:bg-[#E0E0E0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#3A3A3A]"
			>
				Log out
			</button>
		</form>
	{/if}
</header>
