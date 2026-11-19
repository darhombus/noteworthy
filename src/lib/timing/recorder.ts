/**
 * The timing readout's recorder: what it listens to and observes, installed
 * only while the readout is drawn (the `nw-timing` cookie, `$lib/timing/cookie`),
 * and all of it removed by `destroy`. With the cookie absent this module is
 * never even loaded: the root layout imports the readout only when it is on.
 *
 * Everything is kept in module memory, in this document, and ends with it.
 * Addresses, links and paths are read here only to match a request to what
 * asked for it, and never leave this file: a row holds a route id and figures
 * (`$lib/timing/rows`).
 *
 * - **A tap**: the press (`pointerdown` or `touchstart`, on `window`, in the
 *   capture phase, so before SvelteKit's own `touchstart` preload starts the
 *   data request), then the navigation, then the new page drawn. "Drawn" is
 *   the first task after the frame that follows SvelteKit's `afterNavigate`
 *   (`requestAnimationFrame`, then `setTimeout(0)`): the DOM is the new page by
 *   `afterNavigate`, and the frame after it is the one that paints it. Paint
 *   itself cannot be seen from inside the page; this is the nearest moment
 *   after it that can. Its data request is the latest `__data.json` for the new
 *   address that started after the previous page was drawn (a hover's preload
 *   starts before the press, and is still this navigation's).
 * - **A document load**: Navigation Timing, and first contentful paint for
 *   "drawn"; and the redirects its request went through, which after a logout
 *   are the POST to `/logout` and its 303.
 * - **A form**: a `submit` posting to a page's action, the POST's request from
 *   Resource Timing (with its `Server-Timing`), and the page that followed it
 *   drawn: the redirect's navigation (login, signup), or the page updated in
 *   place (a refusal, a dialog's save). Counted from the press on the button
 *   that submitted it, which is then the form's and not the navigation's: that
 *   navigation gets a row of its own, counted from its start. Nothing the form
 *   held is read. A form the browser posts itself (logout, `/timing`) ends this
 *   document, and this one with it.
 * - **A return**: `visibilitychange` to hidden, then to visible.
 * - **A wake** (`$lib/wake`): its request, as Resource Timing reports it once it
 *   has ended, with its `Server-Timing` (`cold` when it met a new instance).
 * - **A media file**: each photo, video and audio in an entry, found as it is
 *   put on the page (a `MutationObserver`), shown at its `load` or
 *   `loadedmetadata`, with its request from Resource Timing.
 *
 * Resource Timing is read through a `PerformanceObserver` and its
 * `takeRecords()`, not the global buffer, which stops at 250 entries.
 */
import { WAKE_PATH } from '$lib/wake';
import {
	actionName,
	addRow,
	figuresOf,
	fromCache,
	redirectsOf,
	type MediaKind,
	type Row,
	type TimingEntry
} from './rows';

/** Entry media, as both the read view and the editor draw it. The collapsed row's thumbnail is not a file of its own. */
const MEDIA =
	'figure.entry-media img:not(.entry-media-thumb), figure.entry-media video, figure.entry-media audio';

/** Requests kept for matching: enough for a page's media and the last few taps. */
const KEPT_REQUESTS = 200;

export type NavigationStart = { type: string };
export type NavigationEnd = { type: string; route: string | null; url: URL };

export type Recorder = {
	navigationStarted(navigation: NavigationStart): void;
	navigationEnded(navigation: NavigationEnd): void;
	/** The page's state changed (`page.data`, `form`, `status` or `error`): a form's answer applied. */
	pageUpdated(): void;
	destroy(): void;
};

/** The route id of the page an address belongs to, `null` for none (an endpoint). */
export type RouteOf = (url: URL) => Promise<string | null>;

/** One page shown: when it began, and when it was drawn. */
type Shown = { start: number; drawn: number | null };

/** A form posted and not yet followed by its page. */
type Submission = {
	/** Its address without the fragment, to find its request by. */
	url: string;
	action: string | null;
	from: 'press' | 'submit';
	/** The press, or the submit. */
	at: number;
	/** The submit, which its request starts after. */
	submitted: number;
	/** `undefined` until known; a `null` route is not a page's action, and is dropped. */
	route: string | null | undefined;
	request: PerformanceResourceTiming | null;
	row: Extract<Row, { kind: 'form' }> | null;
	/** A navigation began after it: its page is the one that follows. */
	navigating: boolean;
	/** When the page that followed was drawn. */
	drawn: number | null;
	/** A page drawn before its request was seen: the one that follows if the request had ended by then. */
	drawnEarly: number | null;
};

