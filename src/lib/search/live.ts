/**
 * Search as you type: when to ask, which answer to show, and when to say it is
 * still asking.
 *
 * Knows nothing about Svelte or the DOM, as `$lib/entries/autosave` does not:
 * it is told what the field holds and when composition starts and ends, asks
 * through the function it is given, and reports what to show through
 * `onChange`. `live.test.ts` drives it on fake timers. The search page and a
 * journal's page use it (through `LiveSearchForm.svelte`) with the page's URL
 * following along; the quick-search modal (`QuickSearch.svelte`) without.
 *
 * ---------------------------------------------------------------------------
 * WHEN IT ASKS
 * ---------------------------------------------------------------------------
 * `PAUSE_MS` after the last change, and at once on Enter (`submit`). A query
 * under 2 characters, or none, is never asked about: what it shows
 * (`withoutSearching`) is known here. Clearing the field shows the no-query
 * message at once; a single character waits for the same pause as any other
 * change, so typing a word never flashes "Type at least 2 characters" on its
 * first letter.
 *
 * A change made while an input method is composing is a change like any
 * other, and is asked about after the same pause. Android keyboards such as
 * Gboard keep the word being typed in a composition until a space or a
 * suggestion ends it, so waiting for composition to end would search nothing
 * until each word was finished. Enter pressed during a composition confirms a
 * suggestion: it does not search at once (the pause from the last change
 * still runs), and the page does not let it submit the form. Composition
 * ending needs nothing of its own: Chromium sends every change, the commit
 * included, as an `input` before `compositionend` (docs/constraints.md, "Search
 * as you type"), so all it does here is say composing is over, for Enter.
 *
 * ---------------------------------------------------------------------------
 * ONLY THE LATEST ANSWER
 * ---------------------------------------------------------------------------
 * One request at a time is current. A new one aborts the one before, and an
 * answer that arrives for any request but the current one is dropped, success
 * or failure: aborting saves a phone the rest of a response nobody will see,
 * and the check holds even for an answer that was already on its way when the
 * abort came. While a request is out, the results already shown stay shown.
 *
 * ---------------------------------------------------------------------------
 * "SEARCHING…"
 * ---------------------------------------------------------------------------
 * `searching` turns on only when a request has been out for
 * `SEARCHING_AFTER_MS`, and off the moment it is answered or dropped. An answer
 * inside that never shows it: results changing is signal enough, and a word
 * that blinks on and off at every pause is noise. 300 ms is about where a wait
 * starts to be noticed as one. Over a slow mobile connection a round trip to Frankfurt is
 * probably near that on its own (not measured over one), so it will often
 * show; close to the servers it will not.
 *
 * ---------------------------------------------------------------------------
 * FILTERS
 * ---------------------------------------------------------------------------
 * What is asked is the query and the filters together. A pill chosen asks at
 * once (`choose`); a day typed into Custom's fields waits for the same pause
 * as typing (`choose(…, { wait: true })`), since a date field reports each
 * digit of a year as it goes. Both take the field as it was last typed. The
 * same latest-wins rules hold for either. A change of `when` alone (This week
 * to Custom, which keeps the days) asks nothing: the results are the same,
 * and only the filters shown, and so the address, change.
 *
 * ---------------------------------------------------------------------------
 * AN ANSWER ASKED ELSEWHERE
 * ---------------------------------------------------------------------------
 * `follow` takes an answer already on its way for what the field holds: the
 * search page's load, when the quick-search modal handed its results over and
 * the page was drawn with them at once (docs/constraints.md, "Quick search").
 * It is treated as a request of this controller's own: anything typed or
 * chosen after it makes it old and it is dropped, it says "Searching…" after
 * the same wait, and a failure keeps what is shown and says so. One thing
 * differs: when what is shown is not for the field (the modal's answer was
 * for fewer letters, or it had none yet), "Searching…" shows at once, since
 * what is on screen is already known to be out of date.
 */
import { NO_FILTERS, sameFilters, sameResults, type SearchFilters } from './filters';
import { resultsQueryString, shownQuery, withoutSearching, type SearchOutcome } from './results';
import { normaliseQuery } from './text';

/**
 * The pause after the last change before asking. 300 until 2026-10-02; the
 * highlights follow every keystroke now (`markWords`), so a shorter pause only
 * has to cover the time between keys.
 */
export const PAUSE_MS = 200;

/** How long a request is out before "Searching…" shows. */
export const SEARCHING_AFTER_MS = 300;

export type LiveSnapshot = {
	outcome: SearchOutcome;
	/** The filters `outcome` is for. */
	filters: SearchFilters;
	/** A request has been out for `SEARCHING_AFTER_MS` and is not answered. */
	searching: boolean;
	/** The latest request failed. The results before it are still shown. */
	failed: boolean;
};

/** Asks for the first page of `query` under `filters`, or throws. */
export type Ask = (
	query: string,
	signal: AbortSignal,
	/** Always given by the controller; none when left out. */
	filters?: SearchFilters
) => Promise<SearchOutcome>;

export type LiveSearchOptions = {
	ask: Ask;
	onChange: (snapshot: LiveSnapshot) => void;
	/** An outcome was put on screen because of what was typed or chosen (not by `adopt`). */
	onShown?: (outcome: SearchOutcome, filters: SearchFilters) => void;
	/** The filters `initial` is for; none when left out. */
	filters?: SearchFilters;
	/** The field's text, when it is not `initial`'s query: see `follow`. */
	typed?: string;
};

