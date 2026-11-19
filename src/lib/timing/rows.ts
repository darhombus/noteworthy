/**
 * What the timing readout records, and how a row reads, as plain data: no
 * DOM, no browser, so the unit tests can hold every rule here.
 *
 * A row holds timings, a route id (`/journals/[journalId]`, never the
 * address), a form action's name as the code gives it, a media kind and a time
 * of day, and nothing else: no title, no name, no id, no link, no storage path
 * and nothing a form held, ever. That is what lets Copy put
 * the rows on the clipboard for a chat.
 *
 * See docs/constraints.md, "The timing readout".
 */

/** The newest rows kept; older ones are dropped. */
export const MAX_ROWS = 30;

/** One request's figures, from Resource Timing or Navigation Timing. */
export type Figures = {
	/**
	 * `false` when the browser hid the detail: a request to another origin that
	 * sent no `Timing-Allow-Origin`. Then only `total` is real.
	 */
	detailed: boolean;
	/** Start to end of the request, in ms. Always real. */
	total: number;
	dns: number | null;
	/** TCP and TLS together, or `reused` for a connection already open. */
	connect: number | 'reused' | null;
	/** TLS alone; `null` over plain HTTP or a reused connection. */
	tls: number | null;
	/** Request sent to first byte. */
	wait: number | null;
	/** First byte to last. */
	download: number | null;
	/** Bytes over the wire, headers included; `null` when hidden. */
	transferred: number | null;
	/** The response's `Server-Timing`, name and duration. */
	server: [string, number][];
};

/**
 * The fields of a `PerformanceResourceTiming` (or navigation entry) read here.
 * Typed out so the tests can pass plain objects.
 */
export type TimingEntry = Pick<
	PerformanceResourceTiming,
	| 'startTime'
	| 'duration'
	| 'fetchStart'
	| 'domainLookupStart'
	| 'domainLookupEnd'
	| 'connectStart'
	| 'connectEnd'
	| 'secureConnectionStart'
	| 'requestStart'
	| 'responseStart'
	| 'responseEnd'
	| 'transferSize'
	| 'decodedBodySize'
> & { serverTiming?: readonly Pick<PerformanceServerTiming, 'name' | 'duration'>[] };

/**
 * Whether the browser exposed the detail of `entry`. Without
 * `Timing-Allow-Origin` a request to another origin reads 0 for every point
 * between `fetchStart` and `responseEnd` (Resource Timing's "opaque" timing),
 * and a request always has a `requestStart` once it really went out.
 */
export function detailed(entry: TimingEntry): boolean {
	return entry.requestStart > 0 || entry.responseStart > 0;
}

export function figuresOf(entry: TimingEntry): Figures {
	const server = (entry.serverTiming ?? []).map(
		({ name, duration }) => [name, duration] as [string, number]
	);
	if (!detailed(entry)) {
		return {
			detailed: false,
			total: entry.duration,
			dns: null,
			connect: null,
			tls: null,
			wait: null,
			download: null,
			transferred: null,
			server
		};
	}
	// A connection already open shows no lookup and no connect: all of them at
	// `fetchStart`. Zeros would read as "instant", which is not what happened.
	const reused =
		entry.domainLookupStart === entry.domainLookupEnd &&
		entry.connectStart === entry.connectEnd &&
		entry.connectStart === entry.fetchStart;
	return {
		detailed: true,
		total: entry.duration,
		dns: reused ? null : entry.domainLookupEnd - entry.domainLookupStart,
		connect: reused ? 'reused' : entry.connectEnd - entry.connectStart,
		tls:
			reused || entry.secureConnectionStart <= 0
				? null
				: entry.connectEnd - entry.secureConnectionStart,
		wait: entry.responseStart - entry.requestStart,
		download: entry.responseEnd - entry.responseStart,
		transferred: entry.transferSize,
		server
	};
}

/**
 * Whether a media file came from the browser's cache.
 *
 * - No request in this page's time (`entry` null) for a photo: the browser
 *   drew it from the images it already holds for this document, without
 *   asking anybody (measured: a photo shown again with the same link makes no
 *   request). `yes`.
 * - No request for a player: `unknown`. A player's request is reported only
 *   when it ends, and a video's may still be running when its length is known.
 * - A request with its detail: `yes` when nothing came over the wire
 *   (`transferSize` 0 with a body), else `no`.
 * - A request with its detail hidden (Storage on another origin, without
 *   `Timing-Allow-Origin`): `unknown`. The browser's disk cache and the
 *   network look the same from here; `total` is the only clue, shown beside it.
 */
