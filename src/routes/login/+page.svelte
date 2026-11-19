<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import KeepSignedIn from '$lib/components/KeepSignedIn.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import { NOTICES } from '$lib/toast/notices';
	import { success } from '$lib/toast/toasts.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();

	// Pending from the press until the next page is on screen: see `pendingSubmit`.
	// A refused attempt empties the password; the email is kept.
	const submission = pendingSubmit({ clearOnFailure: ['password'] });

	// Send again, for an address not confirmed yet: answered on "Check your
	// inbox", which reads the address from the cookie this refusal set. The
	// answer is that page's own toast, put in the store once the page is there
	// (`goto` does not carry `form`). Made before, it would be `/login`'s, and
	// cleared as `/login` is left (`$lib/toast/toasts.svelte`, `leavePage`).
	// Without JavaScript the server draws it from the action's `notice`.
	const resending = pendingSubmit({
		reset: false,
		onSuccess: async () => {
			await goto(resolve('/signup/check-inbox'));
			// Only on that page, beside the words it answers to: not after a
			// redirect elsewhere on the way.
			if (page.url.pathname === resolve('/signup/check-inbox')) {
				success(NOTICES['confirm-sent-again'].text);
			}
		}
	});

	// Bound rather than `value={…}`. Svelte puts every expression in this template
	// into one effect, so `value={form?.values.email ?? ''}` was written again
	// whenever `submission.pending` changed, and after hydration its cached value
	// is `null` (removing the server's `value` attribute resets it), so that
	// write put `''` over what was typed: the email emptied at the press, and
	// stayed empty while "Logging in…" waited for the journals page. Started
	// from `form` once, so the server renders the echo of a form posted without
	// JavaScript, and never recomputed: a `$derived` of `form` wrote the echo
	// back when a refusal landed, over anything typed while it was out.
	let email = $state(untrack(() => form?.values.email ?? ''));
	// The same rule for the box: `bind:checked`, never `checked={…}`. Unticked
	// unless a refused attempt echoes it back ticked.
	let remember = $state(untrack(() => form?.values.remember ?? false));
</script>

<svelte:head><title>Login · Noteworthy</title></svelte:head>

{#snippet forgot(layout: string)}
	<a
		href={resolve('/forgot-password')}
		class="{layout} min-h-10 items-center text-sm font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]"
	>
		Forgot password?
	</a>
{/snippet}

<main
	class="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-4 py-12 dark:bg-[#121212]"
>
	<div
		class="w-full max-w-md rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
	>
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Welcome back</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">Login to your journals.</p>

		{#if form?.errors.form}
			<p
				role="alert"
				class="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				{form.errors.form}
			</p>
			{#if form.unconfirmed}
				<!-- Its own form, before the login one: a second submit inside that one
				     would post the password too. -->
				<form
					method="POST"
					action={resolve('/signup/check-inbox')}
					use:enhance={resending.submit}
					class="mt-3"
				>
					<button
						type="submit"
						disabled={resending.pending}
						class="w-full rounded-lg border border-[#1976D2] px-4 py-2 font-medium text-[#1976D2] hover:bg-[#1976D2]/5 focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 dark:border-[#90CAF9] dark:text-[#90CAF9] dark:hover:bg-[#1E3A5F]"
					>
						{resending.pending ? 'Sending…' : 'Send again'}
					</button>
				</form>
			{/if}
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

			<div>
				<label for="password" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Password
				</label>
				<PasswordField
					id="password"
					name="password"
					autocomplete="current-password"
					invalid={Boolean(form?.errors.password)}
					describedby={form?.errors.password ? 'password-error' : undefined}
				/>
				{#if form?.errors.password}
					<p id="password-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.password}
					</p>
				{/if}
			</div>

			<!-- "Forgot password?" is drawn twice, one copy per layout, so the Tab order
			     follows what is on screen at each width (no single DOM order can): below
			     `sm` it is above "Remember me", from `sm` at the end of its row. The
			     other copy is `display: none`, out of the Tab order and the
			     accessibility tree. One snippet, so the two cannot drift apart. -->
			<div class="-mt-4 sm:mt-0">
				{@render forgot('ml-auto flex w-fit sm:hidden')}
				<KeepSignedIn bind:checked={remember}>
					{#snippet end()}
						{@render forgot('ml-auto hidden sm:inline-flex')}
					{/snippet}
				</KeepSignedIn>
			</div>

			<button
				type="submit"
				disabled={submission.pending}
				class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
			>
				{submission.pending ? 'Logging in…' : 'Login'}
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-[#616161] dark:text-[#9E9E9E]">
			No account yet?
			<a href={resolve('/signup')} class="font-medium text-[#1976D2] hover:underline">Create one</a>
		</p>
	</div>
</main>
