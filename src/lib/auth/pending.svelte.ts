/**
 * A sign-in form's one submission: pending from the first press until the page
 * it leads to is on screen, and refusing a second press in between.
 *
 * Signing in answers with a redirect, and `use:enhance` then navigates to
 * `/journals`, which waits a round trip for that page's data with the form
 * still on screen and, before this, no sign anything was happening. Over a
 * slow mobile connection that is a few hundred milliseconds of a Login button that looks
 * ignored, so it gets pressed again, and the second press goes out signed in.
 * That is how the 500 ("Unexpected token '<' … is not valid JSON") was seen,
 * after logging out and back in; `toAppHome` in `hooks.server.ts` answers such
 * a press properly now, and this stops it being sent at all.
 *
 * Pending until `update()` settles, not until the action answers: for a
 * redirect, `update()` is `applyAction`, which awaits the navigation. So the
 * button stays pressed through the wait for the next page's data. Anything else
 * (a failure to show, an error page) ends it, and the form can be used again.
 *
 * The button is disabled while pending, which also stops Enter in a field
 * submitting (implicit submission does nothing when the default button is
 * disabled). A submission that arrives some other way is cancelled before it
 * is sent.
 *
 * `clearOnFailure` names fields to empty when the action refuses the submit:
 * the login form's password, so a wrong one is typed again rather than edited.
 * Without JavaScript the server's answer clears it, since nothing echoes it.
 *
 * `reset: false` keeps the fields after a `success` result, which `update()`
 * would otherwise reset: the forgot-password form answers with a success and
 * keeps the address for "Send again".
 *
 * `onSuccess` replaces `update()` for a `success` result: for a form that posts
 * to another page's action, whose success `update()` would not show (it applies
 * a result only on the page that owns the action). Login's Send again goes to
 * "Check your inbox" this way. Pending until it settles.
 */
import type { SubmitFunction } from '@sveltejs/kit';

export type PendingSubmit = {
	readonly pending: boolean;
	readonly submit: SubmitFunction;
};

export function pendingSubmit({
	clearOnFailure = [],
	reset = true,
	onSuccess
}: {
	clearOnFailure?: string[];
	reset?: boolean;
	onSuccess?: () => Promise<void>;
} = {}): PendingSubmit {
	let pending = $state(false);

	return {
		get pending() {
			return pending;
		},
		submit: ({ cancel }) => {
			if (pending) {
				cancel();
				return;
			}
			pending = true;
			return async ({ formElement, result, update }) => {
				if (result.type === 'failure') {
					for (const name of clearOnFailure) {
						const field = formElement.elements.namedItem(name);
						if (field instanceof HTMLInputElement) {
							field.value = '';
						}
					}
				}
				try {
					await (result.type === 'success' && onSuccess ? onSuccess() : update({ reset }));
				} finally {
					pending = false;
				}
			};
		}
	};
}
