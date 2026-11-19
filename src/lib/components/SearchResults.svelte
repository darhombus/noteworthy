<script lang="ts">
	/**
	 * A search's results, and the messages instead of them. Draws what
	 * `$lib/search/search.server` built and decides nothing about what matched.
	 *
	 *   1. Journals whose name matches, when there are any: on the first page
	 *      only, since they are not paged.
	 *   2. A count line, then the entries, in `find_entries`' order: every word
	 *      in the title first, then the rest, each newest first.
	 *   3. Show more, while more are left. It is a link to the next page
	 *      (`?after=…&from=…`), which is what it does without JavaScript: the
	 *      next 50 load in place of these. With JavaScript it asks
	 *      `/search/results` for the same page, adds it below, and moves focus
	 *      to the first new result.
	 *
	 * An entry's card is the journal page's `EntryCard` without its menu: the
	 * same box, title, date line and two-line excerpt, the title's link
	 * stretched over the whole card. The date line adds the journal, with its
	 * colour as a dot.
	 *
	 * ---------------------------------------------------------------------------
	 * INSIDE A JOURNAL
	 * ---------------------------------------------------------------------------
	 * With `journal`, the results are that journal's search (its page's field):
	 * the date line is the date alone, as on the journal page's own cards, since
	 * every result is in the journal named above; Show more links to the journal
	 * page's next page and asks `/search/results` with the journal; and nothing
	 * found says so for that journal, with a link to the same query across every
	 * journal in place of the Recycle Bin's. There are no journals to draw: the
	 * search asks for none.
	 *
	 * ---------------------------------------------------------------------------
	 * FILTERS
	 * ---------------------------------------------------------------------------
	 * `filters` are what these results are for: Show more carries them, in its
	 * link and its request. With any set there are no journals (the search asks
	 * for none), the query may be empty (every entry the filters allow), and
	 * nothing found says "match these filters". To before From draws nothing
	 * here: the fields say it.
	 */
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import Highlighted from '$lib/components/Highlighted.svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import { formatDay } from '$lib/format/date';
	import { COLOR_STYLES, toColor } from '$lib/journals/appearance';
	import { CARD, CARD_LINK } from '$lib/layout/card';
	import { isFiltered, NO_FILTERS, type SearchFilters } from '$lib/search/filters';
	import {
		countLine,
		entryCountLabel,
		pageQueryString,
		resultsQueryString,
		type SearchOutcome
	} from '$lib/search/results';

	let {
		outcome,
		filters = NO_FILTERS,
		journal = null,
		words = null
	}: {
		outcome: SearchOutcome;
		/** The filters `outcome` is for. */
		filters?: SearchFilters;
		/** The journal searched, or `null` for every journal. */
		journal?: { id: string; name: string } | null;
		/**
		 * The words to mark, from the field as it is now (`markWords`), or `null`
		 * for the marks the server placed.
		 */
		words?: string[] | null;
	} = $props();

	/** The page a Show more link loads without JavaScript. */
	let path = $derived(
		journal === null
			? resolve('/search')
			: resolve('/journals/[journalId]', { journalId: journal.id })
	);

	const id = $props.id();

	let filtered = $derived(isFiltered(filters));

	/**
	 * The entries shown and the cursor after them. Derived, so that a new
	 * search starts again from its own first page; written to by Show more.
	 */
	let shown = $derived(
		outcome.kind === 'found'
			? { entries: outcome.entries, next: outcome.next }
			: { entries: [], next: null }
	);

	let loading = $state(false);
	let failed = $state(false);

	let list = $state<HTMLUListElement>();

	function nextPage(found: Extract<SearchOutcome, { kind: 'found' }>, after: string) {
		return { after, from: found.from + shown.entries.length };
	}

	async function showMore(event: MouseEvent) {
		if (outcome.kind !== 'found' || shown.next === null) {
			return;
		}
		// A new tab or window is the link's own business.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();
		if (loading) {
			return;
		}

		const asked = outcome;
		const before = shown.entries.length;
		loading = true;
		failed = false;
		try {
			const response = await fetch(
				`${resolve('/search/results')}${resultsQueryString(asked.query, { ...filters, journal: journal?.id ?? filters.journal }, nextPage(asked, shown.next))}`
			);
			const page = (await response.json()) as SearchOutcome;
			if (!response.ok || page.kind !== 'found') {
				throw new Error(`search results: ${response.status}`);
			}
			// Another search replaced this one while the page was on its way.
			if (outcome !== asked) {
				return;
			}
			shown = { entries: [...shown.entries, ...page.entries], next: page.next };
			await tick();
			list?.querySelectorAll<HTMLAnchorElement>(':scope > li h3 a')[before]?.focus();
		} catch {
			failed = outcome === asked;
		} finally {
			loading = false;
		}
	}
</script>

