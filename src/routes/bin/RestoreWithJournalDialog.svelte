<script lang="ts">
	/**
	 * Confirming a restore that brings back more than the row it was asked of:
	 * an entry whose journal is in the bin too. An entry cannot be live in a
	 * deleted journal, so `restore_entry()` restores the journal and the entries
	 * that went down with it as well, and this says so first, with the count.
	 * Entries deleted from that journal on their own stay in the bin.
	 *
	 * Every other restore goes ahead without asking. It is the undo of a delete
	 * and is itself undone by deleting again.
	 *
	 * Nothing unsaved here, so a click outside closes it (`$lib/dialog/outside`),
	 * except while the restore is in flight, when the dialog is still needed to
	 * show a refusal.
	 */
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { entryTitle, restoreWithJournalText, type EntryRow } from '$lib/bin/rows';

	let { onrestored }: { onrestored: (row: EntryRow) => void } = $props();

	let element: HTMLDialogElement;

	let row = $state<EntryRow | null>(null);
	let message = $state<string | null>(null);
	let restoring = $state(false);

	export function open(target: EntryRow): void {
		row = target;
		message = null;
		restoring = false;
		element.showModal();
	}

	const submit: SubmitFunction = () => {
		restoring = true;
		const target = row;

		return async ({ result, update }) => {
			if (result.type === 'failure') {
				// A refusal still reloads the list: "no longer in the bin" is only
				// worth saying if the row goes too. `update()` would not: it reloads
				// after a success only.
				await invalidateAll();
				restoring = false;
				message =
					typeof result.data?.message === 'string' ? result.data.message : 'Couldn’t restore it.';
				return;
			}
			if (result.type === 'error') {
				restoring = false;
				message = 'Couldn’t reach the server. Check your connection, then try again.';
				return;
			}

			// Still "Restoring…" until the list has reloaded without the row, as in
			// the delete dialogs, so a second press cannot send a second restore.
			await update({ reset: false });
			if (result.type === 'success' && target !== null) {
				element.close();
				onrestored(target);
			}
			restoring = false;
		};
	};
</script>

<dialog
	bind:this={element}
	data-saving={restoring || undefined}
	aria-labelledby="restore-with-journal-title"
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	{#if row}
		<form method="POST" action="?/restore" use:enhance={submit} class="p-6">
			<input type="hidden" name="kind" value="entry" />
			<input type="hidden" name="id" value={row.id} />

			<h2
				id="restore-with-journal-title"
				class="text-lg font-semibold wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
			>
				Restore “{entryTitle(row.title)}” with its journal?
			</h2>

			<p class="mt-2 text-sm wrap-anywhere text-[#616161] dark:text-[#9E9E9E]">
				{restoreWithJournalText(row)}
			</p>

			{#if message}
				<p
					role="alert"
					class="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
				>
					{message}
				</p>
			{/if}

			<div class="mt-6 flex flex-wrap justify-end gap-2">
				<button
					type="button"
					onclick={() => element.close()}
					class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={restoring}
					class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 disabled:opacity-60"
				>
					{restoring ? 'Restoring…' : 'Restore with journal'}
				</button>
			</div>
		</form>
	{/if}
</dialog>
