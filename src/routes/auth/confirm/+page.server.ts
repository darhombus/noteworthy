import { fail, redirect } from '@sveltejs/kit';
import { forgetAddress } from '$lib/auth/confirm-link.server';
import { lapseChoosing, startChoosing } from '$lib/auth/choose-password.server';
import { confirmDestination, confirmType, signedUpAgain } from '$lib/auth/recovery';
import type { Actions, PageServerLoad } from './$types';

/**
 * The page an email's link opens. Opening it changes nothing: mail scanners
 * fetch links before the person does, and a link spent on GET would be dead by
 * the time it is clicked. The button POSTs, and only that verifies.
 *
 * The token stays in the address and is never put in the page: the form has
 * no `action`, so it posts to this address, query and all, and the action reads
 * it from there.
 *
 * The page's address holds the token, so no Referer from it may carry the
 * address: `strict-origin` sends the origin alone, to this site and to any
 * other, never a path or query. Not `no-referrer`, the first version: under it
 * the browser sends `Origin: null` with a form's own POST, and SvelteKit's CSRF
 * check refused the button without JavaScript, or pressed before hydration,
 * with "Cross-site POST form submissions are forbidden" (measured, Chromium).
 */
export const load: PageServerLoad = ({ url, setHeaders, locals }) => {
	setHeaders({ 'referrer-policy': 'strict-origin' });
	return {
		// Without the shell, signed in or not: the page is about the link, whoever
		// is signed in, and verifying replaces that session.
		bare: true as const,
		// Where "Ask for a new link" goes: `/forgot-password` sends a signed-in
		// person on, so they ask from `/reset-password`, for their own address.
		signedIn: locals.user !== null,
		// What the page calls the link; `null` for one it cannot use.
		type: confirmType(url.searchParams.get('type')),
		usable:
			confirmType(url.searchParams.get('type')) !== null &&
			(url.searchParams.get('token_hash') ?? '').length > 0
	};
};

export const actions: Actions = {
	default: async ({ url, locals, cookies }) => {
		const type = confirmType(url.searchParams.get('type'));
		const tokenHash = url.searchParams.get('token_hash') ?? '';
		if (type === null || tokenHash.length === 0) {
			return fail(400, { expired: true });
		}

		let refused: string | null;
		let choosePassword = false;
		try {
			// Every session a link makes is a 12-hour one (`$lib/auth/session-limit`).
			// Declared before the call, so the server client writes it that way, and
			// gives it a new mark: a person already signed in here kept their mark
			// through a session change before, so a page drawn for the old session
			// read it as the same one.
			locals.newSession.choice = '12h';
			const { data, error } = await locals.supabase.auth.verifyOtp({ type, token_hash: tokenHash });
			refused = error ? (error.code ?? `status ${error.status}`) : null;
			choosePassword = type === 'signup' && signedUpAgain(data.user);
		} catch {
			refused = 'unreachable';
		}
		if (refused !== null) {
			// Spent, expired, garbage and wrong-type tokens are all `otp_expired`
			// (measured); every refusal gets the same plain message. By code only.
			console.warn('auth/confirm: link refused:', refused);
			return fail(400, { expired: true });
		}

		// `verifyOtp` set the session through the server client, as a login does,
		// with a new mark. "Check your inbox" has done its work.
		forgetAddress(cookies);

		// An account signed up more than once, or sent its link again: whoever
		// signed up first chose its password (a second signup keeps the first
		// password, measured), and may not be this person. They choose it now,
		// before going in. Decided from the auth server's own stamps at this
		// moment, not from anything the app saw at signup, so calling the auth
		// server directly cannot skip it.
		if (choosePassword) {
			if (!(await startChoosing(cookies, locals.supabase.auth))) {
				// The session just given could not be read: fail closed, as a choice
				// left too long does.
				await lapseChoosing(cookies, locals.supabase.auth);
				redirect(303, '/forgot-password');
			}
			redirect(303, '/reset-password');
		}
		redirect(303, confirmDestination(type, url.searchParams.get('next')));
	}
};