{#if outcome.kind === 'idle'}
	<p class="text-sm text-[#616161] dark:text-[#9E9E9E]">
		Search the titles and text of your entries, and the names of your journals.
	</p>
{:else if outcome.kind === 'short'}
	<p class="text-sm text-[#616161] dark:text-[#9E9E9E]">Type at least 2 characters.</p>
{:else if outcome.kind === 'found'}
	{#if outcome.journals.length > 0}
		<section aria-labelledby="{id}-journals" class="mb-8">
			<h2 id="{id}-journals" class="text-sm font-medium text-[#616161] dark:text-[#9E9E9E]">
				Journals
			</h2>
			<ul class="mt-3 space-y-2">
				{#each outcome.journals as journal (journal.journalId)}
					<li>
						<a
							href={resolve('/journals/[journalId]', { journalId: journal.journalId })}
							class="flex items-center gap-3 rounded-xl border border-[#E0E0E0] bg-white px-4 py-3 shadow-sm hover:border-[#1976D2] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:hover:border-[#1976D2]"
						>
							<span
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg {COLOR_STYLES[
									toColor(journal.color)
								].tile}"
							>
								<JournalIcon icon={journal.icon} class="h-5 w-5" />
							</span>
							<span class="min-w-0 flex-1">
								<span
									class="block font-medium wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
									data-part="name"><Highlighted parts={journal.name} {words} /></span
								>
								<span class="block text-sm text-[#616161] dark:text-[#9E9E9E]">
									{entryCountLabel(journal.entryCount)}
								</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if outcome.total === 0 && journal !== null}
		<div class="text-sm">
			<p class="wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
				{#if outcome.query === ''}
					No entries in {journal.name} match these filters.
				{:else}
					No entries in {journal.name} contain “{outcome.query}”{filtered
						? ' with these filters'
						: ''}.
				{/if}
			</p>
			<p class="mt-1">
				<a
					href="{resolve('/search')}{pageQueryString(outcome.query, { ...filters, journal: null })}"
					class="font-medium text-[#1976D2] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#90CAF9]"
					>Search all journals</a
				>
			</p>
		</div>
	{:else if outcome.total === 0}
		<div class="text-sm">
			<p class="wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
				{#if outcome.query === ''}
					No entries match these filters.
				{:else}
					No entries contain “{outcome.query}”{filtered ? ' with these filters' : ''}.
				{/if}
			</p>
			<p class="mt-1 text-[#616161] dark:text-[#9E9E9E]">
				Deleted entries aren’t searched.
				<a
					href={resolve('/bin')}
					class="font-medium text-[#1976D2] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:text-[#90CAF9]"
					>Open the Recycle Bin</a
				>
			</p>
		</div>
	{:else}
		<section aria-labelledby="{id}-entries">
			<h2 id="{id}-entries" class="text-sm font-medium text-[#616161] dark:text-[#9E9E9E]">
				{countLine(outcome.total, outcome.from, shown.entries.length)}
			</h2>
			<ul bind:this={list} class="mt-3 space-y-3">
				{#each shown.entries as hit (hit.entryId)}
					<li class={CARD}>
						<!-- `wrap-anywhere`: a 200-character title with no spaces still fits 320px. -->
						<h3 class="font-semibold wrap-anywhere text-[#212121] dark:text-[#F5F5F5]">
							<a
								href={resolve('/journals/[journalId]/entries/[entryId]', {
									journalId: hit.journalId,
									entryId: hit.entryId
								})}
								class={CARD_LINK}
							>
								{#if hit.title}<Highlighted parts={hit.title} {words} />{:else}<span
										class="text-[#616161] italic dark:text-[#9E9E9E]">Untitled</span
									>{/if}
							</a>
						</h3>

						<p
							class="mt-1 flex min-w-0 items-center gap-2 text-sm text-[#616161] dark:text-[#9E9E9E]"
						>
							{#if journal === null}
								<span
									aria-hidden="true"
									class="h-2.5 w-2.5 shrink-0 rounded-full {COLOR_STYLES[toColor(hit.journalColor)]
										.swatch}"
								></span>
								<span class="min-w-0 truncate" data-part="journal">{hit.journalName}</span>
								<span aria-hidden="true">·</span>
							{/if}
							<span class="shrink-0" data-part="date">{formatDay(hit.entryDate)}</span>
						</p>

						{#if hit.snippet.length > 0}
							<p
								class="mt-3 line-clamp-2 text-sm wrap-anywhere text-[#212121] dark:text-[#F5F5F5]"
								data-part="snippet"
							>
								<Highlighted parts={hit.snippet} {words} />
							</p>
						{/if}
					</li>
				{/each}
			</ul>

			{#if shown.next !== null}
				<div class="mt-6 flex flex-col items-center gap-2">
					<a
						href="{path}{pageQueryString(outcome.query, filters, nextPage(outcome, shown.next))}"
						onclick={showMore}
						aria-disabled={loading || undefined}
						class="rounded-lg border border-[#E0E0E0] bg-white px-4 py-2 text-sm font-medium text-[#212121] shadow-sm hover:border-[#1976D2] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:hover:border-[#1976D2]"
					>
						{loading ? 'Loading…' : 'Show more'}
					</a>
					{#if failed}
						<p role="alert" class="text-sm text-[#C62828] dark:text-[#EF9A9A]">
							Couldn’t load more. Try again.
						</p>
					{/if}
				</div>
			{/if}
		</section>
	{/if}
{/if}
