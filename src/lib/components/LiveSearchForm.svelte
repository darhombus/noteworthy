<script lang="ts">
	/**
	 * A search field whose results follow it as it is typed in, with the page's
	 * address following along: the search page's, and a journal page's inside
	 * that journal. The field is an ordinary GET form on `path`, so it works
	 * without JavaScript: submitting loads `path?q=…`, whose load runs the search.
	 *
	 * With JavaScript, results follow the field (`$lib/search/live`): each search
	 * asks `/search/results`, the same `runSearch` the load calls, and the address
	 * follows what is shown through SvelteKit's `replaceState`, so Back leaves the
	 * page rather than stepping through the words typed, and a reload shows the
	 * same results. Enter searches at once. The field is never written to while
	 * typing goes on, so focus and the caret stay where they are.
	 *
	 * Below the field: the results, or, while nothing is typed, `idle` when the
	 * page gives one (a journal's entry list) and `SearchResults`' own message
	 * when it does not.
	 *
	 * One instance searches one `journal` for its whole life: the controller is
	 * made once. A page that can change journals without being made again (one
	 * journal's page to another's) wraps this in a `{#key}`.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY NOT `goto`
	 * ---------------------------------------------------------------------------
	 * `goto(url, { replaceState, keepFocus, noScroll })` would keep focus and
	 * scroll, and its navigation token drops an older navigation that finishes
	 * after a newer one. But each search would then be a navigation: the field's
	 * `value={query}` is written with the query of whichever answer lands, which
	 * is older than the field whenever typing went on during the round trip; a
	 * failed load replaces the whole page, field and all, with the error page;
	 * clearing the field or typing one letter costs a round trip to learn what is
	 * known here; and the modal, which must not change the address, needs the
	 * endpoint anyway. So one way of asking serves both.
	 *
	 * ---------------------------------------------------------------------------
	 * WHAT SHALLOW ROUTING COSTS
	 * ---------------------------------------------------------------------------
	 * `replaceState` changes the address but not `page.url`, which stays the URL
	 * the page was loaded from, and the history entry keeps that URL as the one
	 * to load. Back or Forward to it from another page loads *that*, under an
	 * address showing what was typed since. `afterNavigate` notices the two
	 * disagreeing and goes to the address properly, as the new-entry page does.
	 * Until that answers, the page loaded shows. Anything that re-runs the load
	 * (`invalidateAll`, an enhanced form's `update()`: the journal page's Rename)
	 * runs it for the URL loaded, not the address: the field is written only
	 * after a navigation (see `initial`), and `outcome` is adopted only then.
	 *
	 * ---------------------------------------------------------------------------
	 * FILTERS
	 * ---------------------------------------------------------------------------
	 * `SearchFilterRow`, inside the form, so its fields submit with it without
	 * JavaScript. The pills chosen are `chosen`, drawn at once; what the results
	 * are for is `view.filters`, which the address follows with the query.
	 *
	 * Presets roll forward (`rolled`, `$lib/search/filters`): after every
	 * navigation, hydration included, and whenever the page becomes visible
	 * again, a preset whose days are not what it means in the viewer's calendar
	 * today gets today's days, and the page searches again with the pill
	 * unchanged. So "Today" left open overnight, reloaded the next morning, or
	 * opened from yesterday's link shows today. Custom never rolls.
	 *
	 * `maxlength` is the database's 200 characters (UTF-16 units here, so never
	 * more than 200 code points).
	 *
	 * ---------------------------------------------------------------------------
	 * MARKS AHEAD OF THE ANSWER
	 * ---------------------------------------------------------------------------
	 * The results shown are marked for the field as it is now, on every
	 * keystroke (`markWords`: the server's word rules and case-folding, and no
	 * marks where the field would not be searched), not for the query they were
	 * found by. The rows themselves change only when an answer lands.
	 *
	 * ---------------------------------------------------------------------------
	 * DRAWN BEFORE ITS ANSWER
	 * ---------------------------------------------------------------------------
	 * With `refresh`, the page was drawn from the quick-search modal's answer
	 * (`$lib/search/page-data`), and `refresh` is the page's own request, on its
	 * way. The controller follows it as a search of its own; when the modal had
	 * no answer to give, the results area stays empty under "Searching…" rather
	 * than saying what search covers under a query.
	 */
	import { onDestroy, untrack, type Snippet } from 'svelte';
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SearchResults from '$lib/components/SearchResults.svelte';
	import { askEndpoint, createLiveSearch, type LiveSnapshot } from '$lib/search/live';
	import SearchFilterRow from '$lib/components/SearchFilterRow.svelte';
	import { rolled, todayIn, type SearchFilters } from '$lib/search/filters';
	import { claimPageSearchField } from '$lib/search/page-field.svelte';
	import { markWords, pageQueryString, shownQuery, type SearchOutcome } from '$lib/search/results';
	import { QUERY_CHARACTERS } from '$lib/search/text';

	let {
		path,
		query,
		outcome,
		filters,
		refresh = null,
		journals,
		journal = null,
		label,
		title,
		idle,
		pageSearch = false
	}: {
		/** The page's own path, `resolve()`d: the form's action and the address. */
		path: string;
		/** The query and outcome the page was loaded with. */
		query: string;
		outcome: SearchOutcome;
		/** The filters the page was loaded with. */
		filters: SearchFilters;
		/**
		 * The answer for `query` still on its way, when `outcome` was handed over
		 * rather than loaded: see DRAWN BEFORE ITS ANSWER.
		 */
		refresh?: Promise<SearchOutcome> | null;
		/** The journal picker's journals (`/search`); left out, no picker. */
		journals?: Array<{ id: string; name: string }>;
		/** The journal searched, or `null` for every journal. */
		journal?: { id: string; name: string } | null;
		/** The field's label and placeholder. */
		label: string;
		/** The document's title for the query shown, `''` for none. */
		title: (shown: string) => string;
		/** Shown in place of the results while nothing is typed. */
		idle?: Snippet;
		/**
		 * This is the search page's field: the top bar's icon and Ctrl/Cmd+K focus
		 * it instead of opening the modal (`$lib/search/page-field`). Read once.
		 */
		pageSearch?: boolean;
	} = $props();

	const id = $props.id();

	let view = $state<LiveSnapshot>({
		outcome: untrack(() => outcome),
		filters: untrack(() => filters),
		searching: false,
		failed: false
	});

	/** The filters chosen, which the pills show at once, answered or not. */
	let chosen = $state<SearchFilters>(untrack(() => filters));

	/** Bumped to make Custom's fields again, showing `chosen`'s days. */
	let custom = $state(0);

	let field = $state<HTMLInputElement>();

	if (untrack(() => pageSearch)) {
		claimPageSearchField(() => field);
	}

	/**
	 * The field's value as rendered, and never again: after that only
	 * `afterNavigate` writes it. `value={query}` would be written whenever the
	 * load re-runs (Rename's `invalidateAll`), with the query of the URL loaded,
	 * even an unchanged one. Svelte skips a write equal to the last it made, but
	 * after hydration it drops the server's `value` attribute through
	 * `set_attribute(input, 'value', null)` (`remove_input_defaults`), which
	 * resets that record. Measured: Rename put "harbour" back in a field cleared
	 * on a page loaded as `?q=harbour`.
	 */
	const initial = untrack(() => query);

	/** The field's text as typed, for the marks. */
	let typed = $state(initial);

	/** A handed-over page with no answer yet: see DRAWN BEFORE ITS ANSWER. */
	let awaiting = $state(false);

	const live = createLiveSearch(
		untrack(() => outcome),
		{
			ask: askEndpoint(
				resolve('/search/results'),
				untrack(() => journal?.id ?? null)
			),
			onChange: (snapshot) => {
				view = snapshot;
				if (!snapshot.searching) {
					awaiting = false;
				}
			},
			onShown: (next, shownFilters) => {
				// `path` is `resolve()`d; the rule has no form for a query string after it.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				replaceState(`${path}${pageQueryString(shownQuery(next), shownFilters)}`, {});
			},
			filters: untrack(() => filters),
			typed: initial
		}
	);

	onDestroy(() => live.destroy());

	function choose(next: SearchFilters, options?: { wait?: boolean }) {
		chosen = next;
		live.choose(next, options);
	}

	/** A preset brought up to today in the viewer's calendar; see FILTERS above. */
	function roll() {
		const next = rolled(chosen, todayIn(new Date()));
		if (next !== null) {
			choose(next);
		}
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') {
			roll();
		}
	}

	afterNavigate(() => {
		// See WHAT SHALLOW ROUTING COSTS above.
		if (location.search !== page.url.search) {
			// As above: `path` is `resolve()`d, the query string follows it.
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			void goto(`${path}${location.search}`, {
				replaceState: true,
				keepFocus: true,
				noScroll: true
			});
			return;
		}
		live.adopt(outcome, filters, query);
		typed = query;
		if (refresh !== null) {
			awaiting = outcome.kind === 'idle';
			live.follow(refresh);
		}
		chosen = filters;
		custom += 1;
		// The field is not bound to `query` (`initial`, above), and a query typed
		// since the last load is not in `query`.
		if (field !== undefined && field.value !== query) {
			field.value = query;
		}
		roll();
	});

	function submit(event: SubmitEvent) {
		// Always: with script, Enter never loads a page. During a composition
		// Chromium still submits on Enter, which there only confirms a suggestion.
		event.preventDefault();
		if (field !== undefined) {
			live.submit(field.value);
		}
	}
