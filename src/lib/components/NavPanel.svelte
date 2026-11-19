<script lang="ts">
	/**
	 * The sidebar below `lg`: a menu button in a top bar, and a panel that slides
	 * in from the left over a dimmed page.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY A MODAL `<dialog>`
	 * ---------------------------------------------------------------------------
	 * `showModal()` does most of the work: the page behind becomes inert (no
	 * clicks and no Tab stops reach it), the `::backdrop` is the dim, and Escape
	 * closes it. That includes Android's back gesture, through the same close
	 * watcher. What it does not do is added here:
	 *
	 *   - Focus goes back to the menu button on every close. The browser would put
	 *     it back on whatever had focus before it opened, and Safari does not focus
	 *     a button when it is clicked, so there that is nothing.
	 *   - Tab wraps from the last control to the first and back. Left to the
	 *     browser, Tab past the end leaves the page for the browser's own toolbar.
	 *   - A tap on the dim closes it. That is the browser's own `closedby="any"`
	 *     where it exists: Chrome 134+ and Firefox 141+, but no shipping Safari,
	 *     iOS included (MDN's compat data, 8.1.2; Playwright's WebKit has it,
	 *     so the specs cannot show the gap). With script, Safari is covered by
	 *     the rule every modal dialog in the app follows (`$lib/dialog/outside`,
	 *     installed by the root layout), which began as this panel's own
	 *     handler: a tap counts only when the press started on the dim too, so
	 *     a text selection dragged out of the panel does not. The panel holds
	 *     nothing unsaved, so it always closes. Where both run, the browser
	 *     closes first and the rule finds nothing open.
	 *   - Any navigation closes it, when it starts (`beforeNavigate`), so it is
	 *     never over the page that arrives. That covers every link in it, the one
	 *     for the page already showing included (SvelteKit navigates to it
	 *     again), and the back button. The storage bar is one of those links.
	 *   - The page does not scroll while it is open: the rule at the end of this
	 *     file.
	 *
	 * Buttons that do not navigate, the theme toggle's, leave it open.
	 *
	 * ---------------------------------------------------------------------------
	 * WITHOUT JAVASCRIPT
	 * ---------------------------------------------------------------------------
	 * The disclosure this replaced opened with no script, which matters on a
	 * phone with a slow connection before the bundle arrives. The buttons keep
	 * that through `commandfor`: in Chromium 135+, Firefox 144+ and Safari 26.2+
	 * the menu button opens the dialog and the X closes it with no script at all,
	 * and Escape works as ever. A tap on the dim closes it too in Chrome 134+ and
	 * Firefox 141+, through `closedby`; in Safari, only the X and Escape do.
	 * Focus is left where the browser puts it. With script, the click handlers
	 * cancel the command and do the same thing themselves, which older browsers
	 * need. Older browsers with script off get no menu at all: see "The menu on a
	 * narrow screen" in `docs/constraints.md`.
	 *
	 * ---------------------------------------------------------------------------
	 * WIDTH
	 * ---------------------------------------------------------------------------
	 * 85% of the window, at most 20rem (320px): 272px on a 320px phone, which
	 * leaves a 48px strip of dim to tap, and 320px from a 377px window up — a
	 * panel, not a sheet, on a narrow desktop window. At 272px "Recycle Bin" and
	 * its badge fit on one line with room over. The account line has 195px, an
	 * email address of about 25 characters, and 243px from 377px up; the wide
	 * sidebar's has 180px. A longer name or address ends in an ellipsis. Any
	 * more room at 320px would come out of the strip left to tap.
	 * `e2e/nav-panel.e2e.ts` measures all of it at 320px and 390px.
	 */
	import { beforeNavigate } from '$app/navigation';
	import { APP_HOME } from '$lib/auth/routes';
	import { LG_UP } from '$lib/layout/pinned-top';
	import { MediaQuery } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import SidebarNav from './SidebarNav.svelte';

	let {
		user,
		storageUsed,
		actions
	}: {
		user: { name: string; avatarUrl: string | null };
		storageUsed: number | null;
		/** At the right of the top bar: the search icon. */
		actions?: Snippet;
	} = $props();

	const PANEL_ID = 'nav-panel';

	let opener: HTMLButtonElement;
	let dialog: HTMLDialogElement;
	let closeButton: HTMLButtonElement;

	let open = $state(false);

	function show(event: MouseEvent) {
		// This is the script path: the `commandfor` attribute is for when there is none.
		event.preventDefault();
		if (dialog.open) {
			return;
		}
		dialog.showModal();
		open = true;
		closeButton.focus();
	}

	function hide() {
		if (dialog.open) {
			dialog.close();
		}
	}

	/** Every way it closes ends here: the X, Escape, the dim, and navigation. */
	function onClose() {
		open = false;
		// A navigation that goes ahead moves focus again once the new page is in,
		// as SvelteKit does for every navigation. One that is cancelled leaves it
		// here, on the button that opened the menu.
		opener.focus();
	}

	/** Tab from the last control goes to the first, and Shift+Tab the other way. */
	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') {
			return;
		}
		const stops = Array.from(
			dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
		).filter((element) => element.checkVisibility());
		const first = stops[0];
		const last = stops[stops.length - 1];
		if (first === undefined || last === undefined) {
			return;
		}
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	beforeNavigate(hide);

	// At `lg` the panel is `display: none` along with its button. A modal dialog
	// left open there would keep the whole page inert behind nothing, so a window
	// widened past `lg` with the menu open closes it.
	const wide = new MediaQuery(LG_UP, false);
	$effect(() => {
		if (wide.current) {
			hide();
		}
	});

	$effect(() => {
		dialog.addEventListener('close', onClose);
		dialog.addEventListener('keydown', onKeydown);
		return () => {
			dialog.removeEventListener('close', onClose);
			dialog.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<div class="flex items-center gap-1 px-2 py-2 lg:hidden">
	<button
		bind:this={opener}
		type="button"
		commandfor={PANEL_ID}
		command="show-modal"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-controls={PANEL_ID}
		onclick={show}
		class="flex h-10 w-10 items-center justify-center rounded-lg text-[#212121] hover:bg-[#E0E0E0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#F5F5F5] dark:hover:bg-[#3A3A3A]"
	>
		<svg
			class="h-5 w-5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.75"
			stroke-linecap="round"
			aria-hidden="true"
		>
			<path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />
		</svg>
		<span class="sr-only">Menu</span>
	</button>
	<span class="font-semibold text-[#212121] dark:text-[#F5F5F5]">Noteworthy</span>
	{@render actions?.()}
</div>

<!--
	`m-0 h-auto max-h-none` undo the browser's centring and height limit; the
	dialog's own `top: 0; bottom: 0` then stretch it to the window's height, which
	makes that height definite for the `h-full` column inside. `right-auto` so the
	`left: 0` alone places it.
-->
<dialog
	bind:this={dialog}
	id={PANEL_ID}
	closedby="any"
	aria-label="Menu"
	class="nav-panel fixed inset-y-0 right-auto left-0 m-0 h-auto max-h-none w-[85%] max-w-80 border-0 border-r border-[#E0E0E0] bg-[#F5F5F5] p-0 shadow-lg backdrop:bg-black/40 lg:hidden dark:border-[#3A3A3A] dark:bg-[#2C2C2C] dark:backdrop:bg-black/60"
>
	<div class="flex h-full flex-col">
		<div class="flex items-center border-b border-[#E0E0E0] pr-2 dark:border-[#3A3A3A]">
			<a
				href={APP_HOME}
				class="block flex-1 px-4 py-4 font-semibold text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#F5F5F5]"
			>
				Noteworthy
			</a>
			<button
				bind:this={closeButton}
				type="button"
				commandfor={PANEL_ID}
				command="close"
				onclick={hide}
				class="flex h-10 w-10 items-center justify-center rounded-lg text-[#616161] hover:bg-[#E0E0E0] hover:text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#9E9E9E] dark:hover:bg-[#3A3A3A] dark:hover:text-[#F5F5F5]"
			>
				<svg
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
					aria-hidden="true"
				>
					<path d="M6 6l12 12" /><path d="M18 6L6 18" />
				</svg>
				<span class="sr-only">Close menu</span>
			</button>
		</div>
		<div class="min-h-0 flex-1">
			<SidebarNav {user} {storageUsed} />
		</div>
	</div>
</dialog>

<style>
	/* In from the left on opening. Closing is instant, not animated: it closes as
	   a navigation starts, and a panel still sliding out would be over the page
	   that arrives. */
	.nav-panel[open] {
		translate: 0 0;
		transition: translate 200ms ease-out;

		@starting-style {
			translate: -100% 0;
		}

		@media (prefers-reduced-motion: reduce) {
			transition: none;
		}
	}

	/* The page behind holds still. The inert page takes no focus and no clicks,
	   but a wheel or a swipe over the dim would still scroll it. A desktop window
	   with a classic scrollbar loses it for as long as the panel is open, and the
	   dimmed page moves over by its width. `scrollbar-gutter: stable` would fix
	   that on a long page and cause it on a short one, which had no bar to keep. */
	:global(html:has(#nav-panel[open])) {
		overflow: hidden;
	}
</style>