export type CacheVerdict = 'yes' | 'no' | 'unknown';

export function fromCache(kind: MediaKind, entry: TimingEntry | null): CacheVerdict {
	if (entry === null) {
		return kind === 'photo' ? 'yes' : 'unknown';
	}
	if (!detailed(entry)) {
		return 'unknown';
	}
	return entry.transferSize === 0 && entry.decodedBodySize > 0 ? 'yes' : 'no';
}

export type MediaKind = 'photo' | 'video' | 'audio';

/**
 * The redirects a document's own request went through before its answer, from
 * Navigation Timing: how many, and from the first one's start to the last
 * one's end. Same-origin only, which every redirect in the app is; another
 * origin's reads as none. A logout's POST and its 303 are one: that document
 * has ended, and this is the part of it the next one can see.
 */
export type Redirects = { count: number; duration: number };

export function redirectsOf(
	entry: Pick<PerformanceNavigationTiming, 'redirectCount' | 'redirectStart' | 'redirectEnd'>
): Redirects | null {
	if (entry.redirectCount === 0 || entry.redirectEnd <= 0) {
		return null;
	}
	return { count: entry.redirectCount, duration: entry.redirectEnd - entry.redirectStart };
}

/**
 * A form action's name, from its address's query (`?/create`), or `null` for
 * the default action. Only a name as code writes one is kept, so whatever
 * else a query might hold never reaches a row.
 */
export function actionName(search: string): string | null {
	const named = /^\?\/([A-Za-z][\w-]*)(?:&|$)/.exec(search);
	return named === null ? null : named[1];
}

type Common = {
	/** ms since the document began (`performance.now()`), when the row was made. */
	at: number;
	/** ms since the latest return to the page, or `null` before any. */
	sinceReturn: number | null;
};

export type Row = Common &
	(
		| {
				kind: 'load';
				route: string | null;
				/** Navigation Timing's `type`: navigate, reload, back_forward, prerender. */
				how: string;
				/** First contentful paint, from the document's start; `null` if none. */
				drawn: number | null;
				/** What its request was redirected through first; `null` for none. */
				redirects: Redirects | null;
				figures: Figures;
		  }
		| {
				/**
				 * A form posted to a page's action (`use:enhance`), and the page that
				 * followed it: the redirect's page, or this one updated.
				 */
				kind: 'form';
				/** The route id of the page whose action it was. */
				route: string;
				/** The action's name; `null` for the default action. */
				action: string | null;
				/** Counted from the press on the button, or from the submit when none led to it (Enter). */
				from: 'press' | 'submit';
				/** ms from there to the page that followed being drawn; `null` until it is. */
				drawn: number | null;
				/** The POST's own figures, its `Server-Timing` among them. */
				figures: Figures;
		  }
		| {
				kind: 'tap';
				route: string | null;
				/** SvelteKit's navigation type: link, form, goto, popstate. */
				how: string;
				/** Counted from the press, or from the navigation's start when no press led to it. */
				from: 'press' | 'start';
				/** ms from there to the new page being drawn. */
				drawn: number;
				/** Its `__data.json` request; `null` when it made none. */
				figures: Figures | null;
		  }
		| {
				kind: 'return';
				/** How long the page was hidden, in ms. */
				hidden: number;
				/** Time of day it became visible, `HH:MM:SS`. */
				visibleAt: string;
		  }
		| {
				/** A wake (`$lib/wake`): its request's figures, `cold` among them when it met a new instance. */
				kind: 'wake';
				figures: Figures;
		  }
		| {
				kind: 'media';
				media: MediaKind;
				cache: CacheVerdict;
				/**
				 * ms from the page being drawn to the file being shown (a photo's
				 * `load`, a player's `loadedmetadata`); `null` while the page's drawn
				 * moment is not yet known. 0 when it was shown with the page.
				 */
				shown: number | null;
				/** Shown before the readout was running (a document's first media). */
				early: boolean;
				figures: Figures | null;
		  }
	);

