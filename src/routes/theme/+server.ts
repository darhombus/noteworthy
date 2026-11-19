import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	THEME_COOKIE,
	THEME_COOKIE_HTTP_ONLY,
	THEME_COOKIE_MAX_AGE,
	THEME_COOKIE_PATH,
	parseTheme
} from '$lib/theme/cookie';
import { safeReturnTo } from '$lib/theme/return-to';

/**
 * The toggle without JavaScript.
 *
 * `ThemeToggle.svelte` is a real `<form method="POST" action="/theme">`, and
 * with script running it never gets here — the submit handler cancels the
 * navigation and does both halves locally, because a preference should not cost
 * a round trip to change. This is the same form arriving the way the browser
 * would send it on its own.
 *
 * Shaped after `/logout`, which is a POST-only endpoint for the same reason: a
 * GET that changes something can be fired by a prefetch or an `<img src>` on
 * another site. That matters less for a colour scheme than for a session, but a
 * link that silently reskins somebody's app is still not a link anyone wants.
 *
 * This route is protected, like everything not named in `PUBLIC_PATHS`. The
 * only thing that posts here is the sidebar's toggle, and the sidebar renders
 * only for somebody signed in — so an anonymous POST is not a case to serve,
 * and it gets the redirect to /login that every other protected route gives.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const form = await request.formData();
	const submitted = form.get('theme');

	// `parseTheme` narrows to the union, so a hand-rolled POST carrying anything
	// else writes `system` rather than putting an arbitrary string in a cookie
	// that `hooks.server.ts` interpolates into every page's `<html>` tag.
	const theme = parseTheme(typeof submitted === 'string' ? submitted : null);

	cookies.set(THEME_COOKIE, theme, {
		path: THEME_COOKIE_PATH,
		maxAge: THEME_COOKIE_MAX_AGE,
		sameSite: 'lax',
		// Not HttpOnly, which SvelteKit would otherwise default to. See
		// THEME_COOKIE_HTTP_ONLY: the browser has to be able to overwrite this.
		httpOnly: THEME_COOKIE_HTTP_ONLY
	});

	// 303, so the browser follows with a GET. A 302 here would leave some clients
	// re-POSTing the form to the page they came from.
	redirect(303, safeReturnTo(form.get('redirectTo')));
};
