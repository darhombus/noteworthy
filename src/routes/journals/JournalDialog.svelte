<script lang="ts">
	/**
	 * Create and edit in one dialog, because the two forms are the same six
	 * fields and only the action they post to differs.
	 *
	 * The dialog owns its fields and its errors. The parent opens it by calling
	 * `open()` on the instance and hears nothing back until a submit succeeds —
	 * so there is no `values` to echo from the server and no stale `form` prop to
	 * clear when it reopens.
	 *
	 * This is the one piece of the page that needs JavaScript: `showModal()` is
	 * what puts it on screen. `use:enhance` degrades on its own, but a dialog
	 * that never opens has nothing to degrade to.
	 */
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { flushSync, tick } from 'svelte';
	import JournalIcon from '$lib/components/JournalIcon.svelte';
	import type { Journal } from '$lib/data/journals';
	import {
		COLOR_STYLES,
		DEFAULT_COLOR,
		DEFAULT_ICON,
		ICON_LABELS,
		JOURNAL_COLORS,
		JOURNAL_ICONS,
		toColor,
		toIcon,
		type JournalColor,
		type JournalIcon as JournalIconKey
	} from '$lib/journals/appearance';
	import { PREVIEW, loadPreview, previewReady } from '$lib/journals/font-preview';
	import {
		DEFAULT_FONT,
		DEFAULT_TEXT_SIZE,
		FONT_LABELS,
		JOURNAL_FONTS,
		TEXT_SIZES,
		TEXT_SIZE_LABELS,
		toFont,
		toTextSize,
		type JournalFont,
		type TextSize
	} from '$lib/journals/fonts';
	import { readFormErrors, type JournalFormErrors } from '$lib/journals/form';
	import { refreshInPlace } from '$lib/navigation/refresh-in-place';

	let element: HTMLDialogElement;
	let nameField: HTMLInputElement;

	/**
	 * The two tabs: Details (name, description, colour, icon) and Font and size.
	 * Both panels stay mounted, so what is typed on one survives a switch and
	 * Save posts both; the other is only hidden.
	 */
	type Tab = 'details' | 'type';
	const TABS: { key: Tab; label: string }[] = [
		{ key: 'details', label: 'Details' },
		{ key: 'type', label: 'Font and size' }
	];
	let tab = $state<Tab>('details');
	const tabButtons: Partial<Record<Tab, HTMLButtonElement>> = {};
	/** Whether Font and size has been shown since the dialog opened. Not drawn, so not state. */
	let typeShown = false;

	let editing = $state<Journal | null>(null);
	let title = $state('');
	let description = $state('');
	let color = $state<JournalColor>(DEFAULT_COLOR);
	let icon = $state<JournalIconKey>(DEFAULT_ICON);
	let font = $state<JournalFont>(DEFAULT_FONT);
	let textSize = $state<TextSize>(DEFAULT_TEXT_SIZE);
	let errors = $state<JournalFormErrors>({});
	let saving = $state(false);

	/** The six fields as the dialog opened with them. */
	let opened = $state<{
		title: string;
		description: string;
		color: JournalColor;
		icon: JournalIconKey;
		font: JournalFont;
		textSize: TextSize;
	}>({
		title: '',
		description: '',
		color: DEFAULT_COLOR,
		icon: DEFAULT_ICON,
		font: DEFAULT_FONT,
		textSize: DEFAULT_TEXT_SIZE
	});

	/**
	 * The preview line (`$lib/journals/font-preview`): the font it is drawn in,
	 * once that font is here, or where it is with the font it was last asked for.
	 */
	let preview = $state<
		{ state: 'ready'; font: JournalFont } | { state: 'loading' } | { state: 'failed' }
	>({ state: 'ready', font: DEFAULT_FONT });
	/** Which request a load belongs to, so a slow one never overwrites a later choice. */
	let tap = 0;

	/**
	 * The journal's font when Font and size is first shown, or a font tapped (or
	 * chosen with the arrow keys): fetch its preview faces if needed, then draw
	 * the line in it.
	 */
	async function previewFont(key: JournalFont): Promise<void> {
		const mine = ++tap;
		if (previewReady(document.fonts, key)) {
			preview = { state: 'ready', font: key };
			return;
		}
		preview = { state: 'loading' };
		const state = await loadPreview(document.fonts, key, navigator.onLine);
		if (mine === tap) {
			preview = state === 'ready' ? { state, font: key } : { state };
		}
	}

	/**
	 * Whether anything differs from how it opened, which keeps the dialog open
	 * on a click outside (`$lib/dialog/outside`). Compared, not "touched", so
	 * a change put back is no change.
	 */
	let changed = $derived(
		title !== opened.title ||
			description !== opened.description ||
			color !== opened.color ||
			icon !== opened.icon ||
			font !== opened.font ||
			textSize !== opened.textSize
	);

	/** Opens on a journal to edit it, or on nothing to create one. */
	export function open(journal: Journal | null): void {
		editing = journal;
		title = journal?.title ?? '';
		description = journal?.description ?? '';
		// A stored value is resolved through the palette on the way in, so a row
		// holding something unrecognised opens with a real selection rather than
		// with no radio checked at all.
		color = toColor(journal?.color ?? DEFAULT_COLOR);
		icon = toIcon(journal?.icon ?? DEFAULT_ICON);
		font = toFont(journal?.font);
		textSize = toTextSize(journal?.text_size);
		opened = { title, description, color, icon, font, textSize };
		// Always on Details. The line waits for Font and size to be shown, so
		// opening the dialog to rename a journal downloads no font. Until then it
		// is Default, which needs no file, and `tap` moves on so a load still out
		// from the last opening cannot land in this one.
		tab = 'details';
		typeShown = false;
		tap += 1;
		preview = { state: 'ready', font: DEFAULT_FONT };
		errors = {};
		saving = false;
		element.showModal();
	}

	/**
	 * Shows a tab. The first time Font and size is shown, the line is drawn in
	 * the journal's font: this one font's preview faces if the tab lacks them,
	 * nothing for Default, never any other font. Called before the panel is
	 * drawn, so a font already here is drawn at once and one on its way says
	 * "Loading the font…", with no Default in between.
	 */
	function showTab(key: Tab): void {
		tab = key;
		if (key === 'type' && !typeShown) {
			typeShown = true;
			void previewFont(font);
		}
	}

	/**
	 * The WAI-ARIA tabs keys, with automatic activation: Left and Right move to
	 * the other tab and show it (two tabs, so each wraps to the other), Home and
	 * End to the first and last. Only the shown tab is in the Tab order.
	 */
	function onTabKey(event: KeyboardEvent): void {
		const at = TABS.findIndex(({ key }) => key === tab);
		const next =
			event.key === 'ArrowRight'
				? (at + 1) % TABS.length
				: event.key === 'ArrowLeft'
					? (at - 1 + TABS.length) % TABS.length
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? TABS.length - 1
							: -1;
		if (next === -1) {
			return;
		}
		event.preventDefault();
		showTab(TABS[next].key);
		tabButtons[TABS[next].key]?.focus();
	}

	/**
	 * Save with the name empty, from Font and size: the browser's own check
	 * refuses it and goes to focus the field, which it cannot do while the field
	 * is hidden (it logs "An invalid form control is not focusable" and does
	 * nothing). `invalid` fires before it looks, so Details is shown here, and
	 * the browser then focuses the field and shows its message as usual.
	 */
	function onInvalid(): void {
		if (tab !== 'details') {
			showTab('details');
			flushSync();
		}
	}

	/**
	 * After a refusal, the tab holding what was refused: Details for anything
	 * of its own (the name first, focused), otherwise Font and size.
	 */
	async function showRefused(): Promise<void> {
		if (errors.title || errors.description || errors.color || errors.icon) {
			showTab('details');
			if (errors.title) {
				await tick();
				nameField.focus();
			}
		} else if (errors.font || errors.text_size) {
			showTab('type');
		}
	}

	/** Back on screen if it was closed while the save was out; see below. */
	function showAgain(): void {
		if (!element.open) {
			element.showModal();
		}
	}

	/**
	 * Every way a save can fail leaves the dialog open with what was typed, as
	 * in `RenameEntryDialog.svelte`, which has the reasoning at more length:
	 * a refusal shows its messages; a request that never completes, or an
	 * action that throws (`error`), gets a message of its own and no
	 * `update()`, which would render the error page and take the typing with
	 * it; and a failure after Escape or Cancel closed the dialog early opens it
	 * again rather than setting errors nobody can see.
	 */
	const submit: SubmitFunction = () => {
		saving = true;

		return async ({ result, update }) => {
			if (result.type === 'failure') {
				saving = false;
				errors = readFormErrors(result.data);
				showAgain();
				await showRefused();
				return;
			}
			if (result.type === 'error') {
				saving = false;
				errors = {
					form: editing
						? 'Could not save the changes. Check the connection and try again.'
						: 'Could not create the journal. Check the connection and try again.'
				};
				showAgain();
				return;
			}

			// `reset: false` because the inputs are bound to state above — resetting
			// the form element would clear the DOM and leave the state behind it
			// untouched, which is worse than not resetting at all. `open()` is what
			// clears the fields, and it runs before the dialog is ever seen again.
			//
			// `saving` stays set until the dialog has closed, as in
			// `RenameEntryDialog.svelte`: `update()` waits for the list to reload,
			// and clearing it first put an enabled "Save changes" back on screen
			// for that long, where a second press sent a second save.
			//
			// In place: the journal is saved by now, and a connection that drops
			// before the list reloads must not take the page with it
			// (`$lib/navigation/refresh-in-place`). The list catches up once the
			// connection is back.
			await refreshInPlace(() => update({ reset: false }));

			if (result.type === 'success') {
				element.close();
			}
			saving = false;
		};
	};
