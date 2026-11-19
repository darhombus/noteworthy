/**
 * The notices the server hands the toasts, by name. Two ways in:
 *
 * - A page's load. The server sets the `nw-notice` cookie and the page's own
 *   load reads and deletes it, by rules that stay where they are
 *   (docs/constraints.md, "Keep me signed in", "A tab left open"); the load
 *   returns one of these names as `notice`.
 * - A form action's answer, as `notice` in what it returns: Send again on
 *   "Check your inbox", "Email me a new link" on an expired reset. So a form
 *   posted without JavaScript gets its answer drawn by the server too.
 *
 * Either way the root layout draws it as a toast (`pageNotice`), in the
 * server's HTML too.
 *
 * The words are the ones the pages drew before. Moving a message keeps them.
 */
import type { ToastKind } from './place';

export type NoticeName =
	| 'signed-out-12h'
	| 'signed-out-30d'
	| 'set-by-email'
	| 'password-changed'
	| 'confirm-sent-again'
	| 'reset-link-sent';

export type Notice = {
	kind: ToastKind;
	text: string;
	/**
	 * Stays until closed. The two notices that say why the person is on this
	 * page do: they are read, not glanced at.
	 */
	sticky: boolean;
};

const limit = (after: string) =>
	`You were signed out after ${after}. Tick "Remember me" to stay signed in for 30 days.`;

export const NOTICES: Record<NoticeName, Notice> = {
	'signed-out-12h': { kind: 'info', text: limit('12 hours'), sticky: true },
	'signed-out-30d': { kind: 'info', text: limit('30 days'), sticky: true },
	'set-by-email': {
		kind: 'info',
		text: 'For your security, set a password for this account by email.',
		sticky: true
	},
	'password-changed': { kind: 'success', text: 'Your password has been changed.', sticky: false },
	// The one answer, whatever happened: "Signup with confirmation on".
	'confirm-sent-again': {
		kind: 'success',
		text: 'If that address is waiting to be confirmed, a new link is on its way. Use the newest email.',
		sticky: false
	},
	'reset-link-sent': {
		kind: 'success',
		text: 'A link is on its way to your email address. It can take a few minutes to arrive. Check your spam folder too.',
		sticky: false
	}
};

function isNoticeName(value: unknown): value is NoticeName {
	return typeof value === 'string' && Object.hasOwn(NOTICES, value);
}

/**
 * The notice the page shows, and the object it belongs to (closed is closed
 * for that object: `Toaster`). The form's answer before the page's data: it is
 * the newer of the two, and no page has both today. `form` is whatever the
 * last action returned, so its `notice` is checked, not trusted.
 */
export function pageNotice(
	data: { notice?: NoticeName | null },
	form: unknown
): { name: NoticeName; source: object } | null {
	if (typeof form === 'object' && form !== null && 'notice' in form && isNoticeName(form.notice)) {
		return { name: form.notice, source: form };
	}
	return data.notice ? { name: data.notice, source: data } : null;
}
