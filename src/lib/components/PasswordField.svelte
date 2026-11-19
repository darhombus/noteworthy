<script lang="ts">
	/**
	 * A password input with a show/hide button at its end.
	 *
	 * The button's name is visually hidden text, not `aria-label`: Playwright's
	 * `getByLabel('Password')` matches an `aria-label` containing the word, and
	 * every spec finds this field that way.
	 *
	 * A press on the button keeps the caret where it was. Pointer presses do not
	 * take the focus off the field (`mousedown` is cancelled, which on a phone
	 * also keeps the keyboard up). Chromium moved the caret to the start when the
	 * type changed after a real press on a field holding typed text, with the
	 * layout left to the next frame; Firefox and WebKit kept it (measured on a
	 * bare page too, so not this app). Changing the type at once (`flushSync`)
	 * and forcing layout in the same task keeps it: measured, and putting the
	 * selection back by hand afterwards was not needed. From the keyboard the
	 * button has the focus, and the field keeps its selection for Shift+Tab.
	 *
	 * Hidden again whenever the form submits, so a password is never left on
	 * screen while the next page loads, or after a failed attempt.
	 *
	 * Edge draws its own reveal button inside a password input; it is hidden so
	 * that there is one eye, not two.
	 */
	import { flushSync } from 'svelte';
	let {
		id,
		name,
		autocomplete,
		minlength,
		invalid = false,
		describedby
	}: {
		id: string;
		name: string;
		autocomplete: 'current-password' | 'new-password';
		minlength?: number;
		invalid?: boolean;
		describedby?: string;
	} = $props();

	let shown = $state(false);
	let input: HTMLInputElement | undefined = $state();

	$effect(() => {
		const form = input?.form;
		if (!form) {
			return;
		}
		const hide = () => (shown = false);
		form.addEventListener('submit', hide);
		return () => form.removeEventListener('submit', hide);
	});

	function toggle(): void {
		flushSync(() => (shown = !shown));
		// Laid out in this task: see above. Read for its side effect.
		void input?.offsetWidth;
	}
</script>

<div class="relative mt-1">
	<input
		bind:this={input}
		{id}
		{name}
		type={shown ? 'text' : 'password'}
		{autocomplete}
		required
		{minlength}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={describedby}
		class="w-full rounded-lg border border-[#E0E0E0] bg-white py-2 pr-11 pl-3 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5] [&::-ms-reveal]:hidden"
	/>
	<button
		type="button"
		aria-controls={id}
		onmousedown={(event) => event.preventDefault()}
		onclick={toggle}
		class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-[#616161] hover:text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#9E9E9E] dark:hover:text-[#F5F5F5]"
	>
		<span class="sr-only">{shown ? 'Hide password' : 'Show password'}</span>
		<svg
			class="h-5 w-5"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
			<circle cx="12" cy="12" r="3" />
			{#if shown}
				<path d="M3 3l18 18" />
			{/if}
		</svg>
	</button>
</div>
