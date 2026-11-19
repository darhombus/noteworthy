<script lang="ts">
	/**
	 * One toast: its words, an icon for its kind, an optional link, and Dismiss.
	 *
	 * Success and info go by themselves after `TOAST_MS`. The countdown pauses
	 * while the pointer is over the toast or focus is inside it, and resumes from
	 * where it stopped once both have left. Errors and sticky toasts have none.
	 *
	 * A tap on the toast, anywhere but its link or Dismiss, keeps it until it is
	 * closed or its page is left: a finger has no hover. So does a long press.
	 * Chrome on Android, at the long press, fires `contextmenu` and then
	 * `pointercancel` and `pointerleave` with the finger still down (and starts
	 * selecting the words), which ended the pause and let the toast go under the
	 * finger. The long press has no `click`, so `contextmenu` is the one to read.
	 * Escape closes the toast that holds focus, and so does following its link
	 * in this tab. Nothing here ever moves focus:
	 * a toast is reached, never handed focus.
	 *
	 * The kind is said by more than colour: each has its own icon, and an error
	 * has a red border too.
	 */
	import { onMount } from 'svelte';
	import { TOAST_MS, type ToastKind } from './place';
	import type { ToastLink } from './toasts.svelte';

	let {
		kind,
		text,
		sticky,
		link,
		hidden = false,
		height = $bindable(),
		ondismiss
	}: {
		kind: ToastKind;
		text: string;
		sticky: boolean;
		link?: ToastLink;
		/** Kept, and measured, but not shown: the space is short (`chooseShown`). */
		hidden?: boolean;
		height?: number | undefined;
		ondismiss: () => void;
	} = $props();

	let element: HTMLDivElement;

	let remaining = TOAST_MS;
	let startedAt = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pointerInside = false;
	let focusInside = false;
	let held = false;

	function resume(): void {
		if (sticky || held || timer !== null || pointerInside || focusInside) {
			return;
		}
		startedAt = Date.now();
		timer = setTimeout(() => {
			timer = null;
			ondismiss();
		}, remaining);
	}

	function pause(): void {
		if (timer === null) {
			return;
		}
		clearTimeout(timer);
		timer = null;
		remaining = Math.max(0, remaining - (Date.now() - startedAt));
	}

	/** A tap or a long press on the toast itself; the link and Dismiss do their own thing. */
	function hold(event: Event): void {
		if (event.target instanceof Element && event.target.closest('a, button') !== null) {
			return;
		}
		held = true;
		pause();
	}

	onMount(() => {
		resume();
		return () => {
			if (timer !== null) {
				clearTimeout(timer);
			}
		};
	});
</script>

<!--
	The listeners are not the toast acting as a control: the pointer and focus
	pause its countdown, a tap keeps it, and Escape closes it from the Dismiss
	button or the link inside, which are the controls. The keyboard's own way to
	keep it is focus inside it.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={element}
	bind:offsetHeight={height}
	role="group"
	aria-label="Notification"
	data-toast
	data-kind={kind}
	data-sticky={sticky || undefined}
	onpointerenter={() => {
		pointerInside = true;
		pause();
	}}
	onpointerleave={() => {
		pointerInside = false;
		resume();
	}}
	onclick={hold}
	oncontextmenu={hold}
	onfocusin={() => {
		focusInside = true;
		pause();
	}}
	onfocusout={(event) => {
		if (!element.contains(event.relatedTarget as Node | null)) {
			focusInside = false;
			resume();
		}
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			ondismiss();
		}
	}}
	class="nw-toast pointer-events-auto flex w-full items-start gap-3 rounded-xl border bg-white py-2 pr-2 pl-4 text-sm text-[#212121] shadow-lg sm:max-w-sm dark:bg-[#1E1E1E] dark:text-[#F5F5F5] {kind ===
	'error'
		? 'border-[#C62828] dark:border-[#EF9A9A]'
		: 'border-[#E0E0E0] dark:border-[#3A3A3A]'} {hidden
		? 'invisible absolute right-4 bottom-0 left-4 sm:left-auto sm:w-[calc(100%-2rem)]'
		: ''}"
>
	<!--
		The icon and the words, centred together in the row: one line is shorter
		than Dismiss (28px against 36px), and with the row's `items-start` it sat
		4px above the middle. Wrapped, this is the tallest item and nothing moves.
		The icon stays beside the first line inside it.
	-->
	<div class="flex min-w-0 flex-1 items-start gap-3 self-center" data-toast-body>
		<svg
			class="mt-1.5 h-4 w-4 shrink-0 {kind === 'error'
				? 'text-[#C62828] dark:text-[#EF9A9A]'
				: 'text-[#1976D2] dark:text-[#90CAF9]'}"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			data-toast-icon={kind}
		>
			{#if kind === 'success'}
				<circle cx="12" cy="12" r="9" />
				<path d="m8 12.5 2.5 2.5L16 9.5" />
			{:else if kind === 'info'}
				<circle cx="12" cy="12" r="9" />
				<path d="M12 11v5" />
				<path d="M12 8h.01" />
			{:else}
				<circle cx="12" cy="12" r="9" />
				<path d="M12 7v6" />
				<path d="M12 16h.01" />
			{/if}
		</svg>
		<p class="min-w-0 flex-1 py-1 wrap-anywhere" data-toast-text>
			{text}
			{#if link}
				<!--
					Followed here, in this tab, the toast has done its job and closes.
					A link opened elsewhere (Ctrl or ⌘, Shift, a middle click, which is
					no `click`) leaves it, since this page is still the one in front.
				-->
				<a
					href={link.href}
					onclick={(event) => {
						if (
							event.button === 0 &&
							!event.defaultPrevented &&
							!event.ctrlKey &&
							!event.metaKey &&
							!event.shiftKey &&
							!event.altKey
						) {
							ondismiss();
						}
					}}
					class="ml-1 font-medium text-[#1976D2] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#90CAF9]"
				>
					{link.label}
				</a>
			{/if}
		</p>
	</div>
	<button
		type="button"
		data-toast-close
		onclick={ondismiss}
		class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#616161] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#9E9E9E] dark:hover:bg-[#2C2C2C]"
	>
		<svg
			class="h-4 w-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M6 6l12 12" /><path d="M18 6L6 18" />
		</svg>
		<span class="sr-only">Dismiss</span>
	</button>
</div>