</script>

<svelte:document onvisibilitychange={onVisibilityChange} />

<svelte:head>
	<title>{title(shownQuery(view.outcome))}</title>
</svelte:head>

<form method="GET" action={path} role="search" onsubmit={submit}>
	<div class="flex gap-2">
		<label for="{id}-query" class="sr-only">{label}</label>
		<input
			bind:this={field}
			id="{id}-query"
			name="q"
			type="search"
			value={initial}
			maxlength={QUERY_CHARACTERS}
			autocomplete="off"
			placeholder={label}
			oninput={(event) => {
				typed = event.currentTarget.value;
				live.input(typed);
			}}
			oncompositionstart={() => live.compositionStart()}
			oncompositionend={() => live.compositionEnd()}
			class="min-w-0 flex-1 rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] placeholder:text-[#616161] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:placeholder:text-[#9E9E9E]"
		/>
		<button
			type="submit"
			class="shrink-0 rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
		>
			Search
		</button>
	</div>
	<div class="mt-3">
		<SearchFilterRow filters={chosen} {journals} {custom} onchoose={choose} />
	</div>
</form>

<!-- The line is always there, so nothing below moves when it fills. -->
<p role="status" class="mt-2 min-h-5 text-sm text-[#616161] dark:text-[#9E9E9E]">
	{#if view.searching}Searching…{/if}
</p>
{#if view.failed}
	<p role="alert" class="mt-1 text-sm text-[#C62828] dark:text-[#EF9A9A]">
		Search isn’t answering. Press Enter to try again.
	</p>
{/if}

<div class="mt-6">
	{#if view.outcome.kind === 'idle' && idle !== undefined}
		{@render idle()}
	{:else if !(view.outcome.kind === 'idle' && awaiting)}
		<SearchResults
			outcome={view.outcome}
			filters={view.filters}
			{journal}
			words={view.outcome.kind === 'found' ? markWords(typed, chosen) : null}
		/>
	{/if}
</div>
