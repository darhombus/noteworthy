<script lang="ts" module>
	import type { ResolvedPathname } from '$app/types';

	/**
	 * One thing the menu offers: a link to follow, or something to do. A link is
	 * a `ResolvedPathname`, built by `resolve()`, for the reason given on
	 * `Crumb.href` in `$lib/nav/breadcrumbs`.
	 */
	export type ActionItem = { label: string; destructive?: boolean } & (
		{ href: ResolvedPathname } | { run: () => void }
	);
</script>

<script lang="ts">
	/**
	 * "More actions": one button per item, holding what can be done to it.
	 *
	 * The same WAI-ARIA menu button pattern as `AddMediaMenu`, and the same
	 * arithmetic (`$lib/menu/menu`) for where it opens and which item a key moves
	 * to. It is a component of its own rather than that one made general because
	 * everything else about the two differs: that one is a stop on the toolbar's
	 * roving tabindex, keeps its keys from the toolbar, keeps the editor's
	 * selection through a click and opens file pickers.
	 *
	 * ---------------------------------------------------------------------------
	 * KEYBOARD AND POINTER
	 * ---------------------------------------------------------------------------
	 * Click, Enter, Space or Down open it on the first item; Up opens it on the
	 * last. Inside, Up and Down move and wrap, Home and End jump, Enter and Space
	 * choose. Escape closes it, and so does a click anywhere outside it. Tab
	 * closes it and carries on to whatever is next on the page.
	 *
	 * Focus comes back to the button whenever the menu closes, except when Tab
	 * or a click has deliberately put it somewhere else. Choosing an item puts it
	 * on the button *before* the item runs, which matters for the dialogs: a
	 * modal `<dialog>` hands focus back on closing to whatever held it when it
	 * opened, and that is then the button rather than an item that no longer
	 * exists.
	 *
	 * A click outside lands on something or nothing. On a link or a field it is
	 * left there. On nothing, the browser moves focus to the page itself, which
	 * would leave somebody using the keyboard afterwards starting from the top —
	 * so once the click is over, focus that ended up nowhere goes back to the
	 * button. That is checked on `click` rather than `pointerdown` because a
	 * finger's focus change comes after it lifts, not when it lands.
	 *
	 * ---------------------------------------------------------------------------
	 * NAME
	 * ---------------------------------------------------------------------------
	 * The button is named for the item it belongs to — "More actions for Garden
	 * log" — because down a list of cards a screen reader would otherwise read
	 * "More actions" again and again with nothing to tell them apart. The menu is
	 * labelled by the button, so it carries the same name.
	 *
	 * ---------------------------------------------------------------------------
	 * WITHOUT JAVASCRIPT
	 * ---------------------------------------------------------------------------
	 * The button does nothing. A page whose actions matter without script offers
	 * them another way itself; see the entry read page.
	 */
	import { flushSync, tick } from 'svelte';
	import { placeMenu, stepMenu } from '$lib/menu/menu';

	let { name, items }: { name: string; items: ActionItem[] } = $props();

	const id = $props.id();

	/** Wide enough for "Delete" with room around it, and no wider. */
	const MENU_WIDTH = 176;

	let anchor = $state<HTMLDivElement | null>(null);
	let button = $state<HTMLButtonElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);
	let open = $state(false);

	/**
	 * Offsets from the wrapper, worked out in window coordinates by `placeMenu`.
	 * `null` until measured: the menu has to be in the page before its height
	 * can be read, and it is drawn invisible until then. Both happen before the
	 * browser paints, so nobody sees it in the wrong place.
	 */
	let placement = $state<{ left: number; top: number; width: number } | null>(null);

	/** A click outside is still in progress; see NAME above for what it waits for. */
	let pendingReturn: (() => void) | null = null;

	function menuItems(): HTMLElement[] {
		return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
	}

	async function show(focus: 'first' | 'last'): Promise<void> {
		placement = null;
		open = true;
		await tick();
		if (menu === null || button === null || anchor === null) {
			return;
		}

		// `clientWidth` rather than `innerWidth`: a window with a scrollbar has
		// that much less room at the right, and a menu under it is cut off.
		const root = document.documentElement;
		const placed = placeMenu(
			button.getBoundingClientRect(),
			{ width: MENU_WIDTH, height: menu.offsetHeight },
			{ width: root.clientWidth, height: root.clientHeight },
			'end'
		);
		const origin = anchor.getBoundingClientRect();
		// Flushed, so the menu is visible before focus goes into it: a browser
		// will not focus an element that is still `visibility: hidden`, and
		// would leave it on the button without a word.
		flushSync(() => {
			placement = {
				left: placed.left - origin.left,
				top: placed.top - origin.top,
				width: placed.width
			};
		});

		const list = menuItems();
		(focus === 'first' ? list[0] : list[list.length - 1])?.focus();
	}

	function hide(toButton: boolean): void {
		if (!open) {
			return;
		}
		open = false;
		if (toButton) {
			button?.focus();
		}
	}

	function choose(item: ActionItem): void {
		// A link is left to the browser: closing does not stop it navigating,
		// because the menu leaves the page only after this click is handled.
		hide(true);
		if ('run' in item) {
			item.run();
		}
	}

	function onMenuKeyDown(event: KeyboardEvent): void {
		const list = menuItems();
		const index = list.indexOf(document.activeElement as HTMLElement);
		const next = stepMenu(event.key, index, list.length);

		if (next !== null) {
			event.preventDefault();
			list[next]?.focus();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			hide(true);
		} else if (event.key === 'Tab') {
			// Closed, and the browser moves focus on as it would anywhere else.
			open = false;
		} else if (event.key === ' ' && index >= 0) {
			// Space presses a button by itself but only scrolls past a link.
			event.preventDefault();
			list[index]?.click();
		}
	}

	function onButtonKeyDown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			void show(event.key === 'ArrowDown' ? 'first' : 'last');
		}
	}

	function onWindowPointerDown(event: PointerEvent): void {
		if (pendingReturn !== null) {
			window.removeEventListener('click', pendingReturn, true);
			pendingReturn = null;
		}
		const target = event.target as Node;
		if (!open || menu?.contains(target) || button?.contains(target)) {
			return;
		}
		open = false;

		const returnFocus = (): void => {
			pendingReturn = null;
			const active = document.activeElement;
			if (active === null || active === document.body) {
				button?.focus();
			}
		};
		pendingReturn = returnFocus;
		window.addEventListener('click', returnFocus, { capture: true, once: true });
	}
