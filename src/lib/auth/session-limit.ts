/**
 * How long a session lasts (PRD 11, Section 1): 30 days from login when
 * "Remember me" was ticked, 12 hours otherwise, and every
 * session made by an email's link is a 12-hour one. Supabase's own session
 * limits are a paid-plan feature, so the hook enforces these itself. See
 * docs/constraints.md, "Keep me signed in".
 *
 * Decided from times the server wrote: the session's start is the earliest
 * `amr` timestamp in its verified token, which the auth server stamps at the
 * sign-in and keeps through every refresh (measured on the local stack: one,
 * two and ten refreshes, and `updateUser({ password })`), and "now" is the app
 * server's clock. The browser decides only the choice, through the box.
 *
 * The choice is `SESSION_LIMIT_COOKIE`, `<session_id>.30d` or `<session_id>.12h`,
 * written by the server client's `setAll` beside the session. It counts only
 * beside the session it names: none, or another session's, is a 12-hour session.
 * So the most anybody editing their own cookies can do is give their own
 * session 30 days from its login, which ticking the box gives anyway.
 */

/** `HttpOnly`; never readable by a page, never in a URL. */
export const SESSION_LIMIT_COOKIE = 'nw-session-limit';

export type SessionChoice = '30d' | '12h';

export const LIMIT_SECONDS: Readonly<Record<SessionChoice, number>> = {
	'30d': 30 * 24 * 60 * 60,
	'12h': 12 * 60 * 60
};

/** `nw-notice`'s value after a session was ended at its limit; `/login` shows it once. */
export const LIMIT_NOTICE: Readonly<Record<SessionChoice, string>> = {
	'12h': 'limit-12h',
	'30d': 'limit-30d'
};

/**
 * Ten minutes rather than the minute the other notices get: the request that
 * ends a session may be the app's background `/wake`, some while before
 * anybody looks at `/login`.
 */
export const LIMIT_NOTICE_SECONDS = 10 * 60;

/** The app server's clock, in seconds: the only "now" the limit is measured with. */
export function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

type AmrEntry = { timestamp?: unknown };

/** The earliest `amr` timestamp, or `null` when the token carries none. */
export function sessionStart(amr: unknown): number | null {
	if (!Array.isArray(amr)) {
		return null;
	}
	const stamps = amr
		.map((entry: AmrEntry) => entry?.timestamp)
		.filter((stamp): stamp is number => typeof stamp === 'number' && Number.isFinite(stamp));
	return stamps.length > 0 ? Math.min(...stamps) : null;
}

export function limitValue(sessionId: string, choice: SessionChoice): string {
	return `${sessionId}.${choice}`;
}

/** The choice recorded for `sessionId`: 30 days only from a cookie naming this very session. */
export function recordedChoice(value: string | undefined, sessionId: string): SessionChoice {
	return sessionId.length > 0 && value === limitValue(sessionId, '30d') ? '30d' : '12h';
}

/** Whether the session's time is up. No start to measure from fails closed. */
export function limitPassed(start: number | null, choice: SessionChoice, now: number): boolean {
	return start === null || now - start >= LIMIT_SECONDS[choice];
}

/**
 * The `maxAge` every cookie of the session is written with: none for a
 * 12-hour session, so the browser deletes it when it closes, and the seconds
 * left to its 30 days for the other, so a refresh never moves the expiry.
 * At least 1: a session past its limit is ended by the hook on the same
 * request anyway, and 0 would be a removal.
 */
export function cookieLifetime(
	start: number | null,
	choice: SessionChoice,
	now: number
): number | undefined {
	if (choice === '12h') {
		return undefined;
	}
	return start === null ? 1 : Math.max(1, start + LIMIT_SECONDS[choice] - now);
}

/** Which limit an `nw-notice` value reports, or `null` for any other notice. */
export function limitNotice(value: string | undefined): SessionChoice | null {
	if (value === LIMIT_NOTICE['12h']) return '12h';
	if (value === LIMIT_NOTICE['30d']) return '30d';
	return null;
}
