import { fail, redirect } from '@sveltejs/kit';
import type { AuthError } from '@supabase/supabase-js';
import { forgetAddress, rememberAddress } from '$lib/auth/confirm-link.server';
import { CHOOSE_PASSWORD_COOKIE, NOTICE_COOKIE } from '$lib/auth/recovery';
import { APP_HOME } from '$lib/auth/routes';
import { limitNotice } from '$lib/auth/session-limit';
import type { NoticeName } from '$lib/toast/notices';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sent here by the hook after ending a session at its limit
 * (`$lib/auth/session-limit`): the page says which limit, once. Deleted by a
 * document's request only. A tab drawn signed in arrives here by a client-side
 * navigation whose data request ended the session: SvelteKit asks for this
 * load's data before `onNavigate` turns the arrival into a full load
 * (`reloadSignedOutPages`), so deleting it there lost it before the document
 * that shows it (measured). Drawn as a toast by the root layout
 * (`$lib/toast/notices`); that data answer is never drawn, so it makes none.
 */
export const load: PageServerLoad = ({ cookies, isDataRequest }) => {
	const signedOutAfter = limitNotice(cookies.get(NOTICE_COOKIE));
	if (signedOutAfter && !isDataRequest) {
		cookies.delete(NOTICE_COOKIE, { path: '/' });
	}
	const notice: NoticeName | null = signedOutAfter === null ? null : `signed-out-${signedOutAfter}`;
	return { notice };
};

type LoginErrors = {
	email?: string;
	password?: string;
	/** Not attributable to one field — which, for a sign-in, is most of them. */
	form?: string;
};

type LoginResult = {
	errors: LoginErrors;
	/** Echoed back so a rejected submit doesn't empty the form. Never the password. */
	values: { email: string; remember: boolean };
	/**
	 * The password was right and the address is not confirmed yet: the page
	 * offers Send again. The auth server says so only after a right password
	 * (measured), so this tells nobody anything they could not log in with.
	 */
	unconfirmed: boolean;
};

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		const submitted = await request.formData();
		const email = String(submitted.get('email') ?? '').trim();
		const password = String(submitted.get('password') ?? '');
		// "Remember me": a checkbox sends its field only when ticked.
		const remember = submitted.get('remember') === 'on';

		const values = { email, remember };
		const errors: LoginErrors = {};

		// Only emptiness is checked here. A malformed address is not worth its own
		// message on a sign-in form: it cannot match an account, so letting it fall
		// through to the generic failure below keeps every wrong answer identical.
		if (email.length === 0) {
			errors.email = 'Enter your email address.';
		}

		if (password.length === 0) {
			errors.password = 'Enter your password.';
		}

		if (Object.keys(errors).length > 0) {
			return fail(400, { errors, values, unconfirmed: false } satisfies LoginResult);
		}

		// Before the call: the server client writes the new session with it.
		locals.newSession.choice = remember ? '30d' : '12h';
		const { error } = await locals.supabase.auth.signInWithPassword({ email, password });

		if (error?.code === 'email_not_confirmed') {
			// For Send again, which posts to "Check your inbox" and reads it there.
			rememberAddress(cookies, email);
			return fail(400, {
				errors: describe(error),
				values,
				unconfirmed: true
			} satisfies LoginResult);
		}
		if (error) {
			return fail(400, {
				errors: describe(error),
				values,
				unconfirmed: false
			} satisfies LoginResult);
		}

		// The session cookies are already on this response, written by the server
		// client's setAll during signInWithPassword. Whatever an earlier signup or
		// signup link left in this browser is for somebody else now, or done.
		forgetAddress(cookies);
		cookies.delete(CHOOSE_PASSWORD_COOKIE, { path: '/' });
		redirect(303, APP_HOME);
	}
};

/** Codes confirmed against the local stack rather than assumed. */
function describe(error: AuthError): LoginErrors {
	switch (error.code) {
		case 'invalid_credentials':
			// Supabase returns this for an unknown email, a wrong password and a
			// malformed address alike. Keeping one message preserves that: naming
			// which half was wrong would turn the form into an oracle for whether a
			// given address has an account here.
			return { form: 'Email or password is incorrect.' };
		case 'email_not_confirmed':
			// Only with confirmation on, and only after a right password (measured).
			return {
				form: 'Confirm your email address before logging in. Open the link we emailed you, or send it again.'
			};
		case 'over_request_rate_limit':
			return { form: 'Too many attempts just now. Wait a minute and try again.' };
		default:
			return { form: 'Could not log you in. Try again.' };
	}
}
