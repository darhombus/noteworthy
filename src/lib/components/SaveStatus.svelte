<script lang="ts">
	/**
	 * Whether the entry is saved, and what to do when it is not.
	 *
	 * ---------------------------------------------------------------------------
	 * TWO LIVE REGIONS, NOT ONE
	 * ---------------------------------------------------------------------------
	 * "Saving…" and "Saved" are progress, and a screen reader should mention them
	 * when it gets a moment — `role="status"`, which is polite. A failure is not
	 * progress: nobody pressed anything, so nothing is waiting on it, and the only
	 * thing that will tell somebody their writing is not being kept is this. That
	 * gets `role="alert"`, which interrupts.
	 *
	 * They are separate elements because `aria-live` is read when a region is
	 * created, not when its value changes — swapping the attribute on one element
	 * is a well-known way to end up with announcements that follow whatever
	 * politeness the region happened to be born with.
	 *
	 * ---------------------------------------------------------------------------
	 * PENDING AND SAVING LOOK THE SAME
	 * ---------------------------------------------------------------------------
	 * The controller keeps them apart — one has a timer running, the other has a
	 * request open, and only the second survives a navigation — but there is no
	 * useful difference to show. Somebody mid-sentence does not need to know
	 * whether the debounce has elapsed; they need to know their words are not yet
	 * stored, which both states mean. Showing them separately would also flicker
	 * through three labels for every pause in typing.
	 *
	 * ---------------------------------------------------------------------------
	 * ONE FAILURE, ONE ANNOUNCEMENT, ONE HEIGHT
	 * ---------------------------------------------------------------------------
	 * This is given the display from `$lib/entries/save-display`, not the raw
	 * controller state, so a failure stays on screen through the typing and the
	 * retries after it until a save succeeds. Three things follow from that here.
	 *
	 * The alert is created once, when the failure begins, and kept. `{#if failed}`
	 * stays true through the retries, so Svelte keeps the same element rather
	 * than building a new one, and a screen reader hears an alert when one is
	 * added or its text changes — neither of which a retry does. Its text changes
	 * only if the failure's message does, which is news worth hearing (the
	 * connection is back, and now the server is the problem). Svelte writes a text
	 * node only when the value differs, so an identical message touches nothing.
	 *
	 * "Retrying…" is on the button, not in the alert, for the same reason: inside
	 * the alert it would be announced on every attempt. It is `aria-disabled`
	 * while it shows and ignores presses, as the button was simply absent during
	 * a retry before; focus stays on it throughout, because it is the same
	 * element.
	 *
	 * The button is exactly as wide whichever label it shows. Both labels are
	 * drawn in the same grid cell and the one not in use is `invisible`, which
	 * keeps its width and takes it out of the accessible name. Otherwise the
	 * wider label could push the button onto a line of its own at some width,
	 * and the pinned toolbar row would change height on every attempt — the
	 * flicker this is here to stop.
	 *
	 * ---------------------------------------------------------------------------
	 * WHERE FOCUS GOES WHEN TRY AGAIN WORKS
	 * ---------------------------------------------------------------------------
	 * A save that succeeds ends the failure, and the Try again button goes with
	 * it. If the button had focus — somebody tabbed to it and pressed it, or
	 * pressed it and waited — removing it would drop focus onto the page body, and
	 * a keyboard user would have to find their way back into the entry. So in
	 * that case, and only that one, focus is handed to `returnFocus` instead.
	 *
	 * It is done in a `$effect.pre`, which runs before Svelte updates the DOM for
	 * the same change. The button is therefore still on the page, and still the
	 * active element if it had focus, when the question is asked — and focus has
	 * moved before the button is removed, so it never passes through the body at
	 * all. After the removal there would be nothing left to ask:
	 * `document.activeElement` would already be the body, whoever had put it
	 * there.
	 *
	 * With focus anywhere else, a success leaves it exactly where it is.
	 */
	import { untrack } from 'svelte';
	import type { SaveDisplay } from '$lib/entries/save-display';

	let {
		status,
		onRetry,
		returnFocus
	}: {
		status: SaveDisplay;
		onRetry: () => void;
		/** Where focus goes if Try again has it when the failure ends. See above. */
		returnFocus?: () => void;
	} = $props();

	let failed = $derived(status.kind === 'failed');
	let retrying = $derived(status.kind === 'failed' && status.retrying);
	let message = $derived(status.kind === 'failed' ? status.message : '');
	/**
	 * Saving from this page has ended (`$lib/entries/send-draft`): the entry
	 * changed somewhere else, or is in the Recycle Bin. Trying again would be
	 * refused the same way, so there is no button to offer it.
	 */
	let ended = $derived(
		status.kind === 'failed' && (status.failure === 'stale' || status.failure === 'deleted')
	);

	let retryButton = $state<HTMLButtonElement | null>(null);

	$effect.pre(() => {
		if (failed) {
			return;
		}
		// Untracked: this runs for the failure ending and for nothing else, and
		// whatever `returnFocus` reads is not something to re-run on.
		untrack(() => {
			if (retryButton !== null && document.activeElement === retryButton) {
				returnFocus?.();
			}
		});
	});
</script>

<div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
	{#if failed}
		<p
			role="alert"
			class="inline-flex items-center gap-2 text-sm font-medium text-[#C62828] dark:text-[#EF9A9A]"
		>
			<!-- A filled circle rather than a warning triangle: the triangle reads as
			     "you did something wrong", and nobody did. -->
			<svg
				class="h-4 w-4 shrink-0"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.75"
				stroke-linecap="round"
				aria-hidden="true"
			>
				<circle cx="12" cy="12" r="9" />
				<path d="M12 7v6" />
				<path d="M12 16h.01" />
			</svg>
			Not saved — {message}
		</p>
		{#if !ended}
			<button
				bind:this={retryButton}
				type="button"
				aria-disabled={retrying ? 'true' : undefined}
				onclick={() => {
					if (!retrying) {
						onRetry();
					}
				}}
				class="grid rounded-lg border border-[#E0E0E0] px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] {retrying
					? 'cursor-default text-[#616161] dark:text-[#9E9E9E]'
					: 'text-[#212121] hover:bg-[#F5F5F5] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]'}"
			>
				<span class="col-start-1 row-start-1 {retrying ? 'invisible' : ''}">Try again</span>
				<span class="col-start-1 row-start-1 {retrying ? '' : 'invisible'}">Retrying…</span>
			</button>
		{/if}
	{:else}
		<p role="status" class="text-sm text-[#616161] dark:text-[#9E9E9E]">
			{status.kind === 'saved' ? 'Saved' : 'Saving…'}
		</p>
	{/if}
</div>
