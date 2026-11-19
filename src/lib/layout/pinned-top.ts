/**
 * How much of the top of the window the app shell keeps pinned.
 *
 * At `lg` and up the breadcrumb bar sticks to the top of the main column, so
 * anything else that wants to stick — the entry editor's toolbar row — has to
 * stick below it rather than at `top: 0`, and a caret has to be kept clear of
 * the two together. Below `lg` the bar scrolls away with the page, and nothing
 * is pinned above the editor at all.
 *
 * The root layout measures the bar and provides the number; anything under it
 * reads it. A context rather than a CSS custom property alone, because the
 * editor needs the figure in JavaScript as well as in its `top`: ProseMirror's
 * `scrollThreshold` and `scrollMargin` are numbers handed to it, not styles, and
 * they have to change when the bar does.
 *
 * Outside the layout — a component rendered on its own — nothing is pinned,
 * which is what `usePinnedTop` answers.
 *
 * Until the layout has mounted there is no measurement — the server cannot
 * know the width, let alone the bar's height — and `measured` says so. The
 * editor's toolbar row is server-rendered (`EntryEditor`, THE WAIT), so for
 * those frames it sticks by CSS instead, at `PINNED_TOP_UNMEASURED`, and the
 * measured number replaces it as the layout mounts.
 */
import { getContext, setContext } from 'svelte';

/**
 * Tailwind's `lg`, where the breadcrumb bar starts to stick.
 *
 * Written out here because Tailwind keeps its breakpoints in CSS, and the
 * layout needs to know in JavaScript whether the `lg:sticky` on the bar is in
 * force. It has to match the theme's `--breakpoint-lg`, which is Tailwind 4's
 * default of 64rem; if that is ever changed in `layout.css`, change this too.
 */
export const LG_UP = '(min-width: 64rem)';

export type PinnedTop = {
	/** Pixels at the top of the window covered by the shell right now. 0 when nothing is pinned. */
	readonly height: number;
	/** False until the layout has mounted and measured; `height` is 0 until then. */
	readonly measured: boolean;
};

/**
 * Where something sticks under the bar before the bar has been measured: 0
 * below `lg`, and from `lg` the height of the bar with its trail on one line —
 * `py-3`, the trail's 20px line and the 1px border, 45px at the default text
 * size — as Tailwind classes, for the server's HTML. A trail that wraps is
 * taller, and is the measured number's to get right.
 */
export const PINNED_TOP_UNMEASURED = 'top-0 lg:top-[calc(2.75rem+1px)]';

const KEY = Symbol('pinned-top');
const NOTHING: PinnedTop = { height: 0, measured: true };

/** Called once by the root layout, with a getter so readers stay reactive. */
export function providePinnedTop(pinned: PinnedTop): void {
	setContext(KEY, pinned);
}

/** Call during component initialisation, as with any context. */
export function usePinnedTop(): PinnedTop {
	return getContext<PinnedTop | undefined>(KEY) ?? NOTHING;
}