export type LiveSearch = {
	/** The field changed. */
	input(value: string): void;
	/** Composition started and ended: only Enter reads it. */
	compositionStart(): void;
	compositionEnd(): void;
	/** Enter: search now. */
	submit(value: string): void;
	/**
	 * The filters changed: search now, or, with `wait`, after the pause (a day
	 * being typed into a date field).
	 */
	choose(filters: SearchFilters, options?: { wait?: boolean }): void;
	/**
	 * Show `outcome`, loaded some other way, and forget anything pending.
	 * `typed` is the field's text when it is not `outcome`'s query.
	 */
	adopt(outcome: SearchOutcome, filters?: SearchFilters, typed?: string): void;
	/** Show `answer`, asked some other way, for the field as it is: see above. */
	follow(answer: Promise<SearchOutcome>): void;
	/** Stop the timers and the request. */
	destroy(): void;
};

/**
 * `ask` over `/search/results`: the same `runSearch` the page's load calls.
 * `endpoint` is `resolve('/search/results')`; `journal` limits the search to
 * that journal's entries (a journal page's own), `null` to leave it to the
 * filters.
 */
export function askEndpoint(
	endpoint: string,
	journal: string | null = null,
	fetcher: typeof fetch = fetch
): Ask {
	return async (query, signal, filters = NO_FILTERS) => {
		const scope = { ...filters, journal: journal ?? filters.journal };
		const response = await fetcher(`${endpoint}${resultsQueryString(query, scope)}`, { signal });
		const outcome = (await response.json()) as SearchOutcome;
		if (!response.ok || outcome.kind !== 'found') {
			throw new Error(`search results: ${response.status}`);
		}
		return outcome;
	};
}

export function createLiveSearch(initial: SearchOutcome, options: LiveSearchOptions): LiveSearch {
	let outcome = initial;
	/** The filters `outcome` is for. */
	let shownFilters = options.filters ?? NO_FILTERS;
	/** The filters last chosen, shown or not. */
	let wanted = shownFilters;
	/** The field as last typed. */
	let typed = options.typed ?? shownQuery(initial);
	let searching = false;
	let failed = false;
	let composing = false;

	let pause: ReturnType<typeof setTimeout> | undefined;
	let slow: ReturnType<typeof setTimeout> | undefined;
	let current: { query: string; filters: SearchFilters; controller: AbortController } | null = null;

	function emit() {
		options.onChange({ outcome, filters: shownFilters, searching, failed });
	}

	function stopPause() {
		clearTimeout(pause);
		pause = undefined;
	}

	/** Drops the request that is out, if any. Does not emit. */
	function drop() {
		clearTimeout(slow);
		searching = false;
		current?.controller.abort();
		current = null;
	}

	function show(next: SearchOutcome, filters: SearchFilters) {
		outcome = next;
		shownFilters = filters;
		failed = false;
		emit();
		options.onShown?.(next, filters);
	}

	async function ask(
		query: string,
		filters: SearchFilters,
		/** Where the answer comes from: `options.ask` unless `follow` brought one. */
		source: ((signal: AbortSignal) => Promise<SearchOutcome>) | null = null,
		/** What is shown is known to be out of date: say "Searching…" at once. */
		stale = false
	) {
		drop();
		const request = { query, filters, controller: new AbortController() };
		current = request;
		if (stale) {
			searching = true;
			emit();
		} else {
			slow = setTimeout(() => {
				if (current === request) {
					searching = true;
					emit();
				}
			}, SEARCHING_AFTER_MS);
		}

		let answer: SearchOutcome;
		try {
			answer = await (source ?? ((signal) => options.ask(query, signal, filters)))(
				request.controller.signal
			);
		} catch {
			if (current !== request) {
				return;
			}
			drop();
			failed = true;
			emit();
			return;
		}
		if (current !== request) {
			return;
		}
		drop();
		// `request.filters`, not `filters`: `apply` may have moved its `when` since.
		show(answer, request.filters);
	}

	function apply() {
		stopPause();
		const query = normaliseQuery(typed);
		const filters = wanted;

		const local = withoutSearching(query, filters);
		if (local !== null) {
			drop();
			show(local, filters);
			return;
		}
		if (current !== null && current.query === query && sameResults(current.filters, filters)) {
			// The same rows are on their way; they will be shown with these filters.
			current.filters = filters;
			return;
		}
		// Back to what is on screen before the answer for something else came:
		// that answer is no longer wanted. After a failure, the same query is
		// asked again: that is how Enter retries.
		if (!failed && shownQuery(outcome) === query && sameResults(shownFilters, filters)) {
			const wasSearching = searching;
			drop();
			if (!sameFilters(shownFilters, filters)) {
				// Only `when` moved: the same results, under the pill now chosen.
				show(outcome, filters);
			} else if (wasSearching) {
				emit();
			}
			return;
		}
		void ask(query, filters);
	}

	function input(value: string) {
		typed = value;
		stopPause();
		// Clearing the field is not a query being typed: nothing to wait for.
		if (normaliseQuery(value) === '') {
			apply();
			return;
		}
		pause = setTimeout(apply, PAUSE_MS);
	}

	return {
		input,

		compositionStart() {
			composing = true;
		},

		compositionEnd() {
			composing = false;
		},

		submit(value) {
			typed = value;
			// Enter confirming a suggestion.
			if (composing) {
				return;
			}
			apply();
		},

		choose(filters, { wait = false } = {}) {
			wanted = filters;
			stopPause();
			if (wait) {
				pause = setTimeout(apply, PAUSE_MS);
			} else {
				apply();
			}
		},

		adopt(next, filters = NO_FILTERS, text = shownQuery(next)) {
			stopPause();
			drop();
			outcome = next;
			shownFilters = filters;
			wanted = filters;
			typed = text;
			failed = false;
			emit();
		},

		follow(answer) {
			stopPause();
			const query = normaliseQuery(typed);
			void ask(query, wanted, () => answer, shownQuery(outcome) !== query);
		},

		destroy() {
			stopPause();
			drop();
		}
	};
}
