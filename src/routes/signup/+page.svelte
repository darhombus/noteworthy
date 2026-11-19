<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import KeepSignedIn from '$lib/components/KeepSignedIn.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Pending from the press until the next page is on screen: see `pendingSubmit`.
	const submission = pendingSubmit();

	// Bound, not `value={…}`, and started from `form` once: see the login page.
	let fullName = $state(untrack(() => form?.values.fullName ?? ''));
	let email = $state(untrack(() => form?.values.email ?? ''));
	let remember = $state(untrack(() => form?.values.remember ?? false));
</script>

<svelte:head><title>Create your account · Noteworthy</title></svelte:head>

<main
	class="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 dark:bg-[#121212]"
>
	<div
		class="w-full max-w-md rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
	>
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Create your account</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			Somewhere to keep your journals in one place.
		</p>

		<form method="POST" use:enhance={submission.submit} class="mt-6 space-y-5">
			<div>
				<label for="fullName" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Display name
				</label>
				<input
					id="fullName"
					name="fullName"
					type="text"
					autocomplete="name"
					required
					bind:value={fullName}
					aria-invalid={form?.errors.fullName ? 'true' : undefined}
					aria-describedby={form?.errors.fullName ? 'fullName-error' : undefined}
					class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				{#if form?.errors.fullName}
					<p id="fullName-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.fullName}
					</p>
				{/if}
			</div>

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

			<div>
				<label for="password" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Password
				</label>
				<PasswordField
					id="password"
					name="password"
					autocomplete="new-password"
					minlength={6}
					invalid={Boolean(form?.errors.password)}
					describedby={form?.errors.password ? 'password-error' : 'password-hint'}
				/>
				{#if form?.errors.password}
					<p id="password-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.password}
					</p>
				{:else}
					<p id="password-hint" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
						At least 6 characters.
					</p>
				{/if}
			</div>

			<KeepSignedIn bind:checked={remember} />

			<button
				type="submit"
				disabled={submission.pending}
				class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
			>
				{submission.pending ? 'Creating account…' : 'Create account'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-[#616161] dark:text-[#9E9E9E]">
			Already have an account?
			<a href={resolve('/login')} class="font-medium text-[#1976D2] hover:underline">Login</a>
		</p>
	</div>
</main>
