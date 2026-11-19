<script lang="ts">
	/**
	 * The one place toasts are drawn, by the root layout, first and outside the
	 * shell's branch: on the shell's pages, the bare pages and signed out alike.
	 * See docs/constraints.md, "Toasts".
	 *
	 * ---------------------------------------------------------------------------
	 * WHAT IT SHOWS
	 * ---------------------------------------------------------------------------
	 * The page's notice (its load's `notice`, or a form action's answer's:
	 * `pageNotice` in `./notices`), drawn from the page's data or form so it is
	 * in the server's HTML too, then the toasts the page's code
	 * made (`./toasts.svelte`). A notice belongs to the data it came with: once
	 * closed it stays closed for that data, and it goes when the page's data no
	 * longer holds it. So a data answer that is never drawn (a tab reloaded by
	 * `reloadSignedOutPages` straight after) makes no toast.
	 *
	 * ---------------------------------------------------------------------------
	 * HOW IT IS ANNOUNCED
	 * ---------------------------------------------------------------------------
	 * Two live regions, beside the toasts and in the server's HTML from the
	 * first paint, empty: a region added at the same moment as its words is
	 * often not announced, and one element cannot be polite and assertive at
	 * once (`aria-live` follows the politeness a region was born with; see
	 * `SaveStatus.svelte`). `aria-live` alone, with no role: a `status` and an
	 * `alert` on every page would sit beside each page's own (the search line,
	 * a dialog's refusal) as one more of each. A toast's words are written into the polite one for
	 * success and info and the assertive one for an error, when it appears, and
	 * cleared when it goes. The toasts themselves are not live: the stack is in
	 * time order whatever the kind, which two live lists could not be.
	 *
	 * A notice already in the page when it is first drawn is page content, read
	 * where it stands, first in the reading order, as the inline notice was. Only
	 * one that arrives later, with a client-side navigation's data, is announced.
	 *
	 * ---------------------------------------------------------------------------
	 * WHERE
	 * ---------------------------------------------------------------------------
	 * `fixed` at the bottom: across the width less 16px each side below `sm`, at
	 * the right from `sm`. `z-[45]`: over the sticky bars (`z-20`) and the timing
	 * readout (`z-40`), under the progress bar (`z-50`) and the top layer. The
	 * region's empty area takes no pointer events; each toast does.
	 *
	 * Above the timing readout's box when it is on, measured live (it differs
	 * open and closed), and above the on-screen keyboard (`keyboardLift`). When
	 * the room between the stack's bottom and whatever is above it (the top of
	 * what can be seen, or the editor's pinned row while it sticks) cannot hold
	 * the stack, only one shows: the newest error, or the newest. While the
	 * keyboard is open that choice is held as the page scrolls, and made again
	 * only when the toasts change or the keyboard closes: on a phone the room
	 * changes with the scroll (Chrome's URL bar hiding and showing, the pinned row
	 * starting and stopping to stick), and the hidden toasts came back. Where
	 * the stack sits still follows every scroll.
	 *
	 * Without JavaScript the region is in the flow, a bar at the top of the
	 * page, and covers nothing: there is no script to close it.
	 */
	import { onMount } from 'svelte';
	import { NOTICES, type NoticeName } from './notices';
	import {
		chooseShown,
		distinctInARow,
		keepNewest,
		keyboardLift,
		keyboardOpen,
		stackFits,
		stackOffset,
		TOAST_EDGE,
		type ToastKind
	} from './place';
	import { dismiss, leavePage, toasts, type ToastLink } from './toasts.svelte';
	import ToastItem from './ToastItem.svelte';

	let {
		notice,
		readout = null
	}: {
		/** The page's notice, and the data or form answer it came with. */
		notice: { name: NoticeName; source: object } | null;
		/**
		 * The timing readout's box, while it is drawn. Handed in by the layout
		 * rather than found by its marker: the readout's own code is fetched only
		 * when it is on, and `e2e/timing.e2e.ts` knows that code by its marker.
		 */
		readout?: HTMLElement | null;
	} = $props();

	type Entry = {
		key: string;
		kind: ToastKind;
		text: string;
		sticky: boolean;
		link?: ToastLink;
		dismiss: () => void;
	};

	/** The data whose notice was closed. */
	let closedWith = $state.raw<object | null>(null);

	let entries = $derived.by(() => {
		const all: Entry[] = [];
		if (notice !== null && notice.source !== closedWith) {
			const source = notice.source;
			all.push({
				key: `notice:${notice.name}`,
				...NOTICES[notice.name],
				dismiss: () => (closedWith = source)
			});
		}
		for (const toast of toasts()) {
			all.push({
				key: `toast:${toast.id}`,
				kind: toast.kind,
				text: toast.text,
				sticky: toast.sticky,
				link: toast.link,
				dismiss: () => dismiss(toast.id)
			});
		}
		return keepNewest(distinctInARow(all));
	});

	// -------------------------------------------------------------------------
	// Measuring
	// -------------------------------------------------------------------------
	let heights = $state<Record<string, number>>({});
	let innerHeight = $state(0);
	let lift = $state(0);
	let keyboard = $state(false);
	let readoutTop = $state<number | null>(null);
	let ceiling = $state(0);
	let measured = $state(false);

	function pinnedRowBottom(): number {
		const row = document.querySelector<HTMLElement>('[data-pinned-row]');
		if (row === null) {
			return 0;
		}
		const box = row.getBoundingClientRect();
		const top = parseFloat(getComputedStyle(row).top);
		// Only while it sticks: further down the page it is content like any other.
		return box.bottom > 0 && Number.isFinite(top) && box.top <= top + 1 ? box.bottom : 0;
	}

	function measure(): void {
		const viewport = window.visualViewport ?? null;
		innerHeight = window.innerHeight;
		lift = keyboardLift(innerHeight, viewport);
		keyboard = keyboardOpen(innerHeight, viewport);
		readoutTop = readout === null ? null : innerHeight - readout.getBoundingClientRect().top;
		ceiling = Math.max(viewport?.offsetTop ?? 0, pinnedRowBottom());
		measured = true;
	}

	let frame = 0;
	function measureSoon(): void {
		if (frame === 0) {
			frame = requestAnimationFrame(() => {
				frame = 0;
				measure();
			});
		}
	}

	onMount(() => {
		measure();
		const viewport = window.visualViewport;
		window.addEventListener('resize', measureSoon);
		window.addEventListener('scroll', measureSoon, { passive: true });
		viewport?.addEventListener('resize', measureSoon);
		viewport?.addEventListener('scroll', measureSoon);
		// Left by a full load, or kept for Back: its toasts go with the page.
		window.addEventListener('pagehide', leavePage);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('pagehide', leavePage);
			window.removeEventListener('resize', measureSoon);
			window.removeEventListener('scroll', measureSoon);
			viewport?.removeEventListener('resize', measureSoon);
			viewport?.removeEventListener('scroll', measureSoon);
		};
	});

	// Again whenever a toast comes or goes: the pinned row may have moved since.
	$effect(() => {
		void entries.length;
		measure();
	});

	// The readout's box, live: one line closed, a panel open.
	$effect(() => {
		const element = readout;
		measure();
		if (element === null) {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	});

	let offset = $derived(measured ? stackOffset(lift, readoutTop) : TOAST_EDGE);
	let fitsNow = $derived(
		!measured ||
			stackFits(
				entries.map((entry) => heights[entry.key] ?? 0),
				innerHeight - offset,
				ceiling
			)
	);
	/** The toasts as the short-space rule sees them: which, and how tall. */
	let stack = $derived(entries.map((entry) => `${entry.key}:${heights[entry.key] ?? 0}`).join());
	// The choice held while the keyboard is open, and the stack it was made for.
	// Bookkeeping for the derived below, which writes it: reactive, it would
	// make the derived depend on its own writes.
	let held: { stack: string; fits: boolean } | null = null;
	let fits = $derived.by(() => {
		if (!keyboard) {
			held = null;
			return fitsNow;
		}
		if (held === null || held.stack !== stack) {
			held = { stack, fits: fitsNow };
		}
		return held.fits;
	});
	let shown = $derived(chooseShown(entries, fits));

	// -------------------------------------------------------------------------
	// Announcing
	// -------------------------------------------------------------------------
	let polite = $state('');
	let assertive = $state('');
	let politeKey: string | null = null;
	let assertiveKey: string | null = null;
	// Bookkeeping for the effect below, which writes it: reactive, it would make
	// the effect depend on its own writes.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const announced = new Set<string>();
	let started = false;

	$effect(() => {
		const current = entries;
		const keys = new Set(current.map((entry) => entry.key));
		for (const key of [...announced]) {
			if (!keys.has(key)) {
				announced.delete(key);
			}
		}
		if (politeKey !== null && !keys.has(politeKey)) {
			politeKey = null;
			polite = '';
		}
		if (assertiveKey !== null && !keys.has(assertiveKey)) {
			assertiveKey = null;
			assertive = '';
		}
		for (const entry of current) {
			if (announced.has(entry.key)) {
				continue;
			}
			announced.add(entry.key);
			// Drawn with the page: read where it stands, not announced.
			if (!started) {
				continue;
			}
			if (entry.kind === 'error') {
				assertiveKey = entry.key;
				assertive = entry.text;
			} else {
				politeKey = entry.key;
				polite = entry.text;
			}
		}
		started = true;
	});
</script>

<div
	data-toaster
	data-ceiling={measured ? Math.round(ceiling) : undefined}
	style:bottom="calc({offset}px + env(safe-area-inset-bottom, 0px))"
	class="pointer-events-none fixed inset-x-0 z-[45] flex flex-col items-stretch gap-2 px-4 sm:items-end"
>
	{#each entries as entry (entry.key)}
		<ToastItem
			kind={entry.kind}
			text={entry.text}
			sticky={entry.sticky}
			link={entry.link}
			hidden={!shown.includes(entry)}
			bind:height={heights[entry.key]}
			ondismiss={entry.dismiss}
		/>
	{/each}
</div>
<div aria-live="polite" aria-atomic="true" class="sr-only" data-toast-announce="polite">
	{polite}
</div>
<div aria-live="assertive" aria-atomic="true" class="sr-only" data-toast-announce="assertive">
	{assertive}
</div>

<!--
	Without JavaScript: in the flow, a bar across the top of the page (the region
	is drawn first in the layout), covering nothing, with no Dismiss, which would
	need script. The same `<noscript><style>` as the editor's no-JavaScript half.
-->
<noscript
	><style>
		[data-toaster] {
			position: static !important;
			padding: 0 !important;
			gap: 0 !important;
		}
		[data-toast] {
			max-width: none !important;
			border-width: 0 0 1px !important;
			border-radius: 0 !important;
			box-shadow: none !important;
			padding-right: 1rem !important;
			animation: none !important;
		}
		[data-toast-close] {
			display: none !important;
		}
	</style></noscript
>
