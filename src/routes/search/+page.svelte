<script lang="ts">
	/**
	 * Search. The field, search as you type and the address following it are
	 * `LiveSearchForm`, shared with a journal's page, which searches that journal.
	 * Elsewhere the top bar's icon and Ctrl/Cmd+K open the quick-search modal;
	 * here they focus this page's field (`pageSearch`).
	 *
	 * Drawn from the modal's answer when it handed one over (`data.refresh`, see
	 * `+page.ts`): the form follows the answer still on its way, and the picker's
	 * journals arrive with it.
	 */
	import { resolve } from '$app/paths';
	import LiveSearchForm from '$lib/components/LiveSearchForm.svelte';
	import type { PickerJournal } from '$lib/search/page-data';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** The picker's journals once a handed-over page's request answers. */
	let arrived = $state<{ from: PageData['refresh']; journals: PickerJournal[] } | null>(null);

	$effect(() => {
		const refresh = data.refresh;
		if (refresh === null) {
			return;
		}
		void refresh.journals.then((journals) => {
			if (journals !== null && data.refresh === refresh) {
				arrived = { from: refresh, journals };
			}
		});
	});

	let journals = $derived(
		arrived !== null && arrived.from === data.refresh ? arrived.journals : data.journals
	);
</script>

<main>
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Search</h1>

		<div class="mt-6">
			<LiveSearchForm
				path={resolve('/search')}
				query={data.query}
				outcome={data.outcome}
				filters={data.filters}
				refresh={data.refresh?.outcome ?? null}
				{journals}
				label="Search entries and journals"
				pageSearch
				title={(shown) => `${shown === '' ? 'Search' : `${shown} · Search`} · Noteworthy`}
			/>
		</div>
	</div>
</main>
