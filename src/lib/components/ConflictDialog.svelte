<script lang="ts">
	/**
	 * "This entry changed somewhere else": the two choices an entry page offers
	 * when it learns its entry was saved elsewhere (`$lib/entries/conflict.svelte`).
	 *
	 * A modal `<dialog>` like the app's others ("Menus and dialogs"), except that
	 * nothing dismisses it: either a choice is made, or the page is left.
	 *
	 * - Escape does nothing. Its `keydown` is prevented, which stops the close
	 *   request being made at all (measured in Chromium, Firefox and WebKit).
	 * - A tap outside does nothing: `data-unsaved`, always, so
	 *   `$lib/dialog/outside` leaves it open. It does hold unsaved work.
	 * - Any other close (Android's Back, `requestClose()`, a close watcher) is
	 *   Back, and means leaving the page: `conflict.leave` asks what leaving asks
	 *   and takes the step back. The dialog is shown again either way, so the page
	 *   is never there without it: staying, until a choice; leaving, until the
	 *   page goes. `cancel` is not refused, since a refused Back would leave the
	 *   person unable to go back at all. See ANY OTHER CLOSE IS BACK in
	 *   `$lib/entries/conflict.svelte`.
	 *
	 * Neither choice has focus when it opens; the heading does, so a screen reader
	 * starts at the question and a stray Enter chooses nothing. And nothing has
	 * focus when it closes: a closing modal dialog puts focus back on what had it
	 * when it opened, and that was the editor, which on a phone opens the
	 * keyboard (seen between each Back and the reopening). So focus is taken off
	 * whatever has it before `showModal`, and there is nothing to put back.
	 */
	import type { EntryConflict } from '$lib/entries/conflict.svelte';

	let { conflict }: { conflict: EntryConflict } = $props();

	const id = $props.id();

	let element = $state<HTMLDialogElement | null>(null);
	let heading = $state<HTMLHeadingElement | null>(null);

	function showIt(): void {
		if (element === null || element.open) {
			return;
		}
		// See the last paragraph above: nothing to put focus back on.
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		element.showModal();
		// `showModal` already focuses the first focusable element in tree order,
		// which is the heading (`tabindex="-1"`). Said again, so it holds if
		// anything focusable is ever put above it.
		heading?.focus();
	}

	$effect(() => {
		if (conflict.open) {
			showIt();
		} else if (element?.open) {
			element.close();
		}
	});

	function holdEscape(event: KeyboardEvent): void {
		if (conflict.open && event.key === 'Escape') {
			event.preventDefault();
		}
	}
</script>

<svelte:window onkeydowncapture={holdEscape} />

<dialog
	bind:this={element}
	aria-labelledby="{id}-heading"
	aria-describedby="{id}-text"
	data-unsaved
	onclose={() => {
		// A choice sets `open` to false before closing it; anything else is Back.
		if (conflict.open) {
			conflict.leave();
			showIt();
		}
	}}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 open:flex dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	<div class="shrink-0 border-b border-[#E0E0E0] px-6 pt-5 pb-4 dark:border-[#3A3A3A]">
		<h2
			bind:this={heading}
			id="{id}-heading"
			tabindex="-1"
			class="text-lg font-semibold text-[#212121] focus:outline-none dark:text-[#F5F5F5]"
		>
			This entry changed somewhere else
		</h2>
		<p id="{id}-text" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			It was saved in another tab or on another device after this page loaded.
		</p>
	</div>

	<div
		data-dialog-body
		class="min-h-0 scrollbar-app flex-1 overflow-y-auto overscroll-contain px-6 py-4"
		aria-busy={conflict.busy || undefined}
	>
		{#if conflict.problem}
			<p
				role="alert"
				class="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				{conflict.problem}
			</p>
		{/if}

		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<button
					type="button"
					disabled={conflict.busy}
					aria-describedby="{id}-saved"
					onclick={() => void conflict.useSaved()}
					class="min-h-11 w-full rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm font-medium text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 disabled:opacity-60 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Use the saved version
				</button>
				<p id="{id}-saved" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
					This tab's changes are discarded.
				</p>
			</div>
			<div>
				<button
					type="button"
					disabled={conflict.busy}
					aria-describedby="{id}-kept"
					onclick={() => void conflict.keep()}
					class="min-h-11 w-full rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm font-medium text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 disabled:opacity-60 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Keep this tab's version
				</button>
				<p id="{id}-kept" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
					The other changes are replaced.
				</p>
			</div>
		</div>
	</div>
</dialog>
