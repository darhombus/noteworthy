<script lang="ts">
	/**
	 * Search's filters, under the field on `/search` and a journal's page: one
	 * `FilterRow` holding the journal picker (on `/search` only, when `journals`
	 * is given), then the date pills, one chosen at a time; and under the row,
	 * while Custom is chosen, its From and To fields (`CustomDays`).
	 *
	 * It only reports: `onchoose` gets the filters wanted, and the page's
	 * controller asks. A pill's days come from the browser's own calendar
	 * (`todayIn`), never the server's.
	 *
	 * Without JavaScript, inside the page's GET form: the picker is a
	 * `<select name="journal">` and Custom's fields are `since` and `until`,
	 * submitted with the Search button; Any time and Custom are submit buttons
	 * (`when=any`, `when=custom`), which reload the page with that pill. The
	 * presets need the browser's calendar, which only script can read, so
	 * without it they do nothing; a preset in the address keeps its days, sent
	 * as hidden fields with `when` (not rolled: rolling needs script). The
	 * hidden `when` comes after the pills, so a pill's own `when` is the first
	 * in the submission and wins; it is left out for Any time. The picker always
	 * submits, so a plain search from `/search` is `?q=…&journal=`.
	 *
	 * The picker is a native `<select>` drawn as a pill: it works without script,
	 * a phone gives it its own picker, and it sizes to the journal chosen
	 * (`field-sizing: content`, where supported; elsewhere to the longest name,
	 * held under 14rem).
	 */
	import CustomDays from '$lib/components/CustomDays.svelte';
	import FilterPill, { PILL, PILL_OFF, PILL_ON } from '$lib/components/FilterPill.svelte';
	import FilterRow from '$lib/components/FilterRow.svelte';
	import {
		choosePill,
		isReversed,
		todayIn,
		WHEN_LABELS,
		WHENS,
		type SearchFilters,
		type When
	} from '$lib/search/filters';

	let {
		filters,
		journals,
		custom,
		onchoose
	}: {
		/** The filters chosen. */
		filters: SearchFilters;
		/** The picker's journals, by name; left out, there is no picker. */
		journals?: Array<{ id: string; name: string }>;
		/** Changes whenever Custom's fields must be made again to show `filters`' days. */
		custom: number;
		onchoose: (filters: SearchFilters, options?: { wait?: boolean }) => void;
	} = $props();

	const id = $props.id();

	/** Without script these submit the form; see above. */
	const SUBMITS: Partial<Record<When, true>> = { any: true, custom: true };

	let unknownJournal = $derived(
		filters.journal !== null &&
			journals !== undefined &&
			!journals.some((journal) => journal.id === filters.journal)
	);

	function pick(when: When) {
		onchoose(choosePill(filters, when, todayIn(new Date())));
	}

	function pickJournal(value: string) {
		onchoose({ ...filters, journal: value === '' ? null : value });
	}
</script>

<FilterRow label="Filters" selected={filters.when}>
	{#if journals !== undefined}
		<label for="{id}-journal" class="sr-only">Journal</label>
		<select
			id="{id}-journal"
			name="journal"
			onchange={(event) => pickJournal(event.currentTarget.value)}
			class="{PILL} {filters.journal !== null
				? PILL_ON
				: PILL_OFF} [field-sizing:content] max-w-56 truncate bg-[length:1.25em] bg-[right_0.5rem_center] pr-8"
		>
			<option value="" selected={filters.journal === null}>All journals</option>
			{#if unknownJournal && filters.journal !== null}
				<option value={filters.journal} selected>Journal not available</option>
			{/if}
			{#each journals as journal (journal.id)}
				<option value={journal.id} selected={journal.id === filters.journal}>{journal.name}</option>
			{/each}
		</select>
	{/if}

	{#each WHENS as when (when)}
		<FilterPill
			pressed={filters.when === when}
			onchoose={() => pick(when)}
			name={SUBMITS[when] ? 'when' : undefined}
			value={SUBMITS[when] ? when : undefined}
		>
			{WHEN_LABELS[when]}
		</FilterPill>
	{/each}
</FilterRow>
<!-- Only what differs from the default, so a plain search submits `?q=` alone. -->
{#if filters.when !== 'any'}
	<input type="hidden" name="when" value={filters.when} />
{/if}
<!-- A preset's days, which without script only the address knows; Custom's are its fields. -->
{#if filters.when !== 'any' && filters.when !== 'custom'}
	{#if filters.since !== null}<input type="hidden" name="since" value={filters.since} />{/if}
	{#if filters.until !== null}<input type="hidden" name="until" value={filters.until} />{/if}
{/if}

{#if filters.when === 'custom'}
	{#key custom}
		<CustomDays
			since={filters.since}
			until={filters.until}
			reversed={isReversed(filters)}
			onchange={(days) => onchoose({ ...filters, ...days }, { wait: true })}
		/>
	{/key}
{/if}
