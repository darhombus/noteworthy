<script lang="ts">
	/**
	 * Confirming the delete of the entry currently being read.
	 *
	 * Delete lives here and not on the journal's list, deliberately. From the read
	 * view the thing being deleted is on screen — the title, the date and the
	 * words — so the confirmation is a second look at something already in front
	 * of you. A delete button on a list row asks somebody to be sure about a
	 * title and an excerpt, which is the same gesture with less to go on and a
	 * neighbouring row one pixel away.
	 *
	 * The page opens it from its actions menu, through `open()`, as the journal
	 * list opens its dialogs.
	 *
	 * The wording says what is true: the row stays for thirty days, and the
	 * Recycle Bin can restore it until then.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { readFormErrors } from '$lib/journals/form';

	let { title }: { title: string } = $props();

	let element: HTMLDialogElement;
	let deleting = $state(false);
	let message = $state<string | null>(null);

	export function open(): void {
		deleting = false;
		message = null;
		element.showModal();
	}

	// No `update()` and no close on success: the action redirects to the
	// journal, so this component goes away with the page. A refusal is said
	// here, in the dialog, as the other dialogs say theirs: `update()` would put
	// it in the page's `form`, which the page never reads, and it was lost.
	const submit: SubmitFunction = () => {
		deleting = true;
		message = null;
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				deleting = false;
				message = readFormErrors(result.data).form ?? 'Could not delete the entry. Try again.';
				return;
			}
			await update();
			deleting = false;
		};
	};
</script>

<!--
	`m-auto` centres it — see the note in JournalDialog.svelte. Nothing unsaved
	here, so a click outside closes it (`$lib/dialog/outside`), except while the
	delete is in flight: the dialog is still needed then to show a refusal.
-->
<dialog
	bind:this={element}
	data-saving={deleting || undefined}
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	<form method="POST" action="?/delete" use:enhance={submit} class="p-6">
		<h2 class="text-lg font-semibold text-[#212121] dark:text-[#F5F5F5]">
			Delete “{title}”?
		</h2>

		<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
			You can restore it from the Recycle Bin for 30 days.
		</p>

		{#if message}
			<p
				role="alert"
				class="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				{message}
			</p>
		{/if}

		<div class="mt-6 flex justify-end gap-2">
			<button
				type="button"
				onclick={() => element.close()}
				class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={deleting}
				class="rounded-lg bg-[#C62828] px-4 py-2 text-sm font-medium text-white hover:bg-[#AD1F1F] focus-visible:ring-2 focus-visible:ring-[#C62828]/40 disabled:opacity-60"
			>
				{deleting ? 'Deleting…' : 'Delete entry'}
			</button>
		</div>
	</form>
</dialog>
