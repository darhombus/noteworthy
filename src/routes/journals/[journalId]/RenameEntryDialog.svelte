<script lang="ts">
	/**
	 * Renaming an entry from the journal's list. The title only: the form posts
	 * the entry's id and the new title, and `?/rename` writes that one column.
	 *
	 * Opened the way the journal list opens its dialogs, by calling `open()` on
	 * the instance. The dialog owns the field and its errors.
	 *
	 * The frame is the journal dialog's, class for class: see THE PATTERN in
	 * `JournalDialog.svelte`. One field never outgrows a window, but a long error
	 * above it at 320px can, and the pattern is what keeps Save on screen then.
	 *
	 * Enter saves because the field sits in the form with a submit button
	 * (implicit submission). Escape cancels because it is a modal `<dialog>`,
	 * which closes itself on Escape. Neither needs a handler of its own.
	 *
	 * ---------------------------------------------------------------------------
	 * A RENAME IS NEVER LOST QUIETLY
	 * ---------------------------------------------------------------------------
	 * Every way a save can fail leaves the dialog open, holding what was typed,
	 * and says so:
	 *
	 * - the action refuses it (`failure`): its message, under the field or at
	 *   the top;
	 * - the request never completes, or the action throws (`error`): a message
	 *   of this dialog's own. `update()` is deliberately not called there,
	 *   because for an `error` it renders the error page, which would take the
	 *   dialog and the typing with it;
	 * - Escape or Cancel while the save is in flight closes the dialog early, so
	 *   a failure that comes back after that opens it again rather than setting
	 *   an error nobody can see.
	 *
	 * With no JavaScript the menu that opens this does nothing, as on the
	 * journal cards; the edit page still changes the title.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import type { Entry } from '$lib/data/entries';
	import { postSaved } from '$lib/entries/broadcast';
	import { MAX_TITLE, type RenameErrors } from '$lib/entries/edit';
	import { refreshInPlace } from '$lib/navigation/refresh-in-place';

	const id = $props.id();

	let element: HTMLDialogElement;
	let input: HTMLInputElement;

	let entryId = $state('');
	let title = $state('');
	let errors = $state<RenameErrors>({});
	let saving = $state(false);

	/**
	 * The title as the dialog opened with it. Differing from it keeps the
	 * dialog open on a click outside (`$lib/dialog/outside`); typed and put
	 * back is no change.
	 */
	let opened = $state('');
	let changed = $derived(title !== opened);

	/** Opens on an entry, with its title selected so typing replaces it. */
	export async function open(entry: Entry): Promise<void> {
		entryId = entry.entry_id;
		title = entry.title ?? '';
		opened = title;
		errors = {};
		saving = false;
		// The field's value is written on the next flush. Selecting before it
		// lands would select the previous entry's title, and the write that
		// follows would drop the selection.
		await tick();
		element.showModal();
		input.select();
	}

	function readErrors(data: Record<string, unknown> | undefined): RenameErrors {
		const raw = data?.errors;
		if (typeof raw !== 'object' || raw === null) {
			return { form: 'Could not rename the entry. Try again.' };
		}
		const { title, form } = raw as Record<string, unknown>;
		return {
			title: typeof title === 'string' ? title : undefined,
			form: typeof form === 'string' ? form : undefined
		};
	}

	/** Back on screen if it was closed while the save was out; see above. */
	function showAgain(): void {
		if (!element.open) {
			element.showModal();
		}
	}

	const submit: SubmitFunction = () => {
		saving = true;
		errors = {};

		return async ({ result, update }) => {
			if (result.type === 'failure') {
				saving = false;
				errors = readErrors(result.data);
				showAgain();
				return;
			}
			if (result.type === 'error') {
				saving = false;
				errors = { form: 'Could not rename the entry. Check the connection and try again.' };
				showAgain();
				return;
			}

			// An edit page open on this entry in another tab learns at once, before
			// anything is typed there (`$lib/entries/broadcast`).
			if (result.type === 'success') {
				const renamed = (result.data as { renamed?: { entryId?: unknown; revision?: unknown } })
					?.renamed;
				if (typeof renamed?.entryId === 'string' && typeof renamed.revision === 'number') {
					postSaved({ entryId: renamed.entryId, revision: renamed.revision, saveId: null });
				}
			}

			// `invalidateAll` re-runs the page's load, which is how the list shows
			// the new title without a reload. `reset: false` for the reason given in
			// `JournalDialog.svelte`: the field is bound to state.
			//
			// `saving` stays set until the dialog has closed. `update()` waits for
			// that load, a round trip to the database, and clearing it before, as
			// this once did, put "Save" back on an enabled button for that long:
			// the label flickered, and a second press sent a second rename.
			//
			// In place, as in `JournalDialog.svelte`: the title is saved by now, and
			// a connection that drops before the list reloads must not take the
			// page with it. The list catches up once the connection is back.
			await refreshInPlace(() => update({ reset: false }));

			if (result.type === 'success') {
				element.close();
			}
			saving = false;
		};
	};
</script>

<dialog
	bind:this={element}
	aria-labelledby="{id}-heading"
	data-unsaved={changed || undefined}
	data-saving={saving || undefined}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 open:flex dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	<form method="POST" action="?/rename" use:enhance={submit} class="flex min-h-0 flex-1 flex-col">
		<input type="hidden" name="entry_id" value={entryId} />

		<div class="shrink-0 border-b border-[#E0E0E0] px-6 pt-5 pb-4 dark:border-[#3A3A3A]">
			<h2 id="{id}-heading" class="text-lg font-semibold text-[#212121] dark:text-[#F5F5F5]">
				Rename entry
			</h2>

			{#if errors.form}
				<p
					role="alert"
					class="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
				>
					{errors.form}
				</p>
			{/if}
		</div>

		<div
			data-dialog-body
			class="min-h-0 scrollbar-app flex-1 overflow-y-auto overscroll-contain px-6 py-4"
		>
			<label for="{id}-title" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
				Title <span class="font-normal text-[#616161] dark:text-[#9E9E9E]">(optional)</span>
			</label>
			<!--
				`maxlength` stops typing at the limit, so a title is never refused on
				save for its length. It counts the untrimmed value, which can only
				stop somebody early, never let too much through; the action checks
				again after trimming, for a request that did not come from here.
			-->
			<input
				bind:this={input}
				id="{id}-title"
				name="title"
				type="text"
				maxlength={MAX_TITLE}
				autocomplete="off"
				bind:value={title}
				aria-invalid={errors.title ? 'true' : undefined}
				aria-describedby="{id}-hint{errors.title ? ` ${id}-error` : ''}"
				class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
			/>
			<p id="{id}-hint" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
				Left blank, the entry is shown as Untitled.
			</p>
			{#if errors.title}
				<p id="{id}-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
					{errors.title}
				</p>
			{/if}
		</div>

		<div
			class="flex shrink-0 justify-end gap-2 border-t border-[#E0E0E0] px-6 py-3 dark:border-[#3A3A3A]"
		>
			<button
				type="button"
				onclick={() => element.close()}
				class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
			>
				Cancel
			</button>
			<button
				type="submit"
				disabled={saving}
				class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 disabled:opacity-60"
			>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</form>
</dialog>