/** A form's address as `use:enhance` posts to it: the button's `formaction`, else the form's own. */
function formAddress(form: HTMLFormElement, submitter: HTMLElement | null): URL {
	if (
		(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
		submitter.hasAttribute('formaction')
	) {
		return new URL(submitter.formAction);
	}
	// The attribute rather than `form.action`, which a field named `action` shadows.
	return new URL(form.getAttribute('action') ?? '', document.baseURI);
}

function formMethod(form: HTMLFormElement, submitter: HTMLElement | null): string {
	if (
		(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) &&
		submitter.hasAttribute('formmethod')
	) {
		return submitter.getAttribute('formmethod')!.toLowerCase();
	}
	return (form.getAttribute('method') ?? 'get').toLowerCase();
}

const withoutHash = (address: string) => address.split('#')[0];

/** The data request SvelteKit makes for `url`'s page. */
function dataPath(url: URL): string {
	return `${url.pathname.replace(/\/$/, '')}/__data.json`;
}

function kindOf(element: Element): MediaKind {
	if (element instanceof HTMLVideoElement) return 'video';
	if (element instanceof HTMLAudioElement) return 'audio';
	return 'photo';
}

/** A wake's request (`$lib/wake`), each seen once: the observer hands every entry over once. */
function isWake(entry: PerformanceResourceTiming): boolean {
	if (entry.initiatorType !== 'fetch') return false;
	const url = new URL(entry.name);
	return url.origin === location.origin && url.pathname === WAKE_PATH;
}

function timeOfDay(): string {
	return new Date().toTimeString().slice(0, 8);
}

export function startRecording(
	route: string | null,
	routeOf: RouteOf,
	onRows: (rows: Row[]) => void
): Recorder {
	let rows: Row[] = [];
	let lastReturn: number | null = null;
	let hiddenSince: number | null = document.visibilityState === 'hidden' ? performance.now() : null;
	let lastPress: number | null = null;
	let lastPressed: EventTarget | null = null;
	let submission: Submission | null = null;
	let started: { at: number; type: string } | null = null;
	const requests: PerformanceResourceTiming[] = [];

	/** The page on screen. The document's own, until the first navigation. */
	let current: Shown = { start: 0, drawn: null };
	/** Media rows waiting for their page's drawn moment. */
	const waiting: { row: Extract<Row, { kind: 'media' }>; page: Shown; shownAt: number }[] = [];

	const emit = () => onRows(rows);
	const push = (row: Row) => {
		rows = addRow(rows, row);
		emit();
	};
	const common = (at: number) => ({
		at,
		sinceReturn: lastReturn === null ? null : at - lastReturn
	});

	const observer = new PerformanceObserver((list) => keep(list.getEntries()));
	function keep(entries: PerformanceEntryList) {
		for (const entry of entries) {
			if (entry instanceof PerformanceResourceTiming) {
				requests.push(entry);
				if (isWake(entry)) {
					push({ kind: 'wake', figures: figuresOf(entry), ...common(performance.now()) });
				}
				if (
					submission !== null &&
					submission.request === null &&
					entry.initiatorType === 'fetch' &&
					withoutHash(entry.name) === submission.url &&
					entry.startTime >= submission.submitted
				) {
					submission.request = entry;
					if (submission.drawnEarly !== null && entry.responseEnd <= submission.drawnEarly) {
						submission.drawn = submission.drawnEarly;
					}
					formRow();
				}
			}
		}
		if (requests.length > KEPT_REQUESTS) {
			requests.splice(0, requests.length - KEPT_REQUESTS);
		}
	}
	/** Every request so far, those not yet delivered to the observer included. */
	function collect(): PerformanceResourceTiming[] {
		keep(observer.takeRecords());
		return requests;
	}
	observer.observe({ type: 'resource', buffered: true });

	// --- The document's own load -------------------------------------------
	// First contentful paint can come after this starts (the readout loads after
	// hydration, and a page drawn in the background paints late), so it is
	// observed, and the load's row follows it when it does.
	const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
	const firstPage = current;
	let loadRow: Extract<Row, { kind: 'load' }> | null = null;
	if (navigation !== undefined) {
		loadRow = {
			kind: 'load',
			route,
			how: navigation.type,
			drawn: null,
			redirects: redirectsOf(navigation),
			figures: figuresOf(navigation as TimingEntry),
			...common(performance.now())
		};
		push(loadRow);
	}
	const paints = new PerformanceObserver((list) => {
		const paint = list.getEntriesByName('first-contentful-paint')[0];
		if (paint === undefined) return;
		firstPage.drawn = paint.startTime;
		if (loadRow !== null) {
			const old = loadRow;
			const drawn = { ...old, drawn: paint.startTime };
			loadRow = drawn;
			rows = rows.map((row) => (row === old ? drawn : row));
			emit();
		}
		paints.disconnect();
	});
	paints.observe({ type: 'paint', buffered: true });

	// --- Presses -------------------------------------------------------------
	const onPress = (event: Event) => {
		lastPress = event.timeStamp;
		lastPressed = event.target;
	};
	const pressOptions = { capture: true, passive: true } as const;
	window.addEventListener('pointerdown', onPress, pressOptions);
	window.addEventListener('touchstart', onPress, pressOptions);

	// --- Forms ---------------------------------------------------------------
	/** The form's row, once its request has ended and its route is known. Drawn filled in later. */
	function formRow() {
		const posted = submission;
		if (posted === null || posted.route === undefined) return;
		// Not a page's action: `/theme`, whose form cancels its own submit, or an
		// endpoint. Dropped as soon as that is known, request or none.
		if (posted.route === null) {
			submission = null;
			return;
		}
		if (posted.request === null) return;
		if (posted.row === null) {
			posted.row = {
				kind: 'form',
				route: posted.route,
				action: posted.action,
				from: posted.from,
				drawn: null,
				figures: figuresOf(posted.request),
				...common(posted.at)
			};
			push(posted.row);
		}
		if (posted.drawn !== null) {
			const old = posted.row;
			const drawn = { ...old, drawn: posted.drawn - posted.at };
			rows = rows.map((row) => (row === old ? drawn : row));
			emit();
			submission = null;
		}
	}

	/** `posted`'s page is drawn now, or when its request turns out to have ended before now. */
	function followed(posted: Submission, at: number) {
		if (submission !== posted || posted.drawn !== null) return;
		collect();
		if (posted.request !== null) {
			posted.drawn = at;
			formRow();
		} else {
			posted.drawnEarly = at;
		}
	}

	// Bubbling, at the window: `use:enhance` has had the event first, on the form.
	const onSubmit = (event: Event) => {
		const form = event.target;
		if (!(event instanceof SubmitEvent) || !(form instanceof HTMLFormElement)) return;
		const submitter = event.submitter;
		if (formMethod(form, submitter) !== 'post') return;
		const address = formAddress(form, submitter);
		if (address.origin !== location.origin) return;
		// The press on the button that submitted it, since the page last changed.
		// Enter in a field submits through the default button too, but no press on
		// it led there, so that is counted from the submit.
		const pressed =
			lastPress !== null &&
			submitter !== null &&
			lastPressed instanceof Node &&
			submitter.contains(lastPressed) &&
			(current.drawn === null || lastPress >= current.drawn);
		const posted: Submission = {
			url: withoutHash(address.href),
			action: actionName(address.search),
			from: pressed ? 'press' : 'submit',
			at: pressed ? (lastPress as number) : event.timeStamp,
			submitted: event.timeStamp,
			route: undefined,
			request: null,
			row: null,
			navigating: false,
			drawn: null,
			drawnEarly: null
		};
		submission = posted;
		// The press is the form's: the navigation its answer may start is not a tap.
		lastPress = null;
		void routeOf(address).then(
			(found) => {
				posted.route = found;
				if (submission === posted) formRow();
			},
			() => {
				posted.route = null;
				if (submission === posted) formRow();
			}
		);
	};
	window.addEventListener('submit', onSubmit);

	// --- Returns -------------------------------------------------------------
	const onVisibility = () => {
		const now = performance.now();
		if (document.visibilityState === 'hidden') {
			hiddenSince = now;
			return;
		}
		if (hiddenSince === null) {
			return;
		}
		const hidden = now - hiddenSince;
		hiddenSince = null;
		// Counted from the return before this one.
		const row: Row = { kind: 'return', hidden, visibleAt: timeOfDay(), ...common(now) };
		lastReturn = now;
		push(row);
	};
	document.addEventListener('visibilitychange', onVisibility);

	// --- Media ---------------------------------------------------------------
	const seen = new WeakSet<Element>();
	// One signal for every media listener, so that nothing holds on to an
	// element after the page drops it, and `destroy` removes them all.
	const media = new AbortController();

	function mediaShown(element: HTMLImageElement | HTMLMediaElement, early: boolean) {
		const shownAt = performance.now();
		const page = current;
		const link = element.currentSrc;
		const kind = kindOf(element);
		const request =
			collect()
				.filter((entry) => entry.name === link && entry.startTime >= page.start)
				.at(-1) ?? null;
		const row: Extract<Row, { kind: 'media' }> = {
			kind: 'media',
			media: kind,
			cache: fromCache(kind, request),
			shown: null,
			early,
			figures: request === null ? null : figuresOf(request),
			...common(shownAt)
		};
		if (early) {
			// Shown before this was running: when exactly is unknown, so its
			// request's end stands in for it.
			row.shown = Math.max(0, (request?.responseEnd ?? 0) - (page.drawn ?? 0));
		} else if (page.drawn !== null) {
			row.shown = Math.max(0, shownAt - page.drawn);
		} else {
			waiting.push({ row, page, shownAt });
		}
		push(row);
	}

	function watch(element: Element, early: boolean) {
		if (seen.has(element)) return;
		seen.add(element);
		if (!(element instanceof HTMLImageElement || element instanceof HTMLMediaElement)) return;
		const type = element instanceof HTMLImageElement ? 'load' : 'loadedmetadata';
		element.addEventListener(type, () => mediaShown(element, false), { signal: media.signal });
		const ready =
			element instanceof HTMLImageElement
				? element.complete && element.naturalWidth > 0
				: element.readyState >= HTMLMediaElement.HAVE_METADATA;
		if (early && ready) {
			mediaShown(element, true);
		}
	}

	function scan(root: ParentNode, early: boolean) {
		if (root instanceof Element && root.matches(MEDIA)) watch(root, early);
		root.querySelectorAll(MEDIA).forEach((element) => watch(element, early));
	}

	const mutations = new MutationObserver((changes) => {
		for (const change of changes) {
			change.addedNodes.forEach((node) => {
				if (node instanceof Element) scan(node, false);
			});
		}
	});
	mutations.observe(document.body, { childList: true, subtree: true });
	scan(document, true);

	// --- Navigations ---------------------------------------------------------
	return {
		navigationStarted({ type }) {
			started = { at: performance.now(), type };
			if (submission !== null) {
				submission.navigating = true;
			}
		},
		navigationEnded({ type, route: to, url }) {
			// The form whose answer started this navigation, if one did: its page is this one.
			const posted = submission?.navigating ? submission : null;
			const start = started?.at ?? performance.now();
			const previous = current;
			const pressed =
				lastPress !== null &&
				lastPress <= start &&
				(previous.drawn === null || lastPress >= previous.drawn) &&
				type !== 'popstate';
			const from = pressed ? (lastPress as number) : start;
			const page: Shown = { start: from, drawn: null };
			current = page;
			started = null;
			lastPress = null;

			requestAnimationFrame(() => {
				setTimeout(() => {
					const drawn = performance.now();
					page.drawn = drawn;
					const path = dataPath(url);
					const data =
						collect()
							.filter(
								(entry) =>
									entry.initiatorType === 'fetch' &&
									new URL(entry.name).pathname === path &&
									entry.startTime >= (previous.drawn ?? 0) &&
									entry.startTime <= drawn
							)
							.at(-1) ?? null;
					push({
						kind: 'tap',
						route: to,
						how: type,
						from: pressed ? 'press' : 'start',
						drawn: drawn - from,
						figures: data === null ? null : figuresOf(data),
						...common(drawn)
					});
					if (posted !== null) {
						followed(posted, drawn);
					}
					// The page's media shown before this moment: shown with the page. A
					// new object for each, so that whoever draws the rows sees the change.
					const settled = new Map<Row, Row>();
					for (let index = waiting.length - 1; index >= 0; index -= 1) {
						const item = waiting[index];
						if (item.page === page) {
							settled.set(item.row, { ...item.row, shown: Math.max(0, item.shownAt - drawn) });
							waiting.splice(index, 1);
						}
					}
					if (settled.size > 0) {
						rows = rows.map((row) => settled.get(row) ?? row);
						emit();
					}
				}, 0);
			});
		},
		pageUpdated() {
			const posted = submission;
			if (posted === null || posted.navigating || posted.drawn !== null) return;
			// Drawn as a navigation's page is: the first task after the next frame.
			requestAnimationFrame(() => {
				setTimeout(() => followed(posted, performance.now()), 0);
			});
		},
		destroy() {
			window.removeEventListener('submit', onSubmit);
			observer.disconnect();
			paints.disconnect();
			mutations.disconnect();
			window.removeEventListener('pointerdown', onPress, pressOptions);
			window.removeEventListener('touchstart', onPress, pressOptions);
			document.removeEventListener('visibilitychange', onVisibility);
			media.abort();
		}
	};
}
