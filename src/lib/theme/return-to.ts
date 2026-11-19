/**
 * Where `/theme` sends somebody back to when it has no JavaScript to lean on.
 *
 * The form carries the page it was submitted from, because a POST to an
 * endpoint has to redirect somewhere and the endpoint has no other way to know
 * where the person was. That value arrives in a request body, which means it is
 * whatever the sender typed — so it is a redirect target from an untrusted
 * source, and those are open redirects unless something says otherwise.
 *
 * An open redirect on a route anonymous visitors can reach is worth more than
 * it looks: `https://noteworthy.app/theme` that lands on an attacker's login
 * page carries this app's domain in the link somebody was asked to click.
 */

/** Same-origin paths only, and `/` for anything that is not obviously one. */
export function safeReturnTo(value: FormDataEntryValue | null): string {
	if (typeof value !== 'string' || !value.startsWith('/')) {
		return '/';
	}

	/**
	 * `//evil.example` is a protocol-relative URL: it starts with a slash and
	 * goes to another origin. `/\evil.example` is the same trick — browsers
	 * normalise the backslash to a slash, so a check for `//` alone lets it
	 * through.
	 */
	if (value.startsWith('//') || value.startsWith('/\\')) {
		return '/';
	}

	return value;
}
