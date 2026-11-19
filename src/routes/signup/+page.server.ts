import { fail, redirect } from '@sveltejs/kit';
import type { AuthError } from '@supabase/supabase-js';
import {
	CHECK_INBOX_PATH,
	confirmRedirect,
	forgetAddress,
	rememberAddress,
	startConfirmWait
} from '$lib/auth/confirm-link.server';
import { dropCodeVerifiers } from '$lib/auth/recovery';
import { APP_HOME } from '$lib/auth/routes';
import { SESSION_COOKIE_KEY } from '$lib/supabase/server';
import type { Actions } from './$types';

const MIN_PASSWORD_LENGTH = 6;

/**
 * Deliberately permissive. This only catches the obvious typo before we spend a
 * round trip on it — Supabase is the authority on what it will accept, and its
 * verdict is translated in `fieldError` below.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SignupErrors = {
	fullName?: string;
	email?: string;
	password?: string;
};

type SignupResult = {
	errors: SignupErrors;
	/** Echoed back so a rejected submit doesn't empty the form. Never the password. */
	values: { fullName: string; email: string; remember: boolean };
};

export const actions: Actions = {
	default: async ({ request, locals, url, cookies }) => {
		const submitted = await request.formData();
		const fullName = String(submitted.get('fullName') ?? '').trim();
		const email = String(submitted.get('email') ?? '').trim();
		const password = String(submitted.get('password') ?? '');
		// "Remember me": a checkbox sends its field only when ticked.
		const remember = submitted.get('remember') === 'on';

		const values = { fullName, email, remember };
		const errors: SignupErrors = {};

		if (fullName.length === 0) {
			errors.fullName = 'Enter the name you want to be known by.';
		}

		if (email.length === 0) {
			errors.email = 'Enter your email address.';
		} else if (!EMAIL_PATTERN.test(email)) {
			errors.email = 'That does not look like an email address.';
		}

		if (password.length < MIN_PASSWORD_LENGTH) {
			errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
		}

		if (Object.keys(errors).length > 0) {
			return fail(400, { errors, values } satisfies SignupResult);
		}

		// Before the call: with confirmation off the server client writes the new
		// session with it. With it on there is no session; the link's is a 12-hour one.
		locals.newSession.choice = remember ? '30d' : '12h';
		const { data, error } = await locals.supabase.auth.signUp({
			email,
			password,
			// The trigger on auth.users reads full_name out of raw_user_meta_data and
			// writes the profiles row itself. Nothing here touches profiles — client
			// INSERT on that table is revoked.
			options: { data: { full_name: fullName }, emailRedirectTo: confirmRedirect(url) }
		});
		// The server client's PKCE flow wrote verifiers into this browser on every
		// call, beside the session too when there is one, and nothing reads them:
		// a confirmation link is verified with `token_hash`.
		dropCodeVerifiers(cookies, SESSION_COOKIE_KEY);

		const refused = error ? fieldError(error) : null;
		if (refused) {
			return fail(400, { errors: refused, values } satisfies SignupResult);
		}

		if (data.session) {
			// Confirmation off: signed in, the session's cookies already on this
			// response, written by the server client's setAll.
			forgetAddress(cookies);
			redirect(303, APP_HOME);
		}

		// Confirmation on, or an address in use (422, in either state), or the
		// auth server's limit (429), or a failed send (500): one page for all of
		// them, whose wording is true whichever it was. Logged by code alone.
		if (error) {
			console.warn('signup: no session:', error.code ?? `status ${error.status}`);
		}
		rememberAddress(cookies, email);
		startConfirmWait(cookies);
		redirect(303, CHECK_INBOX_PATH);
	}
};

/**
 * The refusals a person can act on in the form: about how the address or the
 * password was typed. Codes confirmed against the local stack rather than
 * assumed. Every other answer is "Check your inbox", so that none of them says
 * whether the address has an account.
 */
function fieldError(error: AuthError): SignupErrors | null {
	switch (error.code) {
		case 'weak_password':
			return { password: error.message };
		case 'validation_failed':
			return { email: 'That does not look like an email address.' };
		default:
			return null;
	}
}
