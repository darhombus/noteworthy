<script lang="ts">
	/**
	 * The app shell.
	 *
	 * Only wraps signed-in pages. `/`, `/login`, `/signup`, `/signup/check-inbox`
	 * and `/forgot-password` have no `shellUser` and render bare — a sidebar full
	 * of sections you cannot reach is not navigation, it is an advertisement.
	 *
	 * That holds for those because nobody signed in ever reaches them: they are
	 * `AUTH_ENTRY_PATHS` (`$lib/auth/routes`), and `hooks.server.ts` redirects a
	 * signed-in request for any of them to `APP_HOME`. This condition is `shellUser`, not a path check, so removing
	 * one of those redirects would quietly wrap that page in the shell instead of
	 * failing — which is why the redirect has a test of its own.
	 *
	 * `/reset-password` and `/auth/confirm` are drawn without it for somebody
	 * signed in too: their load returns `bare`, and they get `BareHeader` (the
	 * app's name and Log out) instead. `shellUser` is still set there, so the
	 * document still counts as drawn signed in for `$lib/auth/stale`, and nothing
	 * the shell installs (`QuickSearch`'s Ctrl/Cmd+K, the panel) is mounted.
	 * Read off `page.data`, not the root load, which reads nothing from the URL
	 * and so is not re-run on every navigation.
	 *
	 * ---------------------------------------------------------------------------
	 * HOW IT COLLAPSES
	 * ---------------------------------------------------------------------------
	 * Wide screens get a fixed sidebar. Narrow ones get a menu button in a top
	 * bar, which opens the same sidebar as a panel sliding in from the left over
	 * the page (`NavPanel`, which explains how it opens, closes and holds focus).
	 * It used to be a `<details>` disclosure dropping down from the top, chosen
	 * because it needed no script; the panel keeps that through `commandfor` in
	 * current browsers.
	 *
	 * The nav is therefore rendered twice. Only one container is ever displayed —
	 * the panel is a closed `<dialog>` until it is opened, and `display: none`
	 * at `lg` — so only one copy is in the accessibility tree.
	 *
	 * ---------------------------------------------------------------------------
	 * SEARCH
	 * ---------------------------------------------------------------------------
	 * The search icon sits at the right of the top bar at every width: the menu
	 * button's bar below `lg`, the breadcrumb bar from `lg`. So from `lg` that bar
	 * is drawn on every page, crumbs or none; below `lg` it still appears only
	 * with crumbs. Neither bar grows for it: below `lg` it is the menu button's
	 * size, and from `lg` its negative margins leave it a line of text tall, the
	 * height of the trail, which the editor's pinned toolbar measures from.
	 * The icon, like the nav, is rendered twice, one of the two displayed.
	 *
	 * `QuickSearch` is the modal and listens for Ctrl/Cmd+K, once, here.
	 *
	 * `NavProgress` is the bar across the top during a slow client-side
	 * navigation, signed in or not (logging in navigates too). `TimingReadout`,
	 * drawn only for a browser that asked for it at `/timing`, sits beside it.
	 *
	 * `wakeOnReturn` asks the server to be ready, and nothing else, when the
	 * page comes back after a pause; see `$lib/wake`.
	 *
	 * `Toaster` is drawn first, before any of that and outside the shell's
	 * branch, so every page has it, and without JavaScript its notice is a bar
	 * at the top of the page. The notice is the page's data's, or a form
	 * action's answer (`pageNotice`). See `$lib/toast/Toaster.svelte`.
	 */
	import './layout.css';
	import '$lib/journals/fonts.css';
	import favicon from '$lib/assets/favicon.svg';
	import { beforeNavigate, onNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { APP_HOME } from '$lib/auth/routes';
	import { reloadRestoredSignedInPages, reloadSignedOutPages } from '$lib/auth/stale';
	import BareHeader from '$lib/components/BareHeader.svelte';
	import Breadcrumbs from '$lib/components/Breadcrumbs.svelte';
	import NavPanel from '$lib/components/NavPanel.svelte';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import QuickSearch from '$lib/components/QuickSearch.svelte';
	import SearchButton from '$lib/components/SearchButton.svelte';
	import SidebarNav from '$lib/components/SidebarNav.svelte';
	import { closeOnOutsideClick } from '$lib/dialog/outside';
	import { importEditorFor } from '$lib/entries/editor-import';
	import { LG_UP, providePinnedTop } from '$lib/layout/pinned-top';
	import { provideCrumbLabels } from '$lib/nav/crumb-labels.svelte';
	import { forgetMeasuredUsage, measuredUsage } from '$lib/media/usage-measured.svelte';
	import { providePageSearchField } from '$lib/search/page-field.svelte';
	import { pageNotice } from '$lib/toast/notices';
	import { leavesPage } from '$lib/toast/place';
	import Toaster from '$lib/toast/Toaster.svelte';
	import { leavePage } from '$lib/toast/toasts.svelte';
	import { sendWake, wakeOnReturn } from '$lib/wake';
	import { MediaQuery } from 'svelte/reactivity';
	import { onMount, untrack, type Component, type Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { children, data }: { children: Snippet; data: LayoutData } = $props();

	// Every modal dialog in the app closes on a click outside it, unless it
	// holds unsaved changes or a save in flight: see `$lib/dialog/outside`.
	// Here, once, so a dialog takes part without doing anything.
	$effect(() => closeOnOutsideClick(document));

	// After logging out, nothing signed in comes back: not a page the browser
	// kept for Back, and not the shell around `/login`. See `$lib/auth/stale`.
	// Set up again whenever the page is drawn for somebody new (signing in on
	// `/login` without leaving the page), so that it notes that session's mark.
	const signedIn = () => data.shellUser !== null;
	$effect(() => {
		void data.shellUser;
		return reloadRestoredSignedInPages(signedIn);
	});
	onNavigate(reloadSignedOutPages(signedIn));

	// A tap on the way to the edit or new-entry page starts the editor's code
	// with it, so it travels alongside the page's data rather than after it.
	// See `$lib/entries/editor-import`.
	beforeNavigate(({ to }) => importEditorFor(to?.route.id));

	// A toast belongs to the page it was shown on: cleared as a client-side
	// navigation to another page is about to draw it, before that page's own
	// code runs, so a toast it makes on landing is its own. A full load ends the
	// store with the document. See `$lib/toast/toasts.svelte`.
	onNavigate(({ from, to }) => {
		if (leavesPage(from?.url, to?.url)) {
			leavePage();
		}
	});

	// Wakes the server when the app is likely about to be used after a pause,
	// signed in or out, so the tap that follows finds it ready. See `$lib/wake`.
	$effect(() => wakeOnReturn(() => sendWake(resolve('/wake'))));

	// The bar's figure: the editor's measurement after its uploads, until this
	// layout's load next runs. SvelteKit hands `data` a new object only when
	// that load re-ran, and a load is at least as recent as any measurement
	// made before it. See `$lib/media/usage-measured.svelte`.
	$effect.pre(() => {
		void data;
		untrack(forgetMeasuredUsage);
	});
	let storageUsed = $derived(
		data.storageUsed === null ? null : (measuredUsage() ?? data.storageUsed)
	);

	// With the page's live labels: the edit page's entry crumb follows the
	// title being typed (`$lib/nav/crumb-labels.svelte`).
	const labelled = provideCrumbLabels();
	let crumbs = $derived(labelled(page.data.breadcrumbs ?? []));

	/**
	 * The breadcrumb bar's height, border included, as `bind:offsetHeight`
	 * measures it: a ResizeObserver on the bar plus one reading on mount, so it
	 * follows the trail wrapping onto a second line as well as the first render.
	 */
	let crumbsHeight = $state(0);

	// `false` on the server, which cannot know the width. The editor's toolbar
	// row is server-rendered, so it does not read this until `measured` below:
	// before then it sticks by CSS (`PINNED_TOP_UNMEASURED`).
	const wide = new MediaQuery(LG_UP, false);

	/** Whether the bar has been measured: from the layout's mount on. */
	let measured = $state(false);
	onMount(() => {
		measured = true;
	});

	// What the bar covers at the top of the window: its height where it sticks,
	// and nothing where it scrolls away. See `$lib/layout/pinned-top`. From `lg`
	// the bar is there on every page, for the search icon.
	providePinnedTop({
		get height() {
			return data.shellUser && !page.data.bare && wide.current ? crumbsHeight : 0;
		},
		get measured() {
			return measured;
		}
	});

	const pageSearchField = providePageSearchField();

	let quickSearch = $state<ReturnType<typeof QuickSearch>>();

	let onSearchPage = $derived(page.url.pathname === resolve('/search'));

	// The timing readout, for a browser that turned it on at `/timing`: its code
	// is fetched only then, in the browser, so with the cookie absent nothing of
	// it runs or loads. See `$lib/timing/recorder`.
	let TimingReadout = $state.raw<Component<{ box?: HTMLElement | null }> | null>(null);
	/** The readout's own box, which the toasts stay above (`$lib/toast/Toaster.svelte`). */
	let readoutBox = $state<HTMLElement | null>(null);
	$effect(() => {
		if (data.timing && TimingReadout === null) {
			void import('$lib/components/TimingReadout.svelte').then(
				(loaded) => (TimingReadout = loaded.default)
			);
		}
	});
</script>

{#snippet searchButton(size: string)}
	<SearchButton
		current={onSearchPage}
		onactivate={(link) => quickSearch?.activate(link)}
		onpress={() => quickSearch?.prefetch()}
		class={size}
	/>
{/snippet}

{#snippet narrowSearch()}
	{@render searchButton('ml-auto flex h-10 w-10')}
{/snippet}

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<Toaster
	notice={pageNotice(page.data, page.form)}
	readout={data.timing && TimingReadout ? readoutBox : null}
/>

<NavProgress />

{#if data.timing && TimingReadout}
	<TimingReadout bind:box={readoutBox} />
{/if}

{#if page.data.bare}
	<div class="flex min-h-screen flex-col bg-[#FAFAFA] dark:bg-[#121212]">
		<BareHeader signedIn={data.shellUser !== null} />
		{@render children()}
	</div>
{:else if data.shellUser}
	<div class="min-h-screen bg-[#FAFAFA] lg:flex dark:bg-[#121212]">
		<!--
			One `<header>` around both layouts, not an `<aside>` around each.

			`<header>` is the banner landmark, and a page gets one. Wrapping both the
			narrow menu and the wide sidebar in a single one keeps that true at
			every width — the inner containers are what `display: none` swaps, and a
			hidden one is out of the accessibility tree along with everything in it.
			An `<aside>` would have been `complementary`, which is for content beside
			the main content, not for the app's own chrome.
		-->
		<!--
			`lg:sticky lg:top-0 lg:h-screen` is what keeps the sidebar the height of
			the window rather than the height of the page.

			It is a flex child of a `lg:flex` row, and a flex child stretches to the
			tallest item by default — so on a long page, and the entry editor is
			sixteen rows before anybody types, the sidebar grew to match and left a
			column of empty grey below the last nav item. Worse, its footer — the
			theme toggle and the account — went with it, off the bottom of the window.

			An explicit height overrides the stretch, `sticky` keeps it in view as the
			main column scrolls past it, and `self-start` stops the flex row trying to
			stretch it again. All three are `lg:` because at narrow widths this
			element is not a sidebar at all: it is a bar in normal flow at the top of
			the page holding the menu button, and pinning that would cost a phone a
			third of its screen.
		-->
		<header
			class="border-b border-[#E0E0E0] bg-[#F5F5F5] lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:shrink-0 lg:self-start lg:border-r lg:border-b-0 dark:border-[#3A3A3A] dark:bg-[#2C2C2C]"
		>
			<!-- Narrow screens: the whole sidebar, in a panel behind the menu button. -->
			<NavPanel user={data.shellUser} {storageUsed} actions={narrowSearch} />

			<!-- Wide screens: the sidebar proper. -->
			<div class="hidden lg:flex lg:h-full lg:flex-col">
				<a
					href={APP_HOME}
					class="block border-b border-[#E0E0E0] px-4 py-4 font-semibold text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5]"
				>
					Noteworthy
				</a>
				<div class="min-h-0 flex-1">
					<SidebarNav user={data.shellUser} {storageUsed} />
				</div>
			</div>
		</header>

		<div class="flex min-w-0 flex-1 flex-col">
			<!--
				Pinned at `lg` and up, so the way back up the trail stays in reach on a
				long page; scrolling away below `lg`, where a phone's height is worth
				more than a trail it can reach by scrolling up.

				It sticks inside this column, which runs the full height of the page,
				and nothing between here and the root sets `overflow` — so it is the
				window it sticks to. The sidebar is its own sticky column beside it and
				is not affected.

				The background is the page's own, so the bar looks the same pinned or
				not, and is solid so content scrolls behind it rather than through it.
				`z-20` puts it above the editor's pinned toolbar row (`z-10`), which
				sticks directly below it and scrolls under it when the editor ends.

				Measured, for the editor: see `providePinnedTop` above.

				From `lg` on every page, below it only with crumbs: see SEARCH above.
				The icon's `-my-2` takes its 36px back to the trail's 20px line.
			-->
			<div
				bind:offsetHeight={crumbsHeight}
				data-top-bar
				class="{crumbs.length > 0
					? 'flex'
					: 'hidden lg:flex'} items-center gap-3 border-b border-[#E0E0E0] bg-[#FAFAFA] px-4 py-3 sm:px-6 lg:sticky lg:top-0 lg:z-20 dark:border-[#3A3A3A] dark:bg-[#121212]"
			>
				<!-- The trail is the bar's own child: `e2e/entry-sticky-toolbar.e2e.ts` finds the bar as its parent. -->
				{#if crumbs.length > 0}
					<Breadcrumbs {crumbs} />
				{/if}
				{@render searchButton('-my-2 ml-auto hidden h-9 w-9 lg:flex')}
			</div>
			{@render children()}
		</div>
	</div>

	<QuickSearch bind:this={quickSearch} pageField={pageSearchField} loaded={data} />
{:else}
	<!--
		No toggle out here. The signed-out pages still honour the theme — the
		cookie is read in `hooks.server.ts` on every request whatever the route,
		and with no cookie the media query in `layout.css` follows the OS — they
		just offer no way to change it. Somebody who has set one sees it on the
		login page; somebody who has not gets their OS.
	-->
	{@render children()}
{/if}
