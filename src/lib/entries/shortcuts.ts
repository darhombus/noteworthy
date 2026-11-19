/**
 * Turning TipTap's shortcut spelling into something a person can read, and into
 * something a screen reader can announce.
 *
 * Both are needed and they are not the same string. `title` gets "Ctrl+B" or
 * "⌘B", which is what somebody looking for the shortcut expects to see;
 * `aria-keyshortcuts` gets "Control+B" or "Meta+B", which is the spelling the
 * attribute is defined in terms of and the only one assistive technology can be
 * relied on to read out correctly. A ⌘ in `aria-keyshortcuts` announces as
 * "place of interest sign".
 *
 * TipTap writes shortcuts as `Mod-Shift-s`, where `Mod` means Cmd on Apple
 * platforms and Ctrl everywhere else — so the same binding has two names and the
 * toolbar has to pick one at runtime.
 */

/** Modifiers and a key, in TipTap's order: `['Mod', 'Shift', 'S']`. */
export type Shortcut = readonly string[];

/**
 * Whether to say ⌘ or Ctrl.
 *
 * `navigator.userAgentData.platform` is the modern answer and is not in every
 * browser; `navigator.platform` is deprecated and is in all of them. Both are
 * tried, and if neither says anything recognisable the answer is "not Apple",
 * because Ctrl is the more common case and the cost of being wrong is a tooltip
 * naming a key that still works.
 */
function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') {
		return false;
	}

	const agentData: unknown = (navigator as { userAgentData?: unknown }).userAgentData;
	const modern =
		typeof agentData === 'object' && agentData !== null
			? (agentData as { platform?: unknown }).platform
			: undefined;

	const platform = typeof modern === 'string' ? modern : (navigator.platform ?? '');
	return /mac|iphone|ipad|ipod/i.test(`${platform} ${navigator.userAgent}`);
}

let apple: boolean | undefined;

/** Resolved once. The platform does not change under a running page. */
function onApple(): boolean {
	apple ??= isApplePlatform();
	return apple;
}

const DISPLAY_APPLE: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' };
const DISPLAY_OTHER: Record<string, string> = { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };
const ARIA: Record<string, string> = { Shift: 'Shift', Alt: 'Alt' };

/** "⌘⇧S" on a Mac, "Ctrl+Shift+S" everywhere else. */
export function shortcutLabel(shortcut: Shortcut): string {
	const onMac = onApple();
	const table = onMac ? DISPLAY_APPLE : DISPLAY_OTHER;
	const parts = shortcut.map((part) => table[part] ?? part.toUpperCase());
	// Apple convention runs the symbols together; everywhere else joins with +.
	return onMac ? parts.join('') : parts.join('+');
}

/** The same binding spelled the way `aria-keyshortcuts` is defined. */
export function shortcutAria(shortcut: Shortcut): string {
	const modifier = onApple() ? 'Meta' : 'Control';
	return shortcut.map((part) => (part === 'Mod' ? modifier : (ARIA[part] ?? part))).join('+');
}

/** "Bold (Ctrl+B)", for a button's tooltip. */
export function labelWithShortcut(label: string, shortcut: Shortcut | undefined): string {
	return shortcut === undefined ? label : `${label} (${shortcutLabel(shortcut)})`;
}
