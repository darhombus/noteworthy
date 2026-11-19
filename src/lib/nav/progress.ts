/**
 * When the navigation progress bar shows (`NavProgress.svelte`): only once a
 * client-side navigation has taken `SHOW_AFTER_MS`, so one that finishes
 * sooner never flashes it, and from the first of several navigations that
 * follow one another without a pause between them.
 */

/** How long a navigation runs before the bar shows. */
export const SHOW_AFTER_MS = 100;

export type DelayedFlag = {
	/** Something started: the flag goes up after the delay, unless it is up or on its way. */
	start(): void;
	/** It finished: the flag comes down now, and one on its way never goes up. */
	stop(): void;
};

export function delayedFlag(delay: number, onChange: (up: boolean) => void): DelayedFlag {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let up = false;
	return {
		start() {
			if (up || timer !== undefined) {
				return;
			}
			timer = setTimeout(() => {
				timer = undefined;
				up = true;
				onChange(true);
			}, delay);
		},
		stop() {
			clearTimeout(timer);
			timer = undefined;
			if (up) {
				up = false;
				onChange(false);
			}
		}
	};
}
