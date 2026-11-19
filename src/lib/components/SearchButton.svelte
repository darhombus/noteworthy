<script lang="ts">
	/**
	 * The top bar's search icon, named "Search" for screen readers.
	 *
	 * A link to `/search`, not a `<button>`: without JavaScript it still goes
	 * somewhere, and on `/search` it can say it is the current page
	 * (`aria-current`, drawn as the sidebar draws its current item), which only
	 * a link can. With JavaScript a plain click is
	 * the shell's (`onactivate`): the modal elsewhere, the page's own field on
	 * `/search`. A click meant for a new tab or window is left to the link.
	 *
	 * Rendered twice by the layout, like the nav: once in the narrow top bar,
	 * once in the breadcrumb bar at `lg`, and only one is displayed at a time.
	 *
	 * `onpress` is told of a `pointerdown` that may become that click, so the
	 * modal's recent entries are asked for a tap's length sooner. Kept out of
	 * SvelteKit's preloading: the body's `hover` setting would otherwise fetch
	 * `/search`'s data on every hover and every touch of an icon whose click
	 * opens the modal instead.
	 */
	import { resolve } from '$app/paths';

	let {
		current,
		onactivate,
		onpress,
		class: className = ''
	}: {
		/** The page is `/search`. */
		current: boolean;
		onactivate: (link: HTMLAnchorElement) => void;
		/** A press that a plain click may follow. */
		onpress: () => void;
		/** Size and `display` (`flex`, or `hidden lg:flex`): each bar sets its own. */
		class?: string;
	} = $props();

	function click(event: MouseEvent & { currentTarget: HTMLAnchorElement }) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		onactivate(event.currentTarget);
	}

	function pointerdown(event: PointerEvent) {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		onpress();
	}
</script>

<a
	href={resolve('/search')}
	aria-current={current ? 'page' : undefined}
	aria-haspopup={current ? undefined : 'dialog'}
	onclick={click}
	onpointerdown={pointerdown}
	data-sveltekit-preload-data="off"
	data-search-button
	class="shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none {current
		? 'bg-[#1976D2] text-white dark:bg-[#1E3A5F] dark:text-[#F5F5F5]'
		: 'text-[#212121] hover:bg-[#E0E0E0] dark:text-[#F5F5F5] dark:hover:bg-[#3A3A3A]'} {className}"
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
		<circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
	</svg>
	<span class="sr-only">Search</span>
</a>
