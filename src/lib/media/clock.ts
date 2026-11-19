/**
 * The browser's own time since this document's navigation began, for timing a
 * signed link's life without ever reading a time the server wrote.
 *
 * Two clocks, and the later of them. `performance.now()` is monotonic, but not
 * every platform keeps it running while the device sleeps (a phone in a
 * pocket, a laptop with its lid shut), and a link kept across that sleep would
 * look younger than it is. The wall clock (`Date.now()` less the navigation's
 * own `timeOrigin`, both this device's) does run through sleep, but can be set
 * back. Taking whichever says more time has passed, and never going backwards,
 * makes a clock that can run early but not late: a link is thought older than
 * it is, never younger. Both readings are this device's; neither is compared
 * with the server's.
 */
let latest = 0;

export function deviceClock(): number {
	const monotonic = performance.now();
	const wall = Date.now() - performance.timeOrigin;
	latest = Math.max(latest, monotonic, wall);
	return latest;
}
