<script lang="ts">
	/**
	 * Quick search: a modal opened from the top bar's icon or Ctrl/Cmd+K on any
	 * signed-in page, rendered once by the root layout.
	 *
	 * A field, and under it rows to jump to. With nothing typed, the 5 most
	 * recently edited entries (`/search/recent`, asked each time it opens, never
	 * in the shell's load: see RECENTLY EDITED). As you type, the top of the same
	 * first page `/search` shows: up to 3 journals, up to 8 entries, then "See
	 * all N results", which opens `/search?q=…`. The rows come from
	 * `$lib/search/quick`. The rows shown are marked for the field as it is now,
	 * on every keystroke (`markWords`), ahead of the answer for it.
	 *
	 * Enter and See all hand the answer on screen to the search page they open
	 * (`handOver`, `$lib/search/page-data`), which is drawn with it at once and
	 * refreshed as usual. See all is kept out of SvelteKit's preloading: a
	 * preload started by the press would become the navigation, and it would
	 * wait for the server after all.
	 *
	 * ---------------------------------------------------------------------------
	 * RECENTLY EDITED
	 * ---------------------------------------------------------------------------
	 * Asked as early as the open can be known: on the icon's `pointerdown`
	 * (`prefetch`, from the shell), so a tap's own 100 ms or so goes towards the
	 * round trip, and on the Ctrl/Cmd+K keydown, which opens it. Until it
	 * answers, the space is held: the last list answered, kept in this
	 * component, or, before any, placeholder rows the height of a row (a
	 * recent row's title is one line, so every row is that height).
	 *
	 * A remembered row is not a link until this open's answer lists it again:
	 * it has no `href`, and a press on it waits for the answer and opens the
	 * entry only if it is still there. So an entry deleted (or, once the vault
	 * exists, hidden) is never opened from memory. One deleted in this tab is
	 * never even drawn: the list is forgotten whenever the shell's load runs
	 * again (`loaded`), which every form action does, deleting an entry or a
	 * journal included. One deleted in another tab or on another device can be
	 * drawn, without a link, until the answer removes it: knowing sooner would
	 * take the round trip this is here to hide.
	 *
	 * Kept in this component, never in storage: it goes with the document, so
	 * logging out (a full form POST) ends it, and a document the back/forward
	 * cache gives back is reloaded before it shows (`$lib/auth/stale`). The
	 * component is drawn only inside the signed-in shell, so it never outlives
	 * the person it was drawn for. A 401 forgets it at once.
	 *
	 * The same search as the page's: `$lib/search/live` drives it (the pause, the
	 * 2-character minimum, latest answer only, "Searching…", a change made while
	 * composing searched like any other), and
	 * `/search/results` answers it through `runSearch`. What it does not do is
	 * move the address: there is no `onShown`. The rows are drawn with
	 * `Highlighted` from the segments `runSearch` built, as `SearchResults` draws
	 * them.
	 *
	 * ---------------------------------------------------------------------------
	 * KEYS: THE COMBOBOX PATTERN
	 * ---------------------------------------------------------------------------
	 * Focus stays in the field. Up and Down move a selection through the rows,
	 * wrapping at the ends, and the field names it with `aria-activedescendant`
	 * (WAI-ARIA's combobox with a listbox popup). Nothing is selected until Up
	 * or Down is pressed, and a new set of rows starts unselected again. With a
	 * row selected, Enter opens it. With none, Enter goes to `/search?q=…` for
	 * what is in the field (`enterQuery`), closing the modal, or does nothing
	 * under 2 characters. So a quick Enter after typing never opens a row left
	 * over from the answer before, and does not wait for the pause: the query
	 * is read from the field, not from the rows shown.
	 *
	 * Enter while an input method is composing confirms a suggestion and is left
	 * alone (`isComposing`, measured in Chromium). The controller's own
	 * composition flag serves only its `submit`, which the modal does not use,
	 * so the field does not report composition to it. Safari is documented to
	 * end a composition before the Enter that confirms it, so there that Enter
	 * would go to `/search`; not tested.
	 *
	 * Each row is an `<a role="option">`, so a click, a middle-click or a
	 * Ctrl-click does what a link does. A press on a row does not take focus from
	 * the field (`mousedown` is prevented), and rows are out of the Tab order.
	 *
	 * Escape closes it, as it closes any modal dialog; so do the X, a click on
	 * the dim (the standing rule, `$lib/dialog/outside`: the query is not unsaved
	 * work, so there is no `data-unsaved`), and any navigation as it starts.
	 * Focus goes back to what had it before: the icon when that opened it (Safari
	 * does not focus a link on click), otherwise whatever was focused when
	 * Ctrl/Cmd+K was pressed. The field is emptied each time it opens.
	 *
	 * The field is `type="text"`, not `search`: Escape in a search field clears
	 * it in Chromium before it reaches the dialog.
	 *
	 * ---------------------------------------------------------------------------
	 * CTRL/CMD+K
	 * ---------------------------------------------------------------------------
	 * Listened for here, once, on the window: `$lib/search/shortcut` decides. The
	 * editor keeps it for links while it has focus, and the title field above it
	 * leaves it alone. On `/search` it focuses the page's field and selects its
	 * text; with the modal open it selects the modal's field's text. The browser's
	 * own Ctrl+K is prevented only when one of those happens.
	 *
	 * ---------------------------------------------------------------------------
	 * SIZE
	 * ---------------------------------------------------------------------------
	 * Below `lg` it fills the screen, so a phone's keyboard leaves it all the
	 * room there is. From `lg` it is the dialog pattern ("Menus and dialogs" in
	 * docs/constraints.md) held near the top of the window rather than centred,
	 * so the field stays put while the rows under it come and go.
	 */
	import { onDestroy, tick } from 'svelte';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Highlighted from '$lib/components/Highlighted.svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import { formatDay } from '$lib/format/date';
	import { COLOR_STYLES, toColor } from '$lib/journals/appearance';
	import { askEndpoint, createLiveSearch, type LiveSnapshot } from '$lib/search/live';
	import { NO_FILTERS } from '$lib/search/filters';
	import type { PageSearchField } from '$lib/search/page-field.svelte';
	import { handOver, type Handover } from '$lib/search/page-data';
	import {
		enterQuery,
		moveSelection,
		quickRows,
		RECENT_SHOWN,
		seeAllLabel
	} from '$lib/search/quick';
	import {
		entryCountLabel,
		markWords,
		searchQueryString,
		type EntryHit,
		type SearchOutcome
	} from '$lib/search/results';
	import { EDITOR_SHORTCUTS, isMacPlatform, shortcutAction } from '$lib/search/shortcut';
	import { QUERY_CHARACTERS } from '$lib/search/text';

	let {
		pageField,
		loaded
	}: {
		pageField: PageSearchField;
		/**
		 * The shell's load's data: a new object each time that load runs again,
		 * which every form action makes it do. The remembered recent entries are
		 * forgotten then (RECENTLY EDITED).
		 */
		loaded: unknown;
	} = $props();

	const id = $props.id();
	const DIALOG_ID = 'quick-search';
	const IDLE: SearchOutcome = { kind: 'idle' };

	let dialog: HTMLDialogElement;
	let field: HTMLInputElement;

	let view = $state<LiveSnapshot>({
		outcome: IDLE,
		filters: NO_FILTERS,
		searching: false,
		failed: false
	});

	/** The last list `/search/recent` answered, or `null` before any. */
	let recent = $state<EntryHit[] | null>(null);
	/** `loaded` once this open's answer is in; until then `recent` is remembered. */
	let recentState = $state<'loading' | 'loaded' | 'failed'>('loading');

	/**
	 * The request for the recent entries: the press's, then the open's. One that
	 * answered more than `PRESS_MS` before the open belonged to a press that
	 * opened nothing, and is asked again.
	 */
	let recentRequest: {
		controller: AbortController;
		answer: Promise<void>;
		at: number;
		settled: boolean;
	} | null = null;
	const PRESS_MS = 2000;

	/** The field as typed, for the marks. */
	let typed = $state('');

	/** The selected row's index, `-1` for none. */
	let selected = $state(-1);

	/** What gets focus back when it closes. */
	let opener: HTMLElement | null = null;

	// A remembered list this open could not confirm is not offered at all.
	let rows = $derived(quickRows(view.outcome, recentState === 'failed' ? [] : (recent ?? [])));
	/** The recent rows drawn are remembered ones, not yet this open's answer. */
	let remembered = $derived(view.outcome.kind === 'idle' && recentState !== 'loaded');
	let words = $derived(view.outcome.kind === 'found' ? markWords(typed) : null);
	let indexed = $derived(rows.map((row, index) => ({ row, index })));
	let journalRows = $derived(indexed.filter(({ row }) => row.kind === 'journal'));
	let entryRows = $derived(indexed.filter(({ row }) => row.kind === 'entry'));
	let allRow = $derived(indexed.find(({ row }) => row.kind === 'all'));

	let onSearchPage = $derived(page.url.pathname === resolve('/search'));

	const optionId = (index: number) => `${id}-option-${index}`;

	const live = createLiveSearch(IDLE, {
		ask: askEndpoint(resolve('/search/results')),
		onChange: (snapshot) => {
			if (snapshot.outcome !== view.outcome) {
				selected = -1;
			}
			view = snapshot;
		}
	});

	onDestroy(() => {
		live.destroy();
		recentRequest?.controller.abort();
	});

	/** Drops the request for the recent entries, if any. */
	function dropRecent(): void {
		recentRequest?.controller.abort();
		recentRequest = null;
	}

	/** Asks for the recent entries; the answer is the list until the next. */
	function askRecent(): void {
		dropRecent();
		recentState = 'loading';
		const controller = new AbortController();
		const request = {
			controller,
			answer: Promise.resolve(),
			at: performance.now(),
			settled: false
		};
		request.answer = (async () => {
			try {
				const response = await fetch(resolve('/search/recent'), { signal: controller.signal });
				if (response.status === 401) {
					// Nobody signed in: nothing of theirs is kept.
					recent = null;
				}
				const body = (await response.json()) as { entries?: EntryHit[] };
				if (!response.ok || body.entries === undefined) {
					throw new Error(`recent entries: ${response.status}`);
				}
				if (recentRequest !== request) {
					return;
				}
				recent = body.entries;
				recentState = 'loaded';
				if (view.outcome.kind === 'idle') {
					selected = -1;
				}
			} catch {
				if (recentRequest === request) {
					recentState = 'failed';
				}
			} finally {
				request.settled = true;
			}
		})();
		recentRequest = request;
	}

	/**
	 * The icon was pressed: ask now, ahead of the click that opens it. Nothing
	 * on `/search`, where the icon opens nothing.
	 */
	export function prefetch(): void {
		if (dialog.open || onSearchPage) {
			return;
		}
		askRecent();
	}

	// See RECENTLY EDITED: nothing the action that ran the shell's load again
	// deleted is drawn from memory.
	$effect(() => {
		void loaded;
		recent = null;
		dropRecent();
	});

	/** Opens it, empty, with focus in the field. */
	function open(from: HTMLElement | null): void {
		if (dialog.open) {
			field.select();
			return;
		}
		opener = from;
		field.value = '';
		typed = '';
		live.adopt(IDLE);
		selected = -1;
		const pressed =
			recentRequest !== null &&
			(!recentRequest.settled || performance.now() - recentRequest.at < PRESS_MS);
		if (!pressed) {
			askRecent();
		}
		dialog.showModal();
		field.focus();
	}

	function entryHref(entry: EntryHit) {
		return resolve('/journals/[journalId]/entries/[entryId]', {
			journalId: entry.journalId,
			entryId: entry.entryId
		});
	}

	/**
	 * A remembered row, pressed before this open's answer: opens the entry once
	 * the answer lists it, and does nothing if it no longer does.
	 */
	async function openWhenListed(entry: EntryHit): Promise<void> {
		await recentRequest?.answer;
		if (recentState === 'loaded' && recent?.some((row) => row.entryId === entry.entryId)) {
			await goto(entryHref(entry));
		}
	}

	/** `/search` for `query`, to be drawn at once from the answer on screen. */
	function searchPageFor(query: string): string {
		const address = `${resolve('/search')}${searchQueryString(query)}`;
		const handover: Handover = {
			query,
			outcome: view.outcome.kind === 'found' ? view.outcome : null
		};
		handOver(address, handover);
		return address;
	}

	/** See all: a plain click is drawn from the answer on screen, like Enter. */
	function seeAll(event: MouseEvent, query: string): void {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(searchPageFor(query));
	}

	/** On `/search`: the page's own field, its text selected. */
	function focusPage(from: HTMLElement | null): void {
		const own = pageField.field;
		if (own === null) {
			open(from);
			return;
		}
		own.focus();
		own.select();
	}

	/** The top bar's icon. */
	export function activate(link: HTMLElement): void {
		if (onSearchPage) {
			focusPage(link);
		} else {
			open(link);
		}
	}

	/** Every way it closes ends here: Escape, the X, the dim, and navigation. */
	function onClose(): void {
		live.adopt(IDLE);
		dropRecent();
		const back = opener;
		opener = null;
		if (back?.isConnected) {
			back.focus();
		}
	}

	beforeNavigate(() => {
		if (dialog.open) {
			dialog.close();
		}
	});

	// A handover the navigation did not take (it went elsewhere) is not left
	// for a later one to the same address.
	afterNavigate(() => {
		handOver('', { query: '', outcome: null });
	});

	function otherModalOpen(): boolean {
		return Array.from(document.querySelectorAll('dialog')).some(
			(other) => other !== dialog && other.matches(':modal')
		);
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		const target = event.target;
		const action = shortcutAction(event, {
			mac: isMacPlatform(navigator.platform),
			quickOpen: dialog.open,
			onSearchPage,
			otherModalOpen: otherModalOpen(),
			inEditorField: target instanceof Element && target.closest(`[${EDITOR_SHORTCUTS}]`) !== null
		});
		if (action === null) {
			return;
		}
		event.preventDefault();
		const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		if (action === 'select') {
			field.focus();
			field.select();
		} else if (action === 'focus-page') {
			focusPage(focused);
		} else {
			open(focused);
		}
	}

	async function select(index: number): Promise<void> {
		selected = index;
		await tick();
		if (index >= 0) {
			document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
		}
	}

	function onFieldKeydown(event: KeyboardEvent): void {
		// An input method uses these keys for its own suggestions.
		if (event.isComposing) {
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			void select(moveSelection(selected, rows.length, event.key === 'ArrowDown' ? 1 : -1));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (selected >= 0) {
				document.getElementById(optionId(selected))?.click();
			} else {
				const query = enterQuery(field.value);
				if (query !== null) {
					// `beforeNavigate` closes the modal. The path is `resolve()`d; the
					// rule has no form for a query string after it.
					// eslint-disable-next-line svelte/no-navigation-without-resolve
					void goto(searchPageFor(query));
				}
			}
		}
	}

	$effect(() => {
		dialog.addEventListener('close', onClose);
		return () => dialog.removeEventListener('close', onClose);
	});
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!--
	A recent row's title is one line, so every recent row is the placeholders'
	height. A remembered one has no `href` until this open's answer lists it.
