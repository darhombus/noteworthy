<script lang="ts">
	/**
	 * The public landing page.
	 *
	 * It renders without the shell, and nothing here arranges that. The layout
	 * shows the sidebar only when `data.shellUser` is set, which follows
	 * `locals.user`; an anonymous visitor has neither. A signed-in one never
	 * arrives, because `hooks.server.ts` lists `/` alongside `/login` and
	 * `/signup` and sends them to `APP_HOME`. Two facts, one consequence — and
	 * the redirect is the half that is load-bearing, so it is covered by a test
	 * rather than left to hold on its own.
	 *
	 * The mark is the same `book` icon the sidebar and the journal cards use.
	 * There is no separate logo asset, and inventing one here would put a second
	 * visual identity in the app for the sake of one screen.
	 */
	import { resolve } from '$app/paths';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
</script>

<svelte:head>
	<title>Noteworthy</title>
	<meta name="description" content="Your private space to think, reflect and grow." />
</svelte:head>

<main
	class="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 dark:bg-[#121212]"
>
	<div class="w-full max-w-md text-center">
		<span
			class="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1976D2] text-white"
		>
			<JournalIcon icon="book" class="h-8 w-8" />
		</span>

		<h1 class="mt-6 text-3xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Noteworthy</h1>

		<p class="mt-3 text-[#616161] dark:text-[#9E9E9E]">
			Your private space to think, reflect and grow
		</p>

		<div class="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
			<a
				href={resolve('/signup')}
				class="rounded-lg bg-[#1976D2] px-5 py-2.5 font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
			>
				Get started
			</a>
			<a
				href={resolve('/login')}
				class="rounded-lg border border-[#E0E0E0] bg-white px-5 py-2.5 font-medium text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
			>
				Log in
			</a>
		</div>
	</div>
</main>
