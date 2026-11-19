/**
 * The sidebar's contents.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO HIDDEN ITEM HERE, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * The previous version had one. A permanent sidebar entry labelled "Hidden"
 * tells anybody who glances at the screen — over a shoulder, across a table —
 * both that hidden entries exist in this app and that this person keeps some.
 * That is the exact thing the vault is meant to prevent, announced by the
 * furniture. How the vault is reached is the vault PRD's decision to make; this
 * file's job is not to pre-empt it with a labelled door.
 *
 * ---------------------------------------------------------------------------
 * UNBUILT SECTIONS ARE LISTED, NOT LINKED
 * ---------------------------------------------------------------------------
 * Three of the six have no `href` yet. They render as text with a "Soon" badge
 * rather than as links, so the shape of the app is visible from the first
 * screen and each later PRD fills its slot in rather than arguing about where
 * to add one. An item becomes a link the moment it gets an `href`.
 */
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

export type NavIconName = 'dashboard' | 'journals' | 'analytics' | 'tags' | 'bin' | 'settings';

export type NavItem = {
	label: string;
	icon: NavIconName;
	/**
	 * Absent means unbuilt — the item renders as text rather than a link.
	 *
	 * Built by `resolve()` so it carries that helper's branded type: a plain
	 * string here compiles and then fails `svelte/no-navigation-without-resolve`
	 * at the anchor, because the rule has no way to tell a resolved path from any
	 * other string once the brand is gone.
	 */
	href?: ResolvedPathname;
	/**
	 * The path prefix that marks this item as the section currently open, so an
	 * entry three levels deep still highlights Journals.
	 */
	match?: string;
};

export const NAV_ITEMS: NavItem[] = [
	{ label: 'Dashboard', icon: 'dashboard' },
	{ label: 'Journals', icon: 'journals', href: resolve('/journals'), match: '/journals' },
	{ label: 'Analytics', icon: 'analytics' },
	{ label: 'Tags', icon: 'tags' },
	{ label: 'Recycle Bin', icon: 'bin', href: resolve('/bin'), match: '/bin' },
	// Storage is the first part of Settings, and for now the whole of it, so the
	// item goes straight there rather than through a redirect at `/settings`.
	{
		label: 'Settings',
		icon: 'settings',
		href: resolve('/settings/storage'),
		match: '/settings'
	}
];

/** Whether `pathname` is inside this item's section. */
export function isCurrent(item: NavItem, pathname: string): boolean {
	if (item.match === undefined) {
		return false;
	}
	return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
