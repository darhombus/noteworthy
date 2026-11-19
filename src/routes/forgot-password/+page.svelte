<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Pending from the press until the answer is drawn. The answer is a success,
	// so the field is kept rather than reset: it is what "Send again" sends.
	const submission = pendingSubmit({ reset: false });

	// Bound, not `value={…}`, and started from `form` once: see the login page.
	let email = $state(untrack(() => form?.values.email ?? ''));

	// Seconds before Send again does anything, counted from when the answer
	// arrived here, not by the server's clock. Without JavaScript the button
	// stays enabled and the server answers an early press the same way.
	let remaining = $state(0);
	$effect(() => {
		const wait = form?.sent ? form.wait : 0;
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

<svelte:head><title>Forgot password · Noteworthy</title></svelte:head>

<main
	class="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 dark:bg-[#121212]"
>
	<div
		class="w-full max-w-md rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
	>
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Forgot password</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			We’ll email you a link to choose a new one.
		</p>

		{#if form?.sent}
			<div
				role="status"
				class="mt-6 rounded-lg border border-[#1976D2] bg-[#1976D2]/5 px-3 py-2 text-sm text-[#1976D2] dark:border-[#90CAF9] dark:bg-[#1E3A5F] dark:text-[#90CAF9]"
			>
				<p>
					If an account exists for that address, a link to reset its password is on its way. It can
					take a few minutes to arrive. Check your spam folder too.
				</p>
				<p class="mt-2">Didn’t get it? You can ask again after a minute.</p>
			</div>
		{/if}

		<form method="POST" use:enhance={submission.submit} class="mt-6 space-y-5">
			<div>
				<label for="email" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Email
				</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					bind:value={email}
					aria-invalid={form?.errors.email ? 'true' : undefined}
					aria-describedby={form?.errors.email ? 'email-error' : undefined}
					class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				{#if form?.errors.email}
					<p id="email-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.email}
					</p>
				{/if}
			</div>

			<button
				type="submit"
				disabled={submission.pending || remaining > 0}
				class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
			>
				{#if submission.pending}
					Sending…
				{:else if form?.sent}
					Send again{remaining > 0 ? ` (${remaining} s)` : ''}
				{:else}
					Send reset link
				{/if}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-[#616161] dark:text-[#9E9E9E]">
			Remembered it?
			<a href={resolve('/login')} class="font-medium text-[#1976D2] hover:underline">Login</a>
		</p>
	</div>
</main>
