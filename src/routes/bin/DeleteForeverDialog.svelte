<script lang="ts">
	/**
	 * Confirming a delete for good: an entry or a journal from its menu, a
	 * waiting file's Delete now, or Empty bin. One dialog for the four, because
	 * they differ only in what they say and which action they post to.
	 *
	 * It names what goes and says it can't be undone (`$lib/bin/forever` has the
	 * words). Focus starts on Cancel, never on the button that deletes: a
	 * keyboard user who opened it by mistake, or pressed Enter once too often,
	 * lands on the harmless choice.
	 *
	 * ---------------------------------------------------------------------------
	 * ONE REQUEST
	 * ---------------------------------------------------------------------------
	 * From the press until the list has reloaded, the button reads "Deleting…",
	 * is disabled, and a second submit is cancelled before it is sent: two taps
	 * send one request. Two tabs can still send two; the second finds nothing to
	 * delete, and the action answers `gone` rather than an error (see
	 * `+page.server.ts`).
	 *
	 * After an answer that changed anything, it invalidates the bin's list and
	 * `STORAGE_USAGE`, so the sidebar's bar shows the freed space without a
	 * reload. Nothing else is reloaded. (The editor measures the figure instead:
	 * see `$lib/media/usage-measured.svelte`. Here the refresh follows an answer
	 * the server has just given, so a dropped connection is the narrower risk.)
	 *
	 * Nothing unsaved here, so a click outside closes it (`$lib/dialog/outside`),
	 * except while the request is in flight, when the dialog is still needed to
	 * show a refusal.
	 */
	import { applyAction, enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { flushSync } from 'svelte';
	import {
		CANT_UNDO,
		clearDetail,
		clearQuestion,
		deleteQuestion,
		emptyBinQuestion,
		isDeleted,
		journalGoes,
		type Deleted,
		type ForeverTarget
	} from '$lib/bin/forever';
	import { BIN_CONTENTS, entryTitle } from '$lib/bin/rows';
	import { STORAGE_USAGE } from '$lib/media/usage';

	let { onfinished }: { onfinished: (target: ForeverTarget, result: Deleted) => void } = $props();

	let element: HTMLDialogElement;
	let keep = $state<HTMLButtonElement | null>(null);

	let target = $state.raw<ForeverTarget | null>(null);
	let message = $state<string | null>(null);
	let deleting = $state(false);

	export function open(next: ForeverTarget): void {
		flushSync(() => {
			target = next;
			message = null;
			deleting = false;
		});
		element.showModal();
		keep?.focus();
	}

	const ACTION = {
		entry: '?/deleteForever',
		journal: '?/deleteForever',
		file: '?/clearFile',
		bin: '?/emptyBin'
	} as const;

	let heading = $derived.by(() => {
		if (target === null) {
			return '';
		}
		switch (target.kind) {
			case 'entry':
				return deleteQuestion(entryTitle(target.row.title));
			case 'journal':
				return deleteQuestion(target.row.title);
			case 'file':
				return clearQuestion(target.row);
			case 'bin':
				return emptyBinQuestion(target.summary);
		}
	});

	let detail = $derived.by(() => {
		if (target === null) {
			return '';
		}
		switch (target.kind) {
			case 'journal':
				return journalGoes(target.row, target.separately);
			case 'file':
				return clearDetail(target.row);
			default:
				return CANT_UNDO;
		}
	});

	let label = $derived(
		target?.kind === 'file'
			? 'Delete now'
			: target?.kind === 'bin'
				? 'Empty bin'
				: 'Delete permanently'
	);

	const submit: SubmitFunction = ({ cancel }) => {
		if (deleting || target === null) {
			cancel();
			return;
		}
		deleting = true;
		message = null;
		const current = target;

		return async ({ result }) => {
			if (result.type === 'success' && isDeleted(result.data)) {
				// Still "Deleting…" until the list has reloaded without the row.
				await Promise.all([invalidate(BIN_CONTENTS), invalidate(STORAGE_USAGE)]);
				element.close();
				deleting = false;
				onfinished(current, result.data);
				return;
			}
			deleting = false;
			if (result.type === 'redirect') {
				await applyAction(result);
			} else if (result.type === 'failure') {
				message =
					typeof result.data?.message === 'string' ? result.data.message : 'Couldn’t delete it.';
			} else {
				message = 'Couldn’t reach the server. Check your connection, then try again.';
			}
		};
	};
</script>

<dialog
	bind:this={element}
	data-saving={deleting || undefined}
	aria-labelledby="delete-forever-title"
	aria-describedby="delete-forever-detail"
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	{#if target}
		<form method="POST" action={ACTION[target.kind]} use:enhance={submit} class="p-6">
			{#if target.kind === 'entry' || target.kind === 'journal'}
				<input type="hidden" name="kind" value={target.kind} />
				<input type="hidden" name="id" value={target.row.id} />
			{:else if target.kind === 'file'}
				<input type="hidden" name="path" value={target.row.path} />
			{/if}

			<h2
				id="delete-forever-title"
				class="text-lg font-semibold wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
			>
				{heading}
			</h2>

			<p
				id="delete-forever-detail"
				class="mt-2 text-sm wrap-anywhere text-[#616161] dark:text-[#9E9E9E]"
			>
				{detail}
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
					bind:this={keep}
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
					{deleting ? (target.kind === 'bin' ? 'Emptying…' : 'Deleting…') : label}
				</button>
			</div>
		</form>
	{/if}
</dialog>
