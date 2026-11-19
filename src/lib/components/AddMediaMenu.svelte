<script lang="ts">
	/**
	 * The toolbar's thirteenth control: Add media, and the menu it opens.
	 *
	 * ---------------------------------------------------------------------------
	 * ONE BUTTON, THREE WAYS IN
	 * ---------------------------------------------------------------------------
	 * Photos, video, audio files and recordings are four things to add and would
	 * be four buttons in a row that already wraps onto three lines on a narrow
	 * phone. One button and a small menu keeps the row as it was and leaves room
	 * for the rest. The menu also has somewhere to say how much space is left,
	 * which a button has not.
	 *
	 * *Record audio* opens the recorder under the toolbar (`AudioRecorder.svelte`).
	 * Where this browser cannot record — over plain http, where there is no
	 * microphone to ask for, or in a browser with no recorder — it stays in the
	 * menu, unusable, and says why underneath rather than failing when chosen:
	 * the menu is where somebody will look for it, and an item that explains
	 * itself answers the question a missing item would raise.
	 *
	 * *Photo or video* and *Audio file* each open a file picker of their own,
	 * asking for their own types. Whatever comes back goes through the same
	 * checks either way — a picker's list is a suggestion the person can
	 * override — but a file picked through *Audio file* is treated as audio where
	 * its type could mean either (`$lib/media/intake`).
	 *
	 * ---------------------------------------------------------------------------
	 * KEYBOARD
	 * ---------------------------------------------------------------------------
	 * The WAI-ARIA menu button pattern. The button is one stop on the toolbar's
	 * roving tabindex, like every other control; Enter, Space and Down open the
	 * menu and put focus on its first item; Up opens it on the last. Inside,
	 * Up and Down move, Home and End jump, Enter and Space choose, Escape closes
	 * and gives the button its focus back, and Tab closes it and carries on out
	 * of the toolbar.
	 *
	 * Disabled items keep their place in that walk — `aria-disabled` rather than
	 * `disabled`, because a menu somebody cannot walk through is a menu they
	 * cannot read, and the reason an item cannot be used is the part worth
	 * reading. Each such reason is the item's description.
	 *
	 * The menu's keys are stopped from reaching the toolbar. Its own handler
	 * takes Left and Right to move between controls, and inside an open menu
	 * that would walk the toolbar under it.
	 */
	import { AUDIO_ACCEPT, PHOTO_OR_VIDEO_ACCEPT } from '$lib/media/intake';
	import { ENTRY_FULL, formatLeft } from '$lib/media/messages';
	import type { RecordingSupport } from '$lib/media/recording';
	import { placeMenu, stepMenu } from '$lib/menu/menu';
	import ToolbarIcon from './ToolbarIcon.svelte';

	let {
		remaining,
		full,
		tabbable,
		onFocus,
		onFiles,
		recording
	}: {
		/** Bytes left in the allowance, or `null` if it could not be read. */
		remaining: number | null;
		/** Whether the entry already holds as much media as it may. */
		full: boolean;
		/** Whether this control is the toolbar's current tab stop. */
		tabbable: boolean;
		onFocus: () => void;
		onFiles: (files: File[], options?: { audio?: boolean }) => void;
		recording: {
			/** Whether this browser can record here, and if not, why. */
			support: RecordingSupport;
			/** A recording is already open under the toolbar. */
			open: boolean;
			/** Called inside the click, which Safari needs for the level meter. */
			onRecord: () => void;
		};
	} = $props();

	const ALREADY_RECORDING = 'A recording is open under the toolbar. Add or discard it first.';

	let button = $state<HTMLButtonElement | null>(null);
	let menu = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let audioInput = $state<HTMLInputElement | null>(null);
	let open = $state(false);

	/**
	 * Where the menu sits, measured when it opens.
	 *
	 * It hangs off a 36px button that can be anywhere along a row that wraps, so
	 * neither "left-aligned" nor "right-aligned" keeps it on screen: on a 390px
	 * phone the button can sit far enough right that a left-aligned menu runs off
	 * that edge, and far enough left that a right-aligned one runs off the other.
	 * So it is placed against the *window* — the button's position, clamped to a
	 * gutter at either side — and narrowed if the window is narrower than it is.
	 * `placeMenu` does the sums, shared with `ActionMenu`. Only its horizontal
	 * half is used: this menu always hangs below, inside the pinned toolbar row,
	 * which is at the top of the window whenever it is open.
	 */
	let placement = $state({ left: 0, width: 260 });

	const MENU_WIDTH = 260;

	type Item = {
		id: string;
		label: string;
		/** Why it cannot be used, for the item's own description. */
		note?: string;
		run?: () => void;
	};

	let items = $derived<Item[]>([
		{
			id: 'photo',
			label: 'Photo or video',
			note: full ? ENTRY_FULL : undefined,
			run: full ? undefined : () => input?.click()
		},
		{
			id: 'audio-file',
			label: 'Audio file',
			// The full-entry note is said once, under the first item.
			run: full ? undefined : () => audioInput?.click()
		},
		{
			id: 'record',
			label: 'Record audio',
			// A browser that cannot record says so whether or not the entry is full:
			// it is the reason that will still be true after a photo is removed.
			note: !recording.support.ok
				? recording.support.message
				: recording.open
					? ALREADY_RECORDING
					: undefined,
			run: recording.support.ok && !recording.open && !full ? recording.onRecord : undefined
		}
	]);

	function itemButtons(): HTMLButtonElement[] {
		return [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
	}

	function show(focus: 'first' | 'last'): void {
		const box = button?.getBoundingClientRect();
		if (box !== undefined) {
			const placed = placeMenu(
				box,
				{ width: MENU_WIDTH, height: 0 },
				{ width: window.innerWidth, height: window.innerHeight },
				'start'
			);
			placement = { left: placed.left - box.left, width: placed.width };
		}
		open = true;
		// After the menu is in the DOM.
		queueMicrotask(() => {
			const buttons = itemButtons();
			(focus === 'first' ? buttons[0] : buttons[buttons.length - 1])?.focus();
		});
	}

	function hide(toButton: boolean): void {
		if (!open) {
			return;
		}
		open = false;
		if (toButton) {
			button?.focus();
		}
	}

	function choose(item: Item): void {
		if (item.run === undefined) {
			return;
		}
		// Closed first, so the picker is not opened behind a menu that is still up.
		// `input.click()` still counts as coming from this press, which is what
		// lets the browser open the file picker at all.
		open = false;
		item.run();
	}

	function onMenuKeyDown(event: KeyboardEvent): void {
		const buttons = itemButtons();
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const next = stepMenu(event.key, index, buttons.length);

		switch (next === null ? event.key : 'move') {
			case 'move':
				buttons[next ?? 0]?.focus();
				break;
			case 'Escape':
				hide(true);
				break;
			case 'Tab':
				// Closed, and the browser moves focus on as it would anywhere else.
				open = false;
				return;
			default:
				// Everything else, including Enter and Space, is the button's own.
				event.stopPropagation();
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	}

	function onButtonKeyDown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			// Not stopped: Left and Right still belong to the toolbar, and this is
			// neither.
			show(event.key === 'ArrowDown' ? 'first' : 'last');
		}
	}

	function onPicked(event: Event, audio: boolean): void {
		const picker = event.currentTarget as HTMLInputElement;
		const files = [...(picker.files ?? [])];
		// Cleared, so choosing the same file again is still a change.
		picker.value = '';
		if (files.length > 0) {
			onFiles(files, { audio });
		}
	}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (open && !menu?.contains(event.target as Node) && !button?.contains(event.target as Node)) {
			hide(false);
		}
	}}
