<script lang="ts">
	/**
	 * Entering, changing and removing a link's URL.
	 *
	 * ---------------------------------------------------------------------------
	 * THIS DIALOG SITS INSIDE THE ENTRY FORM, WHICH MAKES TWO THINGS DANGEROUS
	 * ---------------------------------------------------------------------------
	 * `EntryEditor` renders inside the edit page's `<form>`, so everything here is
	 * inside it too, and two ordinary pieces of HTML would post the entry:
	 *
	 *   A `<button>` with no `type` is a submit button. Every button below says
	 *   `type="button"`, including the close and remove ones.
	 *
	 *   An `<input>` in a form submits it on Enter — implicit submission, which
	 *   needs no button to have been clicked and no `type` to be wrong. So Enter
	 *   in the URL field is caught and turned into "apply", which is what pressing
	 *   it in a dialog like this should do anyway.
	 *
	 * There is deliberately no nested `<form>`: a form inside a form is invalid
	 * HTML, and browsers resolve it by dropping the inner one, which would put the
	 * fields back into the outer form without any of this being visible.
	 *
	 * ---------------------------------------------------------------------------
	 * WHAT COUNTS AS A URL
	 * ---------------------------------------------------------------------------
	 * `normalizeHref` from `$lib/entries/document` — the same function the server
	 * runs over every document it stores. One definition, so the dialog cannot
	 * accept something the sanitiser then quietly drops, which would look exactly
	 * like the link having been made and then lost.
	 *
	 * The one thing this adds on top is a scheme: "example.com" is what people
	 * type, and `new URL()` refuses it. So a value with no scheme at all is tried
	 * again as `https://`. A value that *has* a scheme is never rewritten, which
	 * is the part that matters — `javascript:alert(1)` has one, so it goes to
	 * `normalizeHref` as it stands and is refused there.
	 *
	 * ---------------------------------------------------------------------------
	 * FOCUS ON CLOSING
	 * ---------------------------------------------------------------------------
	 * Closing a modal dialog puts focus back on what had it when it opened: the
	 * editor (Mod-K) or a toolbar button. `onClose` is told whether focus is still
	 * there (`untouched`), so the editor takes it back then and only then. Until
	 * 2026-10-01 the editor took it back unconditionally with TipTap's
	 * `commands.focus()`, which waits a frame (`requestAnimationFrame`) after the
	 * `close` event, itself a task after `close()`: anything focused in between
	 * (a click or Tab straight after Escape) was taken back by the editor.
	 * Measured in Chromium by focusing the title from the `close` event: focus
	 * went to the title, then back to the editor, and Ctrl+K there opened this
	 * dialog again. That is how `quick-search.e2e.ts` failed once under the full
	 * suite's load.
	 */
	import { normalizeHref } from '$lib/entries/document';

	let {
		onApply,
		onRemove,
		onClose
	}: {
		onApply: (href: string) => void;
		onRemove: () => void;
		/**
		 * Called whichever way the dialog closes, so focus can go back.
		 * `untouched` is false when focus has already gone somewhere other than
		 * where the dialog opened from (see FOCUS ON CLOSING).
		 */
		onClose: (untouched: boolean) => void;
	} = $props();

	let element: HTMLDialogElement;
	let field = $state<HTMLInputElement | null>(null);
	let url = $state('');
	let editing = $state(false);
	let error = $state<string | null>(null);

	/**
	 * The address as the dialog opened with it. Differing from it keeps the
	 * dialog open on a click outside (`$lib/dialog/outside`); typed and put
	 * back is no change. There is no save in flight here to declare: applying
	 * a link is immediate.
	 */
	let opened = $state('');

	/** What had focus when it opened, and so where closing puts focus back. */
	let openedFrom: Element | null = null;
	let changed = $derived(url !== opened);

	/** Opens empty to add a link, or on an href to change the one under the cursor. */
	export function open(current: string | null): void {
		url = current ?? '';
		opened = url;
		editing = current !== null;
		error = null;
		openedFrom = document.activeElement;
		element.showModal();
		// After `showModal`, so the element is focusable. Selecting rather than
		// just focusing means re-opening on an existing link and typing replaces
		// it, instead of appending to a URL nobody wants to edit by hand.
		field?.focus();
		field?.select();
	}

	/** A scheme-less value gets `https://`; anything else is taken as written. */
	function resolve(value: string): string | null {
		const trimmed = value.trim();
		const direct = normalizeHref(trimmed);
		if (direct !== null) {
			return direct;
		}
		return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? null : normalizeHref(`https://${trimmed}`);
	}

	function apply(): void {
		const href = resolve(url);
		if (href === null) {
			error = 'Give a web address, like example.com or https://example.com.';
			field?.focus();
			return;
		}
		element.close();
		onApply(href);
	}

	function closed(): void {
		const now = document.activeElement;
		onClose(now === null || now === document.body || now === openedFrom || element.contains(now));
		openedFrom = null;
	}

	function remove(): void {
		element.close();
		onRemove();
	}
</script>

<!-- `m-auto` centres it — see the note in JournalDialog.svelte. -->
<dialog
	bind:this={element}
	onclose={closed}
	aria-labelledby="link-dialog-title"
	data-unsaved={changed || undefined}
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	<div class="p-6">
		<h2 id="link-dialog-title" class="text-lg font-semibold text-[#212121] dark:text-[#F5F5F5]">
			{editing ? 'Edit link' : 'Add link'}
		</h2>

		<label for="link-url" class="mt-4 block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
			Web address
		</label>
		<input
			bind:this={field}
			bind:value={url}
			id="link-url"
			type="text"
			inputmode="url"
			autocomplete="off"
			spellcheck="false"
			placeholder="example.com"
			aria-invalid={error === null ? undefined : 'true'}
			aria-describedby={error === null ? undefined : 'link-url-error'}
			oninput={() => (error = null)}
			onkeydown={(event) => {
				// Implicit submission would post the entry form. See the note above.
				if (event.key === 'Enter') {
					event.preventDefault();
					apply();
				}
			}}
			class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
		/>
		{#if error !== null}
			<p id="link-url-error" class="mt-1 text-sm text-red-600 dark:text-red-400">{error}</p>
		{/if}

		<div class="mt-6 flex flex-wrap items-center justify-end gap-2">
			{#if editing}
				<button
					type="button"
					onclick={remove}
					class="mr-auto rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#C62828] hover:bg-[#FFEBEE] focus-visible:ring-2 focus-visible:ring-[#C62828]/40 dark:border-[#3A3A3A] dark:text-[#EF9A9A] dark:hover:bg-[#3A1517]"
				>
					Remove link
				</button>
			{/if}
			<button
				type="button"
				onclick={() => element.close()}
				class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={apply}
				class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
			>
				{editing ? 'Update link' : 'Add link'}
			</button>
		</div>
	</div>
</dialog>
