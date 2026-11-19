/**
 * Turns the timing readout on or off for this browser: a cookie, set or
 * removed (`$lib/timing/cookie`). Public, signed in or out: see
 * `PUBLIC_PATHS` in `hooks.server.ts`.
 *
 * Plain form posts, with or without JavaScript: each answers 303 back here, so
 * the page that follows is a new document, drawn with the readout or without
 * it, and a reload does not post again. A new document also starts the
 * readout's record from that page's own load, which is the first row worth
 * reading.
 */
import { redirect } from '@sveltejs/kit';
import { TIMING_COOKIE, TIMING_COOKIE_OPTIONS, TIMING_ON } from '$lib/timing/cookie';
import type { Actions } from './$types';

export const actions: Actions = {
	on: ({ cookies }) => {
		cookies.set(TIMING_COOKIE, TIMING_ON, TIMING_COOKIE_OPTIONS);
		redirect(303, '/timing');
	},
	off: ({ cookies }) => {
		cookies.delete(TIMING_COOKIE, { path: TIMING_COOKIE_OPTIONS.path });
		redirect(303, '/timing');
	}
};
