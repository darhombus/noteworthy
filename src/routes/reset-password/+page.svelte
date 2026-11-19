<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { pendingSubmit } from '$lib/auth/pending.svelte';
	import PasswordField from '$lib/components/PasswordField.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Pending from the press until the next page is on screen.
	const saving = pendingSubmit();
	// "Email me a new link" answers with a success; nothing to reset.
	const resending = pendingSubmit({ reset: false });

	let expired = $derived(!data.allowed || Boolean(form?.expired));
</script>

<svelte:head>
	<title>{data.choosing ? 'Choose your password' : 'Choose a new password'} · Noteworthy</title>
</svelte:head>

<!-- Inside the layout's bare column (`BareHeader` above), laid out as the login page is. -->
<main class="flex flex-1 items-center justify-center px-4 py-12">
	<div class="w-full max-w-md">
		<div
			class="rounded-xl border border-[#E0E0E0] bg-white p-8 shadow-sm dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			{#if expired}
				<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
					This link has expired
				</h1>
				<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
					A password can be changed here for 15 minutes after following the link in a reset email.
					Ask for a new one.
				</p>
				<!-- Its answer is a toast: the action returns `notice`. -->
				<form method="POST" action="?/resend" use:enhance={resending.submit} class="mt-6">
					<button
						type="submit"
						disabled={resending.pending}
						class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
					>
						{resending.pending ? 'Sending…' : 'Email me a new link'}
					</button>
				</form>
				{#if !data.choosing}
					<!-- Signed in as usual, with nothing to choose: the way back in. Never
					     while choosing, where the hook would only send them back here. -->
					<p class="mt-6 text-center text-sm">
						<a
							href={resolve('/journals')}
							class="font-medium text-[#1976D2] hover:underline dark:text-[#90CAF9]"
						>
							Go to your journals
						</a>
					</p>
				{/if}
			{:else}
				{#if data.choosing}
					<!-- Sent here by a signup link: the address was signed up more than once. -->
					<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
						Choose your password
					</h1>
					<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
						Your email is confirmed. This address was signed up more than once, so choose the
						password you’ll log in with. The one you signed up with is fine.
					</p>
				{:else}
					<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">
						Choose a new password
					</h1>
					<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
						Your other devices will be signed out.
					</p>
				{/if}

				{#if form?.errors.form}
					<p
						role="alert"
						class="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
					>
						{form.errors.form}
					</p>
				{/if}

				<form method="POST" action="?/save" use:enhance={saving.submit} class="mt-6 space-y-5">
					<div>
						<label
							for="password"
							class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]"
						>
							New password
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

					<button
						type="submit"
						disabled={saving.pending}
						class="w-full rounded-lg bg-[#1976D2] px-4 py-2.5 font-medium text-white hover:bg-[#1565C0] focus:ring-2 focus:ring-[#1976D2]/40 disabled:cursor-wait disabled:opacity-70 disabled:hover:bg-[#1976D2] dark:disabled:opacity-60"
					>
						{saving.pending ? 'Saving…' : 'Save password'}
					</button>
				</form>
			{/if}
		</div>
	</div>
</main>
