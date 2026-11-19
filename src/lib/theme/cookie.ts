/**
 * The theme vocabulary: what can be stored, where, and how it reaches `<html>`.
 *
 * ---------------------------------------------------------------------------
 * THREE STATES, AND `system` IS ONE OF THEM
 * ---------------------------------------------------------------------------
 * `system` is a stored value meaning "follow the OS", not the absence of a
 * preference. Somebody whose OS is dark has already said they want dark
 * interfaces, so defaulting a cookie-less visitor to `light` would greet them
 * with a bright page at night and a toggle to go and find.
 *
 * The practical difference between "stored `system`" and "no cookie" is only
 * visible in section 2: picking `system` back off a toggle has to write
 * something, or the choice cannot be distinguished from never having chosen.
 * Both render identically, which is what `themeAttribute` says below.
 *
 * ---------------------------------------------------------------------------
 * A COOKIE, NOT `localStorage`
 * ---------------------------------------------------------------------------
 * `localStorage` is not on the request, so the server cannot know the choice
 * and has to render something and correct it — which is why `next-themes`, the
 * old app's approach, needs an inline blocking script. A cookie arrives with
 * the request, so `hooks.server.ts` renders the right theme directly.
 *
 * Per-device is also the right scope. Someone's phone and their laptop can
 * reasonably differ, and `profiles.preferences` could not express that. (The
 * old app declared a `theme` key there, never wrote it and never read it.)
 */

/** Obvious on sight in devtools, which is how this gets tested by hand. */
export const THEME_COOKIE = 'theme';

export type Theme = 'light' | 'dark' | 'system';

export const DEFAULT_THEME: Theme = 'system';

/**
 * Iterated by `parseTheme`, so it is also the only list to extend if a fourth
 * state ever exists. `readonly Theme[]` rather than a `Set` because `Set.has`
 * takes a `Theme` under strict TypeScript, which would need a cast to ask about
 * an arbitrary cookie string — the exact question being asked.
 */
const THEMES: readonly Theme[] = ['light', 'dark', 'system'];

/**
 * 400 days, the longest expiry Chrome will honour — anything larger is silently
 * clamped to this. A preference, not a session: it should outlive logging out.
 */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * The cookie is written from two places and both have to agree, or a toggle
 * click and a no-JS form post would leave two cookies with the same name on
 * different paths and the browser would send whichever it liked.
 *
 * `serializeThemeCookie` below is the browser's writer. The server's is
 * `cookies.set` in `src/routes/theme/+server.ts`, which takes the same values
 * as an options object — these constants are what keep the two in step.
 */
export const THEME_COOKIE_PATH = '/';

/**
 * Not `HttpOnly`, and deliberately: the toggle writes this cookie from the
 * browser so the choice costs no round trip. A browser will not let script
 * overwrite an `HttpOnly` cookie, so setting it on the server response would
 * quietly break the client-side write rather than fail loudly.
 *
 * Nothing is lost by it. The value is one of three words describing a colour
 * scheme — there is no session, no identity and nothing to steal in it.
 */
export const THEME_COOKIE_HTTP_ONLY = false;

/**
 * The `document.cookie` string for a choice made in the browser.
 *
 * `secure` is a parameter rather than something read from `location` here so
 * this stays pure and testable; `applyTheme` supplies it. It has to be
 * conditional: a `Secure` cookie is dropped on plain http, which is what
 * `npm run dev` and the e2e preview server both serve.
 *
 * `theme` is a `Theme`, so there is nothing to escape — the union is three
 * lowercase words, and a value that came off a cookie or a form has been
 * through `parseTheme` before it reaches here.
 */
export function serializeThemeCookie(theme: Theme, secure: boolean): string {
	const parts = [
		`${THEME_COOKIE}=${theme}`,
		`Path=${THEME_COOKIE_PATH}`,
		`Max-Age=${THEME_COOKIE_MAX_AGE}`,
		'SameSite=Lax'
	];

	if (secure) {
		parts.push('Secure');
	}

	return parts.join('; ');
}

/**
 * Anything that is not one of the three reads as the default.
 *
 * The cookie is attacker-controlled in the sense that any value at all can be
 * typed into devtools, and its value is interpolated into the served HTML by
 * `themeAttribute`. Narrowing to the union here is what makes that safe —
 * nothing downstream takes an arbitrary string.
 */
export function parseTheme(value: string | undefined | null): Theme {
	for (const theme of THEMES) {
		if (theme === value) {
			return theme;
		}
	}

	return DEFAULT_THEME;
}

/**
 * The `class` attribute for `<html>`, including its own leading space, or the
 * empty string.
 *
 * Carrying the space means `system` produces `<html lang="en">` exactly — no
 * empty `class=""` and no orphaned whitespace — because the pattern that finds
 * the placeholder in `src/app.html` consumes the space in front of it. The two
 * belong together: see `THEME_PLACEHOLDER` in `src/hooks.server.ts`.
 *
 * `system` deliberately writes nothing. The absence of both classes is what the
 * `dark` variant in `src/routes/layout.css` tests for before letting
 * `prefers-color-scheme` decide, so writing a `system` class here would need a
 * third branch in that variant and buy nothing.
 */
export function themeAttribute(theme: Theme): string {
	return theme === 'system' ? '' : ` class="${theme}"`;
}