</script>

<!--
	Closed on a resize, since where it was placed no longer holds. A phone
	resizes as its address bar comes and goes, so focus is moved only if it was
	in the menu.
-->
<svelte:window
	onpointerdown={onWindowPointerDown}
	onresize={() => hide(menu?.contains(document.activeElement) ?? false)}
/>

<div bind:this={anchor} class="relative shrink-0">
	<button
		bind:this={button}
		id="{id}-button"
		type="button"
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${id}-menu` : undefined}
		onclick={() => (open ? hide(true) : void show('first'))}
		onkeydown={onButtonKeyDown}
		class="flex h-9 w-9 items-center justify-center rounded-lg text-[#616161] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#9E9E9E]
		{open
			? 'bg-[#E3F2FD] text-[#1976D2] dark:bg-[#1E3A5F] dark:text-[#90CAF9]'
			: 'hover:bg-[#F5F5F5] hover:text-[#212121] dark:hover:bg-[#2C2C2C] dark:hover:text-[#F5F5F5]'}"
	>
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="h-5 w-5">
			<circle cx="5" cy="12" r="1.75" />
			<circle cx="12" cy="12" r="1.75" />
			<circle cx="19" cy="12" r="1.75" />
		</svg>
		<span class="sr-only">More actions for {name}</span>
	</button>

	{#if open}
		<div
			bind:this={menu}
			id="{id}-menu"
			role="menu"
			aria-labelledby="{id}-button"
			tabindex={-1}
			onkeydown={onMenuKeyDown}
			style:left={placement === null ? '0px' : `${placement.left}px`}
			style:top={placement === null ? '0px' : `${placement.top}px`}
			style:width="{placement?.width ?? MENU_WIDTH}px"
			style:visibility={placement === null ? 'hidden' : undefined}
			class="absolute z-30 rounded-xl border border-[#E0E0E0] bg-white py-1 shadow-lg dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			{#each items as item (item.label)}
				{@const tone = item.destructive
					? 'text-[#C62828] hover:bg-[#FFEBEE] focus-visible:bg-[#FFEBEE] dark:text-[#EF9A9A] dark:hover:bg-[#3A1517] dark:focus-visible:bg-[#3A1517]'
					: 'text-[#212121] hover:bg-[#F5F5F5] focus-visible:bg-[#F5F5F5] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C] dark:focus-visible:bg-[#2C2C2C]'}
				{#if 'href' in item}
					<a
						href={item.href}
						role="menuitem"
						tabindex={-1}
						onclick={() => choose(item)}
						class="block w-full px-3 py-2 text-left text-sm focus-visible:outline-none {tone}"
					>
						{item.label}
					</a>
				{:else}
					<button
						type="button"
						role="menuitem"
						tabindex={-1}
						onclick={() => choose(item)}
						class="block w-full px-3 py-2 text-left text-sm focus-visible:outline-none {tone}"
					>
						{item.label}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>
