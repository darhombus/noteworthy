import { fail } from '@sveltejs/kit';
import { SET_BY_EMAIL } from '$lib/auth/choose-password.server';
import { NOTICE_COOKIE } from '$lib/auth/recovery';
import { sendResetLink } from '$lib/auth/reset-link.server';
import type { NoticeName } from '$lib/toast/notices';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sent here, signed out, when "Choose your password" after a signup was left
 * past its window (`$lib/auth/choose-password.server`): the page says why,
 * once. Deleted by a document's request only, as `/login` does its notice: the
 * "Choose your password" tab is drawn with `shellUser` set, so Save pressed
 * there past the window arrives by a client-side navigation whose data request
 * SvelteKit makes before `onNavigate` turns it into a full load
 * (`reloadSignedOutPages`), and deleting it there lost it (measured). Drawn as
 * a toast by the root layout (`$lib/toast/notices`).
 */
export const load: PageServerLoad = ({ cookies, isDataRequest }) => {
	const setByEmail = cookies.get(NOTICE_COOKIE) === SET_BY_EMAIL;
	if (setByEmail && !isDataRequest) {
		cookies.delete(NOTICE_COOKIE, { path: '/' });
	}
	const notice: NoticeName | null = setByEmail ? 'set-by-email' : null;
	return { notice };
};

/** The signup form's check: catches the obvious typo, and the auth server has the last word. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MALFORMED = 'That does not look like an email address.';

type ForgotResult = {
	errors: { email?: string };
	/** Echoed back for "Send again". Typed by the person, so naming it tells nobody anything. */
	values: { email: string };
	/** The one answer for everything but a malformed address. */
	sent: boolean;
	/** Seconds before this browser may ask again. */
	wait: number;
};

export const actions: Actions = {
	default: async (event) => {
		const submitted = await event.request.formData();
		const email = String(submitted.get('email') ?? '').trim();
		const values = { email };

		// Annotated rather than `satisfies`, so `errors` keeps its optional field on
		// both branches: inferred, `{}` and `{ email }` make a union the page cannot read.
		const refuse = (message: string) => {
			const refused: ForgotResult = { errors: { email: message }, values, sent: false, wait: 0 };
			return fail(400, refused);
		};

		if (email.length === 0) {
			return refuse('Enter your email address.');
		}
		if (!EMAIL_PATTERN.test(email)) {
			return refuse(MALFORMED);
		}

		const answer = await sendResetLink(event, email);
		if (answer.kind === 'malformed') {
			return refuse(MALFORMED);
		}
		const sent: ForgotResult = { errors: {}, values, sent: true, wait: answer.wait };
		return sent;
	}
};
