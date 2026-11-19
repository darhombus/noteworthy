import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { APP_HOME } from '$lib/auth/routes';
import { choosingState, endChoosing } from '$lib/auth/choose-password.server';
import { NOTICE_COOKIE, PASSWORD_CHANGED, recentRecovery } from '$lib/auth/recovery';
import { sendResetLink } from '$lib/auth/reset-link.server';
import type { NoticeName } from '$lib/toast/notices';
import type { Actions, PageServerLoad } from './$types';

/** The signup form's rule. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Whether this session is a recovery from the last 15 minutes. The hook has
 * verified the session already; `getClaims()` again reads the same token
 * locally, with no round trip, for the one claim `locals.user` leaves out.
 *
 * Any session can change its own password through the auth server while
 * `secure_password_change` is off, so this page is what keeps a signed-in
 * phone left on a table from being used to take the account: it changes a
 * password only for somebody who has just followed the email's link.
 */
async function recovering({ locals }: Pick<RequestEvent, 'locals'>): Promise<boolean> {
	const { data, error } = await locals.supabase.auth.getClaims();
	if (error || !data) {
		return false;
	}
	return recentRecovery(data.claims.amr, Math.floor(Date.now() / 1000));
}

/**
 * Sent here by a signup link for an account signed up more than once
 * (`/auth/confirm`): the person chooses the password they will log in with,
 * which may be the one they signed up with.
 */
async function choosing({ cookies, locals }: Pick<RequestEvent, 'cookies' | 'locals'>) {
	return (await choosingState(cookies, locals.supabase.auth)) === 'pending';
}

/**
 * `bare`: drawn without the shell, so the page offers no way on but Log out (and,
 * once expired, the journals): a person choosing has nowhere else to go, and
 * the hook refuses the shell's navigation anyway.
 */
export const load: PageServerLoad = async (event) => {
	return {
		allowed: await recovering(event),
		choosing: await choosing(event),
		bare: true as const
	};
};

type ResetErrors = { password?: string; form?: string };

type ResetResult = {
	/** The session is not a recent recovery: the page offers a new link instead. */
	expired: boolean;
	errors: ResetErrors;
	/**
	 * "Email me a new link" was answered: the one answer, as on
	 * `/forgot-password`, drawn as a toast by the root layout.
	 */
	notice: NoticeName | null;
	wait: number;
};

/**
 * Annotated rather than `satisfies`, so `errors` keeps both optional fields on
 * every branch: inferred, `{}` and `{ password }` make a union the page cannot read.
 */
function result(fields: Partial<ResetResult>): ResetResult {
	return { expired: false, errors: {}, notice: null, wait: 0, ...fields };
}

export const actions: Actions = {
	save: async (event) => {
		const { request, locals, cookies } = event;
		// Checked again here, which is the check that matters: a page loaded in
		// time can be submitted after the window, or posted to without loading it.
		if (!(await recovering(event))) {
			return fail(403, result({ expired: true }));
		}

		const password = String((await request.formData()).get('password') ?? '');
		if (password.length < MIN_PASSWORD_LENGTH) {
			return fail(
				400,
				result({ errors: { password: `Use at least ${MIN_PASSWORD_LENGTH} characters.` } })
			);
		}

		const { error } = await locals.supabase.auth.updateUser({ password });
		// Choosing after a signup, the password typed at signup is a fine choice:
		// it is this person's, and the change ends every other session either way.
		const chose = await choosing(event);
		if (error && !(chose && error.code === 'same_password')) {
			console.warn('reset-password: not changed:', error.code ?? `status ${error.status}`);
			return fail(400, result({ errors: describe(error.code, error.message) }));
		}

		// The auth server already ends the account's other sessions on a password
		// change (measured); asked for here too, so that does not rest on its
		// behaviour. Their access tokens still verify until they expire.
		const others = await locals.supabase.auth.signOut({ scope: 'others' });
		if (others.error) {
			console.warn(
				'reset-password: other sessions not ended:',
				others.error.code ?? `status ${others.error.status}`
			);
		}

		if (chose) {
			// Chosen: the hook stops sending this person back here. No notice: from
			// their side nothing changed, they signed up and went in.
			endChoosing(cookies);
		} else {
			cookies.set(NOTICE_COOKIE, PASSWORD_CHANGED, {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60
			});
		}
		redirect(303, APP_HOME);
	},

	/**
	 * A new link to this session's own address: `/forgot-password` sends a
	 * signed-in person on to the journals, so the expired state asks from here.
	 * The address is the session's, so the answer can name nobody new; it is
	 * still the one answer, with the same cooldown.
	 */
	resend: async (event) => {
		const email = event.locals.user?.email ?? '';
		const answer = email.length > 0 ? await sendResetLink(event, email) : null;
		const wait = answer?.kind === 'sent' ? answer.wait : 0;
		return result({ expired: true, notice: 'reset-link-sent', wait });
	}
};

/** Codes confirmed against the local stack. */
function describe(code: string | undefined, message: string): ResetErrors {
	switch (code) {
		case 'weak_password':
			return { password: message };
		case 'same_password':
			return { password: 'Choose a password different from your old one.' };
		default:
			return { form: 'Could not change your password. Try again.' };
	}
}
