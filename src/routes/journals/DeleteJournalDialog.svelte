<script lang="ts">
	/**
	 * Confirming a delete.
	 *
	 * The wording is the part that matters. Deleting a journal is a soft delete
	 * and its entries go with it through the cascade in section 1. Until the
	 * Recycle Bin existed this said nothing could bring either back, because
	 * nothing in the app could; now the bin can, for 30 days, and this says so.
	 * Restoring the journal from there brings back the entries that went with
	 * it.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Journal } from '$lib/data/journals';
	import { readFormErrors, type JournalFormErrors } from '$lib/journals/form';

	let element: HTMLDialogElement;

	let journal = $state<Journal | null>(null);
	let errors = $state<JournalFormErrors>({});
	let deleting = $state(false);

	export function open(target: Journal): void {
		journal = target;
		errors = {};
		deleting = false;
		element.showModal();
	}

	const submit: SubmitFunction = () => {
		deleting = true;

		return async ({ result, update }) => {
			if (result.type === 'failure') {
				deleting = false;
				errors = readFormErrors(result.data);
				return;
			}

			// `deleting` stays set until the dialog has closed, as in
			// `JournalDialog.svelte`: `update()` waits for the list to reload, and
			// clearing it first put an enabled "Delete journal" back on screen for
			// that long, where a second press sent a second delete.
			await update({ reset: false });

			if (result.type === 'success') {
				element.close();
			}
			deleting = false;
		};
	};

	let entries = $derived(
		journal === null || journal.entry_count === 1 ? '1 entry' : `${journal.entry_count} entries`
	);
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
	{#if journal}
		<form method="POST" action="?/delete" use:enhance={submit} class="p-6">
			<input type="hidden" name="journal_id" value={journal.journal_id} />

			<h2 class="text-lg font-semibold text-[#212121] dark:text-[#F5F5F5]">
				Delete “{journal.title}”?
			</h2>

			<p class="mt-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
				{#if journal.entry_count > 0}
					Its {entries} will be deleted with it. You can restore them from the Recycle Bin for 30 days.
				{:else}
					It has no entries. You can restore it from the Recycle Bin for 30 days.
				{/if}
			</p>

			{#if errors.form}
				<p
					role="alert"
					class="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
				>
					{errors.form}
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
					{deleting ? 'Deleting…' : 'Delete journal'}
				</button>
			</div>
		</form>
	{/if}
</dialog>
