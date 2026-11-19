/**
 * Toasts made by the page's own code: `success(text)`, `info(text)` and
 * `error(text)`. `Toaster.svelte`, drawn once by the root layout, shows them.
 *
 * Kept in module state, in the browser only. On the server a module outlives
 * the request and the person, so a toast kept there would be shown to the next
 * person the server draws a page for: every call is a no-op there. A notice
 * the server sets reaches the toasts through the page's data instead
 * (`./notices`).
 *
 * - Errors stay until closed. So does a toast made `sticky`, and any toast
 *   holding a link, so the link cannot vanish while somebody reaches for it.
 * - The same words as the newest toast, of the same kind, add nothing.
 * - At most `MAX_TOASTS`; see `keepNewest` for which goes.
 * - Each belongs to the page it was shown on (`leavePage`). One made once a
 *   navigation has landed (`/login`'s Send again, after its `goto`) belongs
 *   to the page it landed on, since the old page's were cleared before it.
 */
import { browser } from '$app/environment';
import type { ResolvedPathname } from '$app/types';
import { keepNewest, type ToastKind } from './place';

export type ToastLink = { href: ResolvedPathname; label: string };

export type Toast = {
	id: number;
	kind: ToastKind;
	text: string;
	sticky: boolean;
	link?: ToastLink;
};

export type ToastOptions = { sticky?: boolean; link?: ToastLink };

let list = $state.raw<Toast[]>([]);
let next = 1;

function add(kind: ToastKind, text: string, options: ToastOptions = {}): void {
	if (!browser) {
		return;
	}
	const newest = list.at(-1);
	if (newest !== undefined && newest.kind === kind && newest.text === text) {
		return;
	}
	const toast: Toast = {
		id: next++,
		kind,
		text,
		sticky: kind === 'error' || options.sticky === true || options.link !== undefined,
		link: options.link
	};
	list = keepNewest([...list, toast]);
}

export function success(text: string, options?: ToastOptions): void {
	add('success', text, options);
}

export function info(text: string, options?: ToastOptions): void {
	add('info', text, options);
}

export function error(text: string, options?: ToastOptions): void {
	add('error', text, options);
}

export function dismiss(id: number): void {
	list = list.filter((toast) => toast.id !== id);
}

/** The toasts now, oldest first. */
export function toasts(): readonly Toast[] {
	return list;
}

/**
 * The page is being left: its toasts go with it. Called by the root layout as
 * a client-side navigation to another page is about to draw it (`onNavigate`,
 * `leavesPage`), and by `Toaster` on `pagehide`, so a document the browser
 * keeps for Back does not bring them back.
 */
export function leavePage(): void {
	list = [];
}

/** For tests: nothing kept from one to the next. */
export function clearToasts(): void {
	list = [];
}
