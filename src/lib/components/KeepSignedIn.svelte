<script lang="ts">
	/**
	 * "Remember me", on login and signup (PRD 11): ticked, a 30-day session. A
	 * real checkbox in its label, posted as `remember=on` only when ticked, so it
	 * works without JavaScript. Unticked unless the page passes it ticked.
	 *
	 * `bind:checked` rather than `checked={…}`: a hydrated field written by an
	 * expression is written again whenever anything else in the template changes
	 * (docs/constraints.md, "Inputs written by an expression"). The page keeps
	 * the state, a `$state` started once from `form`.
	 *
	 * The label is the tap target: the whole label, at least 40 px tall.
	 *
	 * Beside it, an info button opening a short note: a `<details>`/`<summary>`,
	 * so it opens and closes (tap again) without JavaScript, its state is the
	 * browser's own expanded state, and it can neither submit the form (a summary
	 * is not a button) nor tick the box (it sits outside the label; measured, a
	 * summary inside it would not tick it either). The note is not inside the `<details>`
	 * but a later sibling, shown by `peer-open`, so it can take the row's whole
	 * width on a line of its own below it, in the flow: it never covers a field or a
	 * button. Not `popover`: it closes on an outside tap and Escape by itself,
	 * but it is drawn in the top layer, over whatever is below. With JavaScript,
	 * an outside tap and Escape close it here (docs/constraints.md, "Keep me
	 * signed in").
	 *
	 * `end` is drawn at the row's end: the login page's "Forgot password?".
	 */
	import type { Snippet } from 'svelte';

	let { checked = $bindable(false), end }: { checked?: boolean; end?: Snippet } = $props();

	let details: HTMLDetailsElement | undefined = $state();
	let note: HTMLParagraphElement | undefined = $state();

	$effect(() => {
		if (!details || !note) {
			return;
		}
		const [own, shown] = [details, note];
		// A tap anywhere but the button or the note. Capture, so nothing below
		// stopping propagation can swallow it; the button's own tap is left to
		// the browser, which closes it.
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (own.open && target instanceof Node && !own.contains(target) && !shown.contains(target)) {
				own.open = false;
			}
		};
		const onKeydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && own.open) {
				own.open = false;
			}
		};
		document.addEventListener('click', onClick, true);
		document.addEventListener('keydown', onKeydown);
		return () => {
			document.removeEventListener('click', onClick, true);
			document.removeEventListener('keydown', onKeydown);
		};
	});
</script>

<div class="flex flex-wrap items-center gap-x-1">
	<label
		for="remember"
		class="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-[#212121] dark:text-[#F5F5F5]"
	>
		<input
			id="remember"
			name="remember"
			type="checkbox"
			bind:checked
			class="h-5 w-5 shrink-0 cursor-pointer rounded border-[#BDBDBD] bg-white text-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/40 focus:ring-offset-0 dark:border-[#616161] dark:bg-[#121212] dark:text-[#90CAF9] dark:focus:ring-[#90CAF9]/40"
		/>
		Remember me
	</label>
	<details bind:this={details} class="peer">
		<!-- The name is visually hidden text, not `aria-label`: `getByLabel('Remember
		     me')` would match an `aria-label` holding those words, as the eye's would
		     match "Password". -->
		<summary
			aria-controls="remember-note"
			class="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full text-[#616161] hover:text-[#212121] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#9E9E9E] dark:hover:text-[#F5F5F5] [&::-webkit-details-marker]:hidden"
		>
			<span class="sr-only">About Remember me</span>
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
				<circle cx="12" cy="12" r="10" />
				<text
					x="12"
					y="16.5"
					text-anchor="middle"
					font-size="13"
					font-style="italic"
					font-weight="700"
					fill="currentColor"
					stroke="none">i</text
				>
			</svg>
		</summary>
	</details>
	{@render end?.()}
	<p
		bind:this={note}
		id="remember-note"
		class="hidden basis-full rounded-lg border border-[#E0E0E0] bg-[#FAFAFA] px-3 py-2 text-sm text-[#616161] peer-open:block dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#9E9E9E]"
	>
		Stay signed in on this device for 30 days. Otherwise, you'll be signed out when the browser
		closes, or after 12 hours.
	</p>
</div>