/** `rows` with `row` added, the oldest dropped past `MAX_ROWS`. */
export function addRow(rows: readonly Row[], row: Row): Row[] {
	const next = [...rows, row];
	return next.length > MAX_ROWS ? next.slice(next.length - MAX_ROWS) : next;
}

const ms = (value: number) => `${Math.round(value)}`;

function describeFigures(figures: Figures): string {
	const parts: string[] = [];
	if (!figures.detailed) {
		parts.push(`request ${ms(figures.total)}ms (detail hidden)`);
	} else {
		if (figures.connect === 'reused') {
			parts.push('conn reused');
		} else {
			parts.push(`dns ${ms(figures.dns ?? 0)}`);
			parts.push(`conn ${ms(figures.connect ?? 0)}`);
			if (figures.tls !== null) {
				parts.push(`tls ${ms(figures.tls)}`);
			}
		}
		parts.push(`wait ${ms(figures.wait ?? 0)}`);
		parts.push(`dl ${ms(figures.download ?? 0)}`);
	}
	if (figures.server.length > 0) {
		parts.push(`server ${figures.server.map(([name, dur]) => `${name} ${ms(dur)}`).join(' ')}`);
	}
	return parts.join(' · ');
}

function seconds(value: number): string {
	return `${(value / 1000).toFixed(1)}s`;
}

/** One row as one line of plain text. */
export function describeRow(row: Row): string {
	const parts: string[] = [];
	switch (row.kind) {
		case 'load':
			parts.push(`load ${row.route ?? '(no route)'}`);
			parts.push(row.drawn === null ? 'not drawn yet' : `drawn ${ms(row.drawn)}ms`);
			parts.push(row.how);
			if (row.redirects !== null) {
				parts.push(
					`${row.redirects.count === 1 ? 'redirect' : `${row.redirects.count} redirects`} ${ms(row.redirects.duration)}ms`
				);
			}
			parts.push(describeFigures(row.figures));
			break;
		case 'form':
			parts.push(`form ${row.route}${row.action === null ? '' : ` ?/${row.action}`}`);
			parts.push(
				row.drawn === null
					? 'not drawn yet'
					: `${ms(row.drawn)}ms${row.from === 'press' ? '' : ' from submit'}`
			);
			parts.push(describeFigures(row.figures));
			break;
		case 'tap':
			parts.push(`${row.from === 'press' ? 'tap' : row.how} ${row.route ?? '(no route)'}`);
			parts.push(`${ms(row.drawn)}ms${row.from === 'press' ? '' : ' from start'}`);
			parts.push(row.figures === null ? 'no data request' : describeFigures(row.figures));
			break;
		case 'return':
			parts.push(`return · hidden ${seconds(row.hidden)} · visible ${row.visibleAt}`);
			break;
		case 'wake':
			parts.push('wake');
			parts.push(describeFigures(row.figures));
			break;
		case 'media':
			parts.push(row.media);
			parts.push(`cache ${row.cache}`);
			parts.push(
				row.shown === null
					? 'shown ?'
					: `shown +${ms(row.shown)}ms${row.early ? ' (before the readout)' : ''}`
			);
			if (row.figures !== null) {
				parts.push(describeFigures(row.figures));
			}
			break;
	}
	if (row.sinceReturn !== null) {
		parts.push(`${seconds(row.sinceReturn)} after return`);
	}
	return parts.join(' · ');
}

const two = (value: number) => String(value).padStart(2, '0');

/**
 * The date and time for Copy's heading, both in the device's own zone:
 * `YYYY-MM-DD HH:MM:SS`. Until 2026-10-09 the date was `toISOString`'s, in
 * UTC, beside a local time, so at UTC+3 a copy made between
 * midnight and 03:00 carried the day before.
 */
export function localDateTime(when: Date): string {
	const day = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`;
	const time = `${two(when.getHours())}:${two(when.getMinutes())}:${two(when.getSeconds())}`;
	return `${day} ${time}`;
}

/** What Copy puts on the clipboard: a heading line, then one numbered line a row. */
export function copyText(rows: readonly Row[], heading: string): string {
	return [heading, ...rows.map((row, index) => `${index + 1}. ${describeRow(row)}`)].join('\n');
}