/>

<div class="relative inline-flex align-top">
	<button
		bind:this={button}
		type="button"
		data-toolbar-control="addMedia"
		tabindex={tabbable ? 0 : -1}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-describedby={remaining === null ? undefined : 'add-media-space'}
		title="Add media"
		onfocus={onFocus}
		onkeydown={onButtonKeyDown}
		onmousedown={(event) => event.preventDefault()}
		onclick={() => (open ? hide(false) : show('first'))}
		class="flex h-9 w-9 items-center justify-center rounded-md text-[#424242] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#BDBDBD]
		{open
			? 'bg-[#E3F2FD] text-[#1976D2] dark:bg-[#1E3A5F] dark:text-[#90CAF9]'
			: 'hover:bg-[#F5F5F5] dark:hover:bg-[#2C2C2C]'}"
	>
		<ToolbarIcon name="addMedia" />
		<span class="sr-only">Add media</span>
	</button>

	{#if open}
		<!--
			`absolute` inside the toolbar row, which is `sticky` and above the text:
			the menu paints over the entry rather than pushing it down, so opening it
			never moves what somebody is writing.
		-->
		<div
			bind:this={menu}
			role="menu"
			aria-label="Add media"
			tabindex={-1}
			onkeydown={onMenuKeyDown}
			style:width="{placement.width}px"
			style:left="{placement.left}px"
			class="absolute top-full z-20 mt-1 rounded-xl border border-[#E0E0E0] bg-white py-1 shadow-lg dark:border-[#3A3A3A] dark:bg-[#1E1E1E]"
		>
			{#each items as item (item.id)}
				{@const usable = item.run !== undefined}
				<button
					type="button"
					role="menuitem"
					tabindex={-1}
					aria-disabled={usable ? undefined : 'true'}
					aria-describedby={item.note === undefined ? undefined : `add-media-note-${item.id}`}
					onclick={() => choose(item)}
					class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm
					{usable
						? 'text-[#212121] hover:bg-[#F5F5F5] focus-visible:bg-[#F5F5F5] focus-visible:outline-none dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C] dark:focus-visible:bg-[#2C2C2C]'
						: 'cursor-default text-[#9E9E9E] focus-visible:bg-[#F5F5F5] focus-visible:outline-none dark:text-[#757575] dark:focus-visible:bg-[#2C2C2C]'}"
				>
					{item.label}
				</button>
				{#if item.note !== undefined}
					<p
						id="add-media-note-{item.id}"
						class="px-3 pb-2 text-xs text-[#616161] dark:text-[#9E9E9E]"
					>
						{item.note}
					</p>
				{/if}
			{/each}

			{#if remaining !== null}
				<p
					id="add-media-space"
					class="mt-1 border-t border-[#E0E0E0] px-3 pt-2 pb-1 text-xs text-[#616161] dark:border-[#3A3A3A] dark:text-[#9E9E9E]"
				>
					{formatLeft(remaining)} left
				</p>
			{/if}
		</div>
	{/if}

	<!--
		No `name`, so neither is part of what the entry form posts — and `accept`
		lists concrete types rather than `image/*`, which is what makes Safari on a
		Mac hand over a HEIC photo as a JPEG. See `$lib/media/intake`.
	-->
	<input
		bind:this={input}
		type="file"
		accept={PHOTO_OR_VIDEO_ACCEPT}
		multiple
		class="hidden"
		onchange={(event) => onPicked(event, false)}
	/>
	<input
		bind:this={audioInput}
		type="file"
		accept={AUDIO_ACCEPT}
		multiple
		class="hidden"
		onchange={(event) => onPicked(event, true)}
	/>
</div>