</script>

<!--
	`m-auto` is not decoration. A modal `<dialog>` is centred by the user agent
	stylesheet's `margin: auto`, and Tailwind's preflight resets the margin on
	every element — so without it the dialog opens hard against the top-left
	corner. Same on the delete confirmation.

	THE PATTERN, for any dialog whose content can outgrow a short window: a
	native `<dialog>` opened with `showModal()`, holding a header, a body and a
	footer, where only the body scrolls.

	- The dialog is at most the window's height less 1rem each side, and
	  otherwise as tall as its content. `dvh`, so a phone whose toolbars come and
	  go measures the window it is actually showing. It used to be capped at
	  `85vh`: 493px in a 580px window, under the 532px the form needs, which is
	  what drew a scrollbar with room to spare.
	- It is a flex column (`open:flex`: a bare `flex` would beat the browser's
	  `display: none` and show it while closed), and it never scrolls itself.
	  When it did, the heading scrolled away with everything else, and its
	  scrollbar was painted square across the rounded right-hand corners —
	  Chromium does not clip a scrollbar to `border-radius`. `overflow-hidden`
	  clips the corners for whatever is inside.
	- The header and footer do not shrink; the body is `min-h-0 flex-1` and
	  scrolls, so on a short window the title and the buttons stay put and the
	  fields move between them. `scrollbar-app` (layout.css) draws its bar.
	  Here the body is two tab panels in one cell, each scrolling on its own,
	  with the tabs fixed above them.
