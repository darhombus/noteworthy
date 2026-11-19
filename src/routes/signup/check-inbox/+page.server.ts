import { confirmWaitLeft, rememberedAddress, sendConfirmLink } from '$lib/auth/confirm-link.server';
import type { NoticeName } from '$lib/toast/notices';
import type { Actions, PageServerLoad } from './$types';

/**
 * Where every signup that signed nobody in lands: confirmation on, an address
 * already in use (in either state), the auth server's limit, a failed send. The
 * page's words are true for all of them. The address comes from the cookie the
 * signup action (or a login refused as unconfirmed) set, never from the URL.
 */
export const load: PageServerLoad = ({ cookies }) => {
	return { email: rememberedAddress(cookies), wait: confirmWaitLeft(cookies) };
};

type SendAgainResult = {
	/**
	 * Send again was answered: the one answer, whatever happened, drawn as a
	 * toast by the root layout (`$lib/toast/notices`).
	 */
	notice: NoticeName | null;
	wait: number;
};

export const actions: Actions = {
	/**
	 * Send again, here and from `/login`. The address is the cookie's, not a
	 * field: what was typed at signup or login. With no cookie there is
	 * nothing to send, and the page says so from its load.
	 */
	default: async (event) => {
		const email = rememberedAddress(event.cookies);
		const wait = email === null ? 0 : await sendConfirmLink(event, email);
		const answered: SendAgainResult = {
			notice: email === null ? null : 'confirm-sent-again',
			wait
		};
		return answered;
	}
};
