<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Pending from the press until the answer is drawn. No field to keep.
	const submission = pendingSubmit({ reset: false });

	// Seconds before Send again does anything, counted from when the page or
	// the answer arrived here, as on `/forgot-password`. A signup starts the
	// wait. Without JavaScript the button stays enabled and the server answers
	// an early press the same way, sending nothing.
	let remaining = $state(0);
	$effect(() => {
		const wait = form ? form.wait : data.wait;
		remaining = wait;
		if (wait <= 0) {
			return;
		}
		const end = performance.now() + wait * 1000;
		const tick = setInterval(() => {
			remaining = Math.max(0, Math.ceil((end - performance.now()) / 1000));
			if (remaining === 0) {
				clearInterval(tick);
			}
		}, 250);
		return () => clearInterval(tick);
	});
</script>

<svelte:head><title>Check your inbox · Noteworthy</title></svelte:head>

<main
	class="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 dark:bg-[#121212]"
>
	<div
		class="w-full max-w-md rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
	>
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Check your inbox</h1>

		{#if data.email !== null}
			<!-- Words true whatever happened: a new account, one already in use, a failed send. -->
			<p class="mt-2 text-sm break-words text-[#616161] dark:text-[#9E9E9E]">
				If <strong class="font-medium text-[#212121] dark:text-[#F5F5F5]">{data.email}</strong> is new
				to Noteworthy, we’ve sent a link to confirm it. It can take a few minutes to arrive; check your
				spam folder too.
			</p>
			<p class="mt-3 text-sm text-[#616161] dark:text-[#9E9E9E]">
				Already have an account?
				<a
					href={resolve('/login')}
					class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]">Log in</a
				>, or
				<a
					href={resolve('/forgot-password')}
					class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]"
					>reset your password</a
				>.
			</p>

			<!-- Send again's answer is a toast: the action returns `notice`. -->
			<form method="POST" use:enhance={submission.submit} class="mt-6">
				<button
					type="submit"
					disabled={submission.pending || remaining > 0}
					class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
				>
					{#if submission.pending}
						Sending…
					{:else}
						Send again{remaining > 0 ? ` (${remaining} s)` : ''}
					{/if}
				</button>
			</form>

			<p class="mt-6 text-center text-sm text-[#616161] dark:text-[#9E9E9E]">
				If nothing arrives,
				<a
					href={resolve('/signup')}
					class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]">sign up again</a
				>.
			</p>
		{:else}
			<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
				Nothing is waiting to be confirmed in this browser. The address you signed up with is kept
				here for an hour.
			</p>
			<p class="mt-6 text-center text-sm text-[#616161] dark:text-[#9E9E9E]">
				<a
					href={resolve('/signup')}
					class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]">Sign up</a
				>
				or
				<a
					href={resolve('/login')}
					class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]">log in</a
				>
			</p>
		{/if}
	</div>
</main>