-->
{#snippet entryOption(entry: EntryHit, index: number, recentRow: boolean)}
	<a
		id={optionId(index)}
		role="option"
		aria-selected={index === selected}
		aria-disabled={recentRow && remembered ? 'true' : undefined}
		tabindex="-1"
		href={recentRow && remembered ? undefined : entryHref(entry)}
		onclick={recentRow && remembered
			? (event) => {
					event.preventDefault();
					void openWhenListed(entry);
				}
			: undefined}
		class="block cursor-pointer rounded-lg px-3 py-2 hover:bg-[#F5F5F5] aria-selected:bg-[#F5F5F5] aria-selected:ring-2 aria-selected:ring-[#1976D2] aria-selected:ring-inset dark:hover:bg-[#2C2C2C] dark:aria-selected:bg-[#2C2C2C]"
	>
		<span
			class="{recentRow
				? 'truncate'
				: 'line-clamp-2 wrap-anywhere'} block font-medium text-[#212121] dark:text-[#F5F5F5]"
			data-part="title"
		>
			{#if entry.title}<Highlighted parts={entry.title} {words} />{:else}<span
					class="text-[#616161] italic dark:text-[#9E9E9E]">Untitled</span
				>{/if}
		</span>
		<span class="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
			<span
				aria-hidden="true"
				class="h-2.5 w-2.5 shrink-0 rounded-full {COLOR_STYLES[toColor(entry.journalColor)].swatch}"
			></span>
			<span class="min-w-0 truncate">{entry.journalName}</span>
			<span aria-hidden="true">·</span>
			<span class="shrink-0">{formatDay(entry.entryDate)}</span>
		</span>
		{#if entry.snippet.length > 0}
			<span
				class="mt-1 line-clamp-2 text-sm wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
				data-part="snippet"
			>
				<Highlighted parts={entry.snippet} {words} />
			</span>
		{/if}
	</a>
{/snippet}

<!--
	Below `lg`: `inset-0 m-0 h-full w-full` and no limits fill the window. From
	`lg`: the top edge 10vh down, `bottom: auto` so the height follows the rows up
	to the limit, centred across by `mx-auto`.
-->
<dialog
	bind:this={dialog}
	id={DIALOG_ID}
	aria-label="Search"
	class="quick-search fixed inset-0 m-0 h-full max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-white p-0 backdrop:bg-black/40 open:flex lg:bottom-auto lg:mx-auto lg:mt-[10vh] lg:h-auto lg:max-h-[calc(90dvh-2rem)] lg:w-[calc(100%-2rem)] lg:max-w-xl lg:rounded-xl lg:border lg:border-[#E0E0E0] lg:shadow-lg dark:bg-[#1E1E1E] lg:dark:border-[#3A3A3A]"
>
	<div
		class="flex shrink-0 items-center gap-2 border-b border-[#E0E0E0] px-3 py-3 dark:border-[#3A3A3A]"
	>
		<label for="{id}-field" class="sr-only">Search entries and journals</label>
		<input
			bind:this={field}
			id="{id}-field"
			type="text"
			role="combobox"
			aria-autocomplete="list"
			aria-controls="{id}-listbox"
			aria-expanded={rows.length > 0}
			aria-activedescendant={selected >= 0 ? optionId(selected) : undefined}
			maxlength={QUERY_CHARACTERS}
			autocomplete="off"
			enterkeyhint="search"
			placeholder="Search entries and journals"
			oninput={(event) => {
				typed = event.currentTarget.value;
				live.input(typed);
			}}
			onkeydown={onFieldKeydown}
			class="min-w-0 flex-1 rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] placeholder:text-[#616161] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:placeholder:text-[#9E9E9E]"
		/>
		<button
			type="button"
			onclick={() => dialog.close()}
			class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#616161] hover:bg-[#E0E0E0] hover:text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#9E9E9E] dark:hover:bg-[#3A3A3A] dark:hover:text-[#F5F5F5]"
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
			<span class="sr-only">Close search</span>
		</button>
	</div>

	<div
		data-dialog-body
		class="min-h-0 scrollbar-app flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-3"
	>
		<!-- Always in the layout, so nothing below moves when it fills. -->
		<p role="status" class="min-h-5 px-3 text-sm text-[#616161] dark:text-[#9E9E9E]">
			{#if view.searching}Searching…{/if}
		</p>
		{#if view.failed}
			<p role="alert" class="px-3 text-sm text-[#C62828] dark:text-[#EF9A9A]">
				Search isn’t answering. Keep typing to try again, or press Enter to open the search page.
			</p>
		{/if}

		{#if view.outcome.kind === 'short'}
			<p class="px-3 py-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
				Type at least 2 characters.
			</p>
		{:else if view.outcome.kind === 'found' && rows.length === 0}
			<p class="px-3 py-2 text-sm wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
				No entries or journals contain “{view.outcome.query}”.
			</p>
		{:else if view.outcome.kind === 'idle' && recentState === 'failed'}
			<p class="px-3 py-2 text-sm text-[#616161] dark:text-[#9E9E9E]">
				Couldn’t load your recent entries.
			</p>
		{:else if view.outcome.kind === 'idle' && recentState === 'loaded' && rows.length === 0}
			<p class="px-3 py-2 text-sm text-[#616161] dark:text-[#9E9E9E]">No entries yet.</p>
		{/if}

		<!--
			The listbox is always there, for `aria-controls`. A press inside it keeps
			focus in the field; the click that follows still follows the link.
		-->
		<div
			id="{id}-listbox"
			role="listbox"
			aria-label="Search results"
			tabindex="-1"
			aria-busy={view.outcome.kind === 'idle' && recentState === 'loading'}
			onmousedown={(event) => event.preventDefault()}
			class="space-y-3"
		>
			{#if view.outcome.kind === 'idle' && recentState === 'loading' && recent === null}
				<!--
					The space the recent entries will take, until they come: the group's
					heading and a row's height each (one line of title, one of journal
					and date). See RECENTLY EDITED.
				-->
				<div aria-hidden="true" data-recent-placeholder>
					<div class="px-3 py-1 text-xs font-medium text-transparent">Recently edited</div>
					{#each { length: RECENT_SHOWN }, n (n)}
						<div class="px-3 py-2">
							<div class="flex h-6 items-center">
								<div class="h-3.5 w-2/3 rounded bg-[#EEEEEE] dark:bg-[#2C2C2C]"></div>
							</div>
							<div class="mt-0.5 flex h-5 items-center">
								<div class="h-3 w-1/3 rounded bg-[#F5F5F5] dark:bg-[#262626]"></div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
			{#if journalRows.length > 0}
				<div role="group" aria-labelledby="{id}-journals">
					<div
						role="presentation"
						id="{id}-journals"
						class="px-3 py-1 text-xs font-medium text-[#616161] dark:text-[#9E9E9E]"
					>
						Journals
					</div>
					{#each journalRows as { row, index } (index)}
						{#if row.kind === 'journal'}
							<a
								id={optionId(index)}
								role="option"
								aria-selected={index === selected}
								tabindex="-1"
								href={resolve('/journals/[journalId]', { journalId: row.journal.journalId })}
								class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[#F5F5F5] aria-selected:bg-[#F5F5F5] aria-selected:ring-2 aria-selected:ring-[#1976D2] aria-selected:ring-inset dark:hover:bg-[#2C2C2C] dark:aria-selected:bg-[#2C2C2C]"
							>
								<span
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg {COLOR_STYLES[
										toColor(row.journal.color)
									].tile}"
								>
									<JournalIcon icon={row.journal.icon} class="h-4 w-4" />
								</span>
								<span class="min-w-0 flex-1">
									<span
										class="block font-medium wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
										data-part="name"><Highlighted parts={row.journal.name} {words} /></span
									>
									<span class="block text-sm text-[#616161] dark:text-[#9E9E9E]">
										{entryCountLabel(row.journal.entryCount)}
									</span>
								</span>
							</a>
						{/if}
					{/each}
				</div>
			{/if}

			{#if entryRows.length > 0}
				<div role="group" aria-labelledby="{id}-entries">
					<div
						role="presentation"
						id="{id}-entries"
						class="px-3 py-1 text-xs font-medium text-[#616161] dark:text-[#9E9E9E]"
					>
						{view.outcome.kind === 'idle' ? 'Recently edited' : 'Entries'}
					</div>
					{#each entryRows as { row, index } (index)}
						{#if row.kind === 'entry'}
							{@render entryOption(row.entry, index, view.outcome.kind === 'idle')}
						{/if}
					{/each}
				</div>
			{/if}

			{#if allRow !== undefined && allRow.row.kind === 'all'}
				{@const query = allRow.row.query}
				<a
					id={optionId(allRow.index)}
					role="option"
					aria-selected={allRow.index === selected}
					tabindex="-1"
					href="{resolve('/search')}{searchQueryString(allRow.row.query)}"
					data-sveltekit-preload-data="off"
					onclick={(event) => seeAll(event, query)}
					class="block rounded-lg border-t border-[#E0E0E0] px-3 py-3 text-sm font-medium text-[#1976D2] hover:bg-[#F5F5F5] aria-selected:bg-[#F5F5F5] aria-selected:ring-2 aria-selected:ring-[#1976D2] aria-selected:ring-inset dark:border-[#3A3A3A] dark:text-[#90CAF9] dark:hover:bg-[#2C2C2C] dark:aria-selected:bg-[#2C2C2C]"
				>
					{seeAllLabel(allRow.row.count)}
				</a>
			{/if}
		</div>
	</div>
</dialog>

<style>
	/* The page behind holds still, as behind the narrow menu (`NavPanel`). */
	:global(html:has(#quick-search[open])) {
		overflow: hidden;
	}
</style>