-->
<dialog
	bind:this={element}
	data-unsaved={changed || undefined}
	data-saving={saving || undefined}
	class="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-[#E0E0E0] bg-white p-0 shadow-lg backdrop:bg-black/40 open:flex dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
>
	<form
		method="POST"
		action={editing ? '?/edit' : '?/create'}
		use:enhance={submit}
		class="flex min-h-0 flex-1 flex-col"
	>
		{#if editing}
			<input type="hidden" name="journal_id" value={editing.journal_id} />
		{/if}

		<!--
			The header and footer are kept short, so both tabs fit a laptop's
			window and a phone's with the browser's bars and the taskbar taken off
			(docs/constraints.md, "The two tabs"): 49px here, 64 below, with the
			buttons and the tabs at 40.
		-->
		<div class="shrink-0 border-b border-[#E0E0E0] px-6 py-3 dark:border-[#3A3A3A]">
			<h2 class="text-base font-semibold text-[#212121] dark:text-[#F5F5F5]">
				{editing ? 'Edit journal' : 'New journal'}
			</h2>

			<!-- Up here rather than among the fields, so it is seen whichever of them is in view. -->
			{#if errors.form}
				<p
					role="alert"
					class="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
				>
					{errors.form}
				</p>
			{/if}
		</div>

		<!--
			Switched by a tap, a click or the arrow keys; never a swipe, which on a
			phone is Back from the screen's edge, and selecting text in a field.
		-->
		<div
			role="tablist"
			aria-label="Journal settings"
			class="flex shrink-0 border-b border-[#E0E0E0] px-6 dark:border-[#3A3A3A]"
		>
			{#each TABS as { key, label } (key)}
				<button
					bind:this={tabButtons[key]}
					type="button"
					role="tab"
					id="journal-tab-{key}"
					aria-selected={tab === key}
					aria-controls="journal-panel-{key}"
					tabindex={tab === key ? 0 : -1}
					onclick={() => showTab(key)}
					onkeydown={onTabKey}
					class="min-h-10 flex-1 px-2 text-sm focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none focus-visible:ring-inset {tab ===
					key
						? 'font-medium text-[#1565C0] dark:text-[#90CAF9]'
						: 'text-[#616161] hover:text-[#212121] dark:text-[#9E9E9E] dark:hover:text-[#F5F5F5]'}"
				>
					{label}
				</button>
			{/each}
		</div>

		<!--
			The two panels share one grid cell, so the middle is as tall as the
			taller of them on both tabs, and the indicator and the buttons under it
			never move on a switch. The one not shown is `invisible`
			(`visibility: hidden`), not `hidden`: it keeps its height in the cell,
			nothing in it can be focused or tapped, it is out of the accessibility
			tree, and its fields still post. Each panel scrolls on its own, only
			when the window is too short for it.

			Nothing in the hidden panel downloads a font: its labels are in the
			app's font, and the preview line is Default until Font and size is
			first shown (`showTab`). A hidden element is laid out, so a line drawn
			there in a journal font would download it.
		-->
		<div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)]">
			<div
				role="tabpanel"
				id="journal-panel-details"
				aria-labelledby="journal-tab-details"
				data-dialog-body
				class="col-start-1 row-start-1 min-h-0 scrollbar-app space-y-5 overflow-y-auto overscroll-contain px-6 py-4 {tab ===
				'details'
					? ''
					: 'invisible'}"
			>
				<div>
					<label
						for="journal-title"
						class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]"
					>
						Name
					</label>
					<input
						id="journal-title"
						name="title"
						type="text"
						required
						maxlength="200"
						bind:this={nameField}
						bind:value={title}
						oninvalid={onInvalid}
						aria-invalid={errors.title ? 'true' : undefined}
						aria-describedby={errors.title ? 'journal-title-error' : undefined}
						class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
					/>
					{#if errors.title}
						<p id="journal-title-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
							{errors.title}
						</p>
					{/if}
				</div>

				<div>
					<label
						for="journal-description"
						class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]"
					>
						Description <span class="font-normal text-[#616161] dark:text-[#9E9E9E]"
							>(optional)</span
						>
					</label>
					<textarea
						id="journal-description"
						name="description"
						rows="3"
						maxlength="500"
						bind:value={description}
						aria-invalid={errors.description ? 'true' : undefined}
						aria-describedby={errors.description ? 'journal-description-error' : undefined}
						class="mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
					></textarea>
					{#if errors.description}
						<p id="journal-description-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
							{errors.description}
						</p>
					{/if}
				</div>

				<!--
				Every option's `<label>` is `relative`, so its `sr-only` radio (which is
				`position: absolute`) is placed inside the label, and so inside the body
				that scrolls. Without it the radio's containing block is the dialog: a
				tap focuses the radio, the browser scrolls it into view, and what it
				scrolls is the dialog, `overflow-hidden` or not, carrying the heading
				off the top and leaving a blank under the buttons (measured at 320px:
				the dialog scrolled 395px on a tap on Lora).
			-->
				<fieldset>
					<legend class="text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">Colour</legend>
					<div class="mt-2 flex flex-wrap gap-3">
						{#each JOURNAL_COLORS as key (key)}
							<label class="relative cursor-pointer">
								<input
									type="radio"
									name="color"
									value={key}
									bind:group={color}
									class="peer sr-only"
								/>
								<span
									class="block h-8 w-8 rounded-full ring-offset-2 ring-offset-white peer-checked:ring-2 peer-checked:ring-[#212121] peer-focus-visible:ring-2 peer-focus-visible:ring-[#1976D2] dark:ring-offset-[#1E1E1E] dark:peer-checked:ring-[#F5F5F5] {COLOR_STYLES[
										key
									].swatch}"
								></span>
								<span class="sr-only">{COLOR_STYLES[key].label}</span>
							</label>
						{/each}
					</div>
					{#if errors.color}
						<p class="mt-1 text-sm text-red-600 dark:text-red-400">{errors.color}</p>
					{/if}
				</fieldset>

				<fieldset>
					<legend class="text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">Icon</legend>
					<div class="mt-2 flex flex-wrap gap-2">
						{#each JOURNAL_ICONS as key (key)}
							<label class="relative cursor-pointer">
								<input
									type="radio"
									name="icon"
									value={key}
									bind:group={icon}
									class="peer sr-only"
								/>
								<span
									class="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E0E0E0] text-[#616161] peer-checked:border-[#1976D2] peer-checked:bg-[#E3F2FD] peer-checked:text-[#1565C0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#9E9E9E] dark:peer-checked:border-[#1976D2] dark:peer-checked:bg-[#12314B] dark:peer-checked:text-[#90CAF9]"
								>
									<JournalIcon icon={key} />
								</span>
								<span class="sr-only">{ICON_LABELS[key]}</span>
							</label>
						{/each}
					</div>
					{#if errors.icon}
						<p class="mt-1 text-sm text-red-600 dark:text-red-400">{errors.icon}</p>
					{/if}
				</fieldset>
			</div>

			<div
				role="tabpanel"
				id="journal-panel-type"
				aria-labelledby="journal-tab-type"
				data-dialog-body
				class="col-start-1 row-start-1 min-h-0 scrollbar-app overflow-y-auto overscroll-contain px-6 py-4 {tab ===
				'type'
					? ''
					: 'invisible'}"
			>
				<!--
				The font and size of the journal's entries, compact enough that on a
				phone the preview, the sizes and all eleven fonts are on screen
				together: the preview first, then the sizes as one row of three
				joined options, then the fonts in two columns. Every option is at
				least 40px tall, for a finger, with tight gaps: a phone's browser bars
				take part of the screen, and the tab has to fit what is left. The two
				groups' legends are for screen readers; the tab says what both are,
				and the options name themselves.

				Each option is labelled in the app's own font, never in the font it
				names: a label drawn in a font downloads it (and WebKit fetched one
				for a closed `<select>` whose options were styled; "Journal fonts").
				Only the preview line is drawn in a journal font, and only once that
				font is here. A name too long for its column ("Atkinson Hyperlegible"
				at 320px) wraps onto a second line, at the same size, and its row
				grows to hold it.
			-->
				<div data-font-section>
					<!--
					Announced, so a screen reader hears the font arrive or fail. Its
					height is held at the tallest the line gets at this width, so the
					options under it stay where they are while fonts and sizes are
					tapped. Measured, the tallest is three lines of Big (EB Garamond
					106px, a pixel over its 35px lines) up to a 412px window, and two
					(71px) from 416px up, where OpenDyslexic at Big stops wrapping a
					third time. So 106px of line and 10 of padding and border, and 81
					from 440px, which leaves a margin over 416. Without it the box is
					a one-line message tall, and every option under it moved by the
					difference between one tap and the next.
				-->
					<div
						data-font-preview
						aria-live="polite"
						class="flex min-h-[116px] items-center rounded-lg border border-[#E0E0E0] bg-[#FAFAFA] px-3 py-1 text-[#212121] min-[440px]:min-h-[81px] dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
					>
						{#if preview.state === 'loading'}
							<p class="text-sm text-[#616161] dark:text-[#9E9E9E]">Loading the font…</p>
						{:else if preview.state === 'failed'}
							<p class="text-sm text-red-600 dark:text-red-400">
								Couldn't load this font. Check your connection.
							</p>
						{:else}
							<p class="entry-preview" data-entry-font={preview.font} data-entry-size={textSize}>
								{PREVIEW.before}<strong class="font-semibold">{PREVIEW.bold}</strong
								>{PREVIEW.middle}<em>{PREVIEW.italic}</em>{PREVIEW.after}
							</p>
						{/if}
					</div>

					<fieldset class="mt-2">
						<legend class="sr-only">Size</legend>
						<div
							class="flex divide-x divide-[#E0E0E0] overflow-hidden rounded-lg border border-[#E0E0E0] dark:divide-[#3A3A3A] dark:border-[#3A3A3A]"
						>
							{#each TEXT_SIZES as key (key)}
								<label class="relative flex-1 cursor-pointer">
									<input
										type="radio"
										name="text_size"
										value={key}
										bind:group={textSize}
										class="peer sr-only"
									/>
									<span
										class="flex min-h-10 items-center justify-center px-2 text-sm text-[#212121] peer-checked:bg-[#E3F2FD] peer-checked:font-medium peer-checked:text-[#1565C0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#1976D2]/40 peer-focus-visible:ring-inset dark:text-[#F5F5F5] dark:peer-checked:bg-[#12314B] dark:peer-checked:text-[#90CAF9]"
									>
										{TEXT_SIZE_LABELS[key]}
									</span>
								</label>
							{/each}
						</div>
						{#if errors.text_size}
							<p class="mt-1 text-sm text-red-600 dark:text-red-400">{errors.text_size}</p>
						{/if}
					</fieldset>

					<!--
					Two columns on a phone; from `sm`, where the dialog is 512px wide and
					the grid 462, three. Three equal columns (149px) would wrap
					"Atkinson Hyperlegible" (137px of text, 26 of padding and border),
					and four would wrap five names, so each column is shared equally
					but never narrower than its longest name: 141, 141 and 163px, every
					name on one line.

					Below `sm`, one column when two are too narrow for the longest word
					("OpenDyslexic"), rather than a name past its border: each column is
					half the grid but at least 7rem, and `auto-fit` then makes one. The
					word and its padding and border take 6.85rem in Segoe UI and 6.63 in
					Roboto, and two 7rem columns still fit a 320px phone at 16px (116px
					each). At large text: one column at 21px on a 360px phone and at
					24px on the A55 ("Large text on phones").
				-->
					<fieldset class="mt-2">
						<legend class="sr-only">Font</legend>
						<div
							class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,max(7rem,calc(50%_-_0.1875rem))),1fr))] gap-1.5 sm:grid-cols-[repeat(3,minmax(max-content,1fr))]"
						>
							{#each JOURNAL_FONTS as key (key)}
								<label class="relative flex cursor-pointer">
									<input
										type="radio"
										name="font"
										value={key}
										bind:group={font}
										onclick={() => void previewFont(key)}
										class="peer sr-only"
									/>
									<span
										class="flex min-h-10 w-full items-center rounded-lg border border-[#E0E0E0] px-3 py-1 text-sm leading-tight text-[#212121] peer-checked:border-[#1976D2] peer-checked:bg-[#E3F2FD] peer-checked:text-[#1565C0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:peer-checked:border-[#1976D2] dark:peer-checked:bg-[#12314B] dark:peer-checked:text-[#90CAF9]"
									>
										{FONT_LABELS[key]}
									</span>
								</label>
							{/each}
						</div>
						{#if errors.font}
							<p class="mt-1 text-sm text-red-600 dark:text-red-400">{errors.font}</p>
						{/if}
					</fieldset>
				</div>
			</div>
		</div>

		<div class="shrink-0 border-t border-[#E0E0E0] px-6 pt-1.5 pb-2 dark:border-[#3A3A3A]">
			<!--
				Which tab is shown, as two lines: the shown tab's long and brand blue,
				the other's short and the border grey. A switch grows one and shrinks
				the other; with reduced motion they change at once. Decorative: the
				tabs carry the state.
			-->
			<div data-tab-indicator aria-hidden="true" class="flex justify-center gap-1.5">
				{#each TABS as { key } (key)}
					<span
						data-tab-line={key}
						class="block h-[3px] rounded-full transition-[width,background-color] duration-200 ease-out motion-reduce:transition-none {tab ===
						key
							? 'w-6 bg-[#1976D2]'
							: 'w-2 bg-[#E0E0E0] dark:bg-[#3A3A3A]'}"
					></span>
				{/each}
			</div>

			<div class="mt-1.5 flex justify-end gap-2">
				<button
					type="button"
					onclick={() => element.close()}
					class="min-h-10 rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving}
					class="min-h-10 rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 disabled:opacity-60"
				>
					{saving ? 'Saving…' : editing ? 'Save changes' : 'Create journal'}
				</button>
			</div>
		</div>
	</form>
</dialog>
