<script lang="ts">
	/**
	 * Light, dark or system, as three buttons showing which one is on.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY A FORM AND NOT THREE BARE BUTTONS
	 * ---------------------------------------------------------------------------
	 * Three submit buttons in a form, posting to `/theme`. With script running,
	 * `choose` cancels the submit and does the work locally — the class on
	 * `<html>` and the cookie, no round trip, nothing to wait for. Without it,
	 * the browser posts the form itself and the endpoint sets the same cookie and
	 * redirects back. Same control, one markup, working either way.
	 *
	 * It is also why each option is a `<button>` carrying its own value rather
	 * than a click handler on a `<div>`: the no-JS path needs a real submitter,
	 * and `event.submitter` is what tells the handler which one was pressed.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY THREE BUTTONS AND NOT ONE THAT CYCLES
	 * ---------------------------------------------------------------------------
	 * A cycling button has to say what it will do next while also saying what is
	 * on now, and with three states it takes two presses to find out what the
	 * third one was. Three buttons show the whole choice at once and make the
	 * current one visible without anybody clicking anything.
	 */
	import { page } from '$app/state';
	import { applyTheme } from '$lib/theme/apply';
	import { parseTheme, type Theme } from '$lib/theme/cookie';

	let { class: className = '' }: { class?: string } = $props();

	/** Sun, moon and monitor, drawn like `NavIcon` so they sit beside it evenly. */
	const OPTIONS: { value: Theme; label: string; paths: string[] }[] = [
		{
			value: 'light',
			label: 'Light',
			paths: [
				'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
				'M12 1v2',
				'M12 21v2',
				'M4.2 4.2l1.4 1.4',
				'M18.4 18.4l1.4 1.4',
				'M1 12h2',
				'M21 12h2',
				'M4.2 19.8l1.4-1.4',
				'M18.4 5.6l1.4-1.4'
			]
		},
		{
			value: 'dark',
			label: 'Dark',
			paths: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z']
		},
		{
			value: 'system',
			label: 'System',
			paths: ['M3 5h18v11H3V5Z', 'M8 21h8', 'M12 16v5']
		}
	];

	/**
	 * `page.data.theme` is what the server rendered this page with, and it stays
	 * right until somebody clicks — at which point the cookie has changed but the
	 * page has not navigated, so the server's answer is one click stale.
	 * `chosen` is that click, and it wins for as long as this component lives.
	 *
	 * Nothing has to clear it. A navigation re-reads the cookie the click wrote,
	 * so the two agree from then on; a full reload remounts this and `chosen`
	 * starts as `null` again, which is what makes a browser with cookies turned
	 * off show the truth rather than a choice that did not stick.
	 */
	let chosen = $state<Theme | null>(null);
	let current = $derived(chosen ?? page.data.theme);

	function choose(event: SubmitEvent) {
		const submitter = event.submitter;

		// Falling through to a real submit is the right failure: the endpoint does
		// exactly this, and a theme that changes on the next page load beats one
		// that does not change at all.
		if (!(submitter instanceof HTMLButtonElement)) {
			return;
		}

		event.preventDefault();

		const next = parseTheme(submitter.value);
		chosen = next;
		applyTheme(next);
	}
</script>

<form method="POST" action="/theme" onsubmit={choose} class={className}>
	<!--
		Where the no-JS path comes back to. Unused when script is running, because
		`choose` cancels the submit before it is ever sent.
	-->
	<input type="hidden" name="redirectTo" value={page.url.pathname + page.url.search} />

	<fieldset>
		<legend class="mb-1.5 px-1 text-xs font-medium text-[#616161] dark:text-[#9E9E9E]">
			Theme
		</legend>

		<div
			class="flex gap-1 rounded-lg border border-[#E0E0E0] bg-white p-1 dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			{#each OPTIONS as option (option.value)}
				{@const active = current === option.value}
				<button
					type="submit"
					name="theme"
					value={option.value}
					aria-pressed={active}
					title={option.label}
					class="flex flex-1 items-center justify-center rounded-md px-2 py-1.5 focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 {active
						? 'bg-[#1976D2] text-white dark:bg-[#1E3A5F] dark:text-[#F5F5F5]'
						: 'text-[#616161] hover:bg-[#E0E0E0] dark:text-[#9E9E9E] dark:hover:bg-[#3A3A3A]'}"
				>
					<svg
						class="h-4 w-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.75"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						{#each option.paths as d (d)}
							<path {d} />
						{/each}
					</svg>
					<!-- The icon is `aria-hidden`, so this is the button's whole name. -->
					<span class="sr-only">{option.label}</span>
				</button>
			{/each}
		</div>
	</fieldset>
</form>
