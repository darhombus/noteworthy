<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Pending from the press until the next page is on screen.
	const submission = pendingSubmit();

	let expired = $derived(!data.usable || Boolean(form?.expired));
	let signup = $derived(data.type === 'signup');
</script>

<svelte:head>
	<title>{signup ? 'Confirm your email' : 'Reset your password'} · Noteworthy</title>
</svelte:head>

<!-- Inside the layout's bare column (`BareHeader` above), which has the page's background. -->
<main class="flex flex-1 items-center justify-center px-4 py-12">
	<div
		class="w-full max-w-md rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
	>
		{#if expired}
			<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
				This link has expired
			</h1>
			{#if signup}
				<!-- A used link has confirmed the address already, and logging in works; an
				     unconfirmed one's login offers Send again. -->
				<p role="alert" class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					It may have been used already, or be more than an hour old. Log in: if the address still
					needs confirming, you can ask for a new link there. Use the newest email.
				</p>
				<a
					href={data.signedIn ? resolve('/journals') : resolve('/login')}
					class="mt-6 block w-full rounded-lg bg-[#1976D2] px-4 py-2.5 text-center font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40"
				>
					{data.signedIn ? 'Go to your journals' : 'Log in'}
				</a>
			{:else}
				<p role="alert" class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					It may have been used already, or be more than an hour old. Ask for a new one and use the
					newest email.
				</p>
				<a
					href={data.signedIn ? resolve('/reset-password') : resolve('/forgot-password')}
					class="mt-6 block w-full rounded-lg bg-[#1976D2] px-4 py-2.5 text-center font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40"
				>
					Ask for a new link
				</a>
			{/if}
		{:else}
			<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
				{signup ? 'Confirm your email' : 'Reset your password'}
			</h1>
			<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
				{signup
					? 'Continue to finish creating your account.'
					: 'Continue to choose a new password.'}
			</p>
			<!-- No `action`: it posts to this address, which holds the token. -->
			<form method="POST" use:enhance={submission.submit} class="mt-6">
				<button
					type="submit"
					disabled={submission.pending}
					class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
				>
					{submission.pending ? 'Checking…' : 'Continue'}
				</button>
			</form>
		{/if}
	</div>
</main>
