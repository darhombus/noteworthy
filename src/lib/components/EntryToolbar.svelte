<script lang="ts">
	/**
	 * The thirteen buttons above the entry body.
	 *
	 * ---------------------------------------------------------------------------
	 * THIRTEEN BUTTONS, TWELVE CONTROLS
	 * ---------------------------------------------------------------------------
	 * The sanctioned set is undo, redo, headings, bold, italic, strikethrough,
	 * highlight, bullet list, numbered list, blockquote, link and Add media —
	 * twelve, with "headings" counted once. It is drawn here as thirteen buttons
	 * because the two heading levels get one each rather than sharing a dropdown.
	 *
	 * Add media is the only one that is not a command: it opens a menu, and
	 * `AddMediaMenu.svelte` holds it and says why there is a menu at all. It is
	 * an ordinary stop on the roving tabindex below, so the row is still one tab
	 * stop with the arrows moving inside it.
	 *
	 * A fourteenth, Collapse all, follows Add media while the entry holds any
	 * media, and joins the same walk. It is not formatting either: it changes how
	 * the entry is shown while it is open, and nothing that is saved (see
	 * `$lib/entries/collapse`).
	 *
	 * A `<select>` would have hit eleven exactly and was the first attempt. Two
	 * buttons won on the thing this toolbar does most: taking formatting *off*
	 * again. Every other control here is a toggle that undoes itself on a second
	 * press, and a dropdown does not — turning a heading back into a paragraph
	 * means opening a menu and finding "Paragraph", which is three interactions
	 * for the reverse of a one-interaction action. It would also have been the one
	 * control in the row whose "active" state was a selected option rather than a
	 * pressed button, for a screen reader as well as for the eye.
	 *
	 * ---------------------------------------------------------------------------
	 * EVERY BUTTON SAYS type="button"
	 * ---------------------------------------------------------------------------
	 * This toolbar renders inside the edit page's `<form>`, and a `<button>` with
	 * no `type` is a submit button. Without it, clicking Bold posts the entry and
	 * navigates away — silently, in the sense that it looks like the editor threw
	 * the click away and lost the page. `e2e/entry-toolbar.e2e.ts` presses a
	 * formatting button and asserts the page did not move, because a missing
	 * `type` on a button added later would not fail anything else.
	 *
	 * ---------------------------------------------------------------------------
	 * FOCUS: THE TOOLBAR IS ONE TAB STOP
	 * ---------------------------------------------------------------------------
	 * `role="toolbar"` with a roving tabindex, per the WAI-ARIA pattern: one
	 * button is tabbable at a time and the arrow keys move between them. The
	 * alternative — twelve tab stops — sits directly in front of the body field on
	 * the page, so a keyboard user who wanted to write would press Tab twelve
	 * times to reach the words.
	 *
	 * Nothing here is `disabled`, deliberately, and Undo with an empty history is
	 * the reason. A disabled button cannot be focused, so the roving tab stop
	 * could land on one and the toolbar would have no way in at all. They carry
	 * `aria-disabled` and ignore their own clicks instead, which is what the
	 * pattern asks for.
	 *
	 * `onmousedown` is prevented on every button so that clicking one never takes
	 * focus out of the editor. ProseMirror would survive it — the commands all
	 * chain through `.focus()` — but the selection visibly drops and comes back,
	 * and on a phone the keyboard closes and reopens.
	 */
	import type { Editor } from '@tiptap/core';
	import type { ToolbarState, WordMark } from '$lib/entries/toolbar';
	import { labelWithShortcut, shortcutAria, type Shortcut } from '$lib/entries/shortcuts';
	import type { RecordingSupport } from '$lib/media/recording';
	import AddMediaMenu from './AddMediaMenu.svelte';
	import ToolbarIcon, { type ToolbarIconName } from './ToolbarIcon.svelte';

	let {
		editor,
		toolbar,
		media,
		onRequestLink,
		onToggleMark,
		onCollapseAll,
		controls
	}: {
		/**
		 * `null` while the edit page waits for the editor's chunk: the row is drawn
		 * as it will be, lit as it will be, and `inert` around it (`EntryEditor`,
		 * THE WAIT), so nothing here can be pressed before there is an editor.
		 */
		editor: Editor | null;
		toolbar: ToolbarState;
		/**
		 * The Add media control's own state: what is left of the allowance, whether
		 * this entry can hold another photo, and where picked files go. It is not
		 * part of `ToolbarState`, which is twelve booleans read off the editor on
		 * every transaction; these change on their own schedule.
		 */
		media: {
			remaining: number | null;
			full: boolean;
			/** `audio`: picked through *Audio file*. See `$lib/media/intake`. */
			onFiles: (files: File[], options?: { audio?: boolean }) => void;
			/** *Record audio*: see `AddMediaMenu`. */
			recording: {
				support: RecordingSupport;
				open: boolean;
				onRecord: () => void;
			};
		};
		/** Link needs a URL, so it opens a dialog rather than running a command. */
		onRequestLink: () => void;
		/**
		 * Toggling a mark is not `chain().toggleBold()`, and the reason is in
		 * `toggleMarkAcrossWord` in `$lib/entries/editor`: with a collapsed cursor
		 * that command acts on nothing. It lives over there rather than here so
		 * that the keyboard shortcuts run the same code, and it arrives as a
		 * callback rather than an import because this component must not pull
		 * TipTap into the server bundle.
		 */
		onToggleMark: (name: WordMark) => void;
		/**
		 * Collapse all, or Expand all. A callback for the same reason as
		 * `onToggleMark`: the command lives with the editor, and importing it here
		 * would pull TipTap into the server bundle.
		 */
		onCollapseAll: (collapse: boolean) => void;
		/** The id of the element this toolbar formats, for `aria-controls`. */
		controls: string;
	} = $props();

	type Control = {
		id: string;
		label: string;
		icon: ToolbarIconName;
		shortcut?: Shortcut;
		/** Toggles report `aria-pressed`; actions have no on-state to report. */
		toggle: boolean;
		active?: (s: ToolbarState) => boolean;
		available?: (s: ToolbarState) => boolean;
		run: () => void;
	};

	/**
	 * Grouped so the row breaks in the right places on a narrow screen, and so a
	 * screen reader announces "History", "Headings" and so on rather than twelve
	 * loose buttons. The groups are also the wrap unit: see the note on the
	 * markup.
	 */
	const GROUPS: { label: string; controls: Control[] }[] = [
		{
			label: 'History',
			controls: [
				{
					id: 'undo',
					label: 'Undo',
					icon: 'undo',
					shortcut: ['Mod', 'Z'],
					toggle: false,
					available: (s) => s.canUndo,
					run: () => editor?.chain().focus().undo().run()
				},
				{
					id: 'redo',
					label: 'Redo',
					icon: 'redo',
					shortcut: ['Mod', 'Shift', 'Z'],
					toggle: false,
					available: (s) => s.canRedo,
					run: () => editor?.chain().focus().redo().run()
				}
			]
		},
		{
			label: 'Headings',
			controls: [
				{
					id: 'heading1',
					label: 'Heading 1',
					icon: 'h1',
					shortcut: ['Mod', 'Alt', '1'],
					toggle: true,
					active: (s) => s.heading1,
					run: () => editor?.chain().focus().toggleHeading({ level: 1 }).run()
				},
				{
					id: 'heading2',
					label: 'Heading 2',
					icon: 'h2',
					shortcut: ['Mod', 'Alt', '2'],
					toggle: true,
					active: (s) => s.heading2,
					run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run()
				}
			]
		},
		{
			label: 'Text',
			controls: [
				{
					id: 'bold',
					label: 'Bold',
					icon: 'bold',
					shortcut: ['Mod', 'B'],
					toggle: true,
					active: (s) => s.bold,
					run: () => onToggleMark('bold')
				},
				{
					id: 'italic',
					label: 'Italic',
					icon: 'italic',
					shortcut: ['Mod', 'I'],
					toggle: true,
					active: (s) => s.italic,
					run: () => onToggleMark('italic')
				},
				{
					id: 'strike',
					label: 'Strikethrough',
					icon: 'strikethrough',
					shortcut: ['Mod', 'Shift', 'S'],
					toggle: true,
					active: (s) => s.strike,
					run: () => onToggleMark('strike')
				},
				{
					id: 'highlight',
					label: 'Highlight',
					icon: 'highlight',
					shortcut: ['Mod', 'Shift', 'H'],
					toggle: true,
					active: (s) => s.highlight,
					run: () => onToggleMark('highlight')
				}
			]
		},
		{
			label: 'Blocks',
			controls: [
				{
					id: 'bulletList',
					label: 'Bullet list',
					icon: 'bulletList',
					shortcut: ['Mod', 'Shift', '8'],
					toggle: true,
					active: (s) => s.bulletList,
					run: () => editor?.chain().focus().toggleBulletList().run()
				},
				{
					id: 'orderedList',
					label: 'Numbered list',
					icon: 'orderedList',
					shortcut: ['Mod', 'Shift', '7'],
					toggle: true,
					active: (s) => s.orderedList,
					run: () => editor?.chain().focus().toggleOrderedList().run()
				},
				{
					id: 'blockquote',
					label: 'Blockquote',
					icon: 'blockquote',
					shortcut: ['Mod', 'Shift', 'B'],
					toggle: true,
					active: (s) => s.blockquote,
					run: () => editor?.chain().focus().toggleBlockquote().run()
				}
			]
		},
		{
			label: 'Link',
			controls: [
				{
					id: 'link',
					label: 'Link',
					icon: 'link',
					shortcut: ['Mod', 'K'],
					toggle: true,
					active: (s) => s.link,
					run: () => onRequestLink()
				}
			]
		}
	];

	/** The groups as drawn: the formatting groups, then Media (`null`). See the markup. */
	const SECTIONS: ({ label: string; controls: Control[] } | null)[] = [...GROUPS, null];

	/**
	 * Flat position of every control, which is what the roving tabindex counts in.
	 * Built once from `GROUPS` rather than tracked in the markup, so regrouping
	 * the buttons cannot quietly renumber them.
	 */
	const ORDER = new Map(
		[...GROUPS.flatMap((group) => group.controls).map((control) => control.id), 'addMedia'].map(
			(id, index) => [id, index]
		)
	);
	const ADD_MEDIA = ORDER.size - 1;
	/** Collapse all, after Add media, and only there while the entry holds media. */
	const COLLAPSE_ALL = ADD_MEDIA + 1;

	let element = $state<HTMLDivElement | null>(null);
	let focused = $state(0);

	let last = $derived(toolbar.media ? COLLAPSE_ALL : ADD_MEDIA);
	/**
	 * The one tabbable control. Clamped rather than taken from `focused` as it
	 * is: Collapse all goes away when the last media item does, and a tab stop
	 * left on a button that is no longer there would leave the toolbar with no
	 * way in by Tab at all.
	 */
	let stop = $derived(Math.min(focused, last));

	/** What Collapse all will do if pressed, which is also what it says. See the markup. */
	let collapseAction = $derived(
		toolbar.allCollapsed
			? { collapse: false, label: 'Expand all', icon: 'expandAll' as const }
			: { collapse: true, label: 'Collapse all', icon: 'collapseAll' as const }
	);

	function press(control: Control): void {
		if (control.available?.(toolbar) === false) {
			return;
		}
		control.run();
	}

	/**
	 * Moves the tab stop and the focus together, wrapping at both ends.
	 *
	 * The controls are found by their own attribute rather than as "every button
	 * in here": Add media's menu holds buttons too, and counting those would
	 * renumber the row the moment it opened.
	 */
	function moveTo(index: number): void {
		const next = index < 0 ? last : index > last ? 0 : index;
		focused = next;
		element?.querySelectorAll<HTMLButtonElement>('[data-toolbar-control]')[next]?.focus();
	}

	function onKeyDown(event: KeyboardEvent): void {
		// `ArrowRight` and `ArrowLeft` only. The row wraps to two lines on a phone,
		// which tempts an Up/Down binding — but the wrap point moves with the
		// viewport, so "down" would mean different buttons at different widths
		// while Left and Right always mean the next and previous control.
		switch (event.key) {
			case 'ArrowRight':
				moveTo(stop + 1);
				break;
			case 'ArrowLeft':
				moveTo(stop - 1);
				break;
			case 'Home':
				moveTo(0);
				break;
			case 'End':
				moveTo(last);
				break;
			default:
				return;
		}
		event.preventDefault();
	}
</script>

<!--
	Wrapping rather than a scroller or an overflow menu.

	Twelve 36px buttons do not fit the ~358px a 390px phone leaves after the
	page's gutters, so something has to give. Scrolling hides controls behind a
	gesture with nothing on screen to say they are there, and an overflow menu
	hides them behind a second press and adds a popup to maintain. Wrapping puts
	every control on screen at every width, and the only cost is one more row of
	height on the narrowest screens.

	Each group is an `inline-flex` box, so a break happens between groups and never
	through the middle of one — the three text marks stay together rather than
	leaving Highlight stranded on a line of its own.

	The toolbar itself is `inline`, not a `flex-wrap` box, and that is for the save
	status. `EntryEditor` floats the status after this element, in the same row,
	and it has to be able to sit at the end of the *last* line of buttons — on a
	phone, beside Blocks and Link on the second row. A flex container is a box: once
	its buttons wrap it is as wide as the row, and the status could only ever go
	underneath it, a whole extra row on every phone. Inline, the toolbar leaves no
	box in the way, and the float takes whatever the last line has spare. The
	status still sits outside this element, so it is neither part of the toolbar
	for a screen reader nor one of the buttons the arrow keys move between.

	Each separator lives inside the group it comes before rather than between the
	groups. Between inline boxes, any whitespace in the markup would render as a
	space, and whether there is any depends on how the formatter lays out the
	markup. With one element per group there is nothing between them to render.

	`tabindex={-1}` on the container is never a tab stop: the roving tabindex on
	the buttons is. It is written because an interactive role with no tabindex at
	all is a real mistake in almost every other case, so the a11y lint asks for
	one, and -1 is the spelling that means "reachable from script, never from
	Tab".
-->
<div
	bind:this={element}
	role="toolbar"
	aria-label="Formatting"
	aria-controls={controls}
	aria-orientation="horizontal"
	tabindex={-1}
	onkeydown={onKeyDown}
	class="inline"
>
	<!--
		One loop for every group, Media included, and not a loop followed by the
		Media group. Svelte leaves nothing between one iteration and the next, but
		markup between the end of a loop and the element after it is kept as a
		space — and between inline boxes a space is drawn. It was: 4.4px between
		Link and Media, on top of the 8px margin, which is room the 320px row does
		not have to spare. `e2e/entry-collapse.e2e.ts` measures the gaps.
	-->
	{#each SECTIONS as group, index (group?.label ?? 'Media')}
		{#if group === null}
			<!--
				Media: its own group, last, so End lands on it and the row's other
				controls keep the positions they had. Add media's keys — Down to open,
				then Up and Down inside the menu — are stopped there and never reach
				this row's handler.

				No `mr-2` on this one: the last group leaves its spare width to the
				save status, which floats into the end of the last line of buttons.
			-->
			<div
				role="group"
				aria-label="Media"
				class="my-0.5 inline-flex items-center gap-0.5 align-top"
			>
				<span
					aria-hidden="true"
					class="mr-1.5 hidden h-5 w-px bg-[#E0E0E0] sm:block dark:bg-[#3A3A3A]"
				></span>
				<AddMediaMenu
					remaining={media.remaining}
					full={media.full}
					tabbable={stop === ADD_MEDIA}
					onFocus={() => (focused = ADD_MEDIA)}
					onFiles={media.onFiles}
					recording={media.recording}
				/>
				<!--
					Collapse all, beside Add media, while the entry holds media and not
					otherwise: with nothing to collapse there is nothing for it to say.

					Two states and no pressed state. It says the action it will take —
					Collapse all, unless every item is already collapsed, when it says
					Expand all — so the first press on a mixed entry always tidies it. Its
					name changes rather than an `aria-pressed`, because a pressed
					"Collapse all" would be read as "collapse all is on", which is not a
					thing.

					At 320px it costs the pinned row a line: the buttons still fit on
					three, but the save status no longer fits after them. Accepted — see
					"The toolbar" in `docs/constraints.md`.
				-->
				{#if toolbar.media}
					<button
						type="button"
						data-toolbar-control="collapseAll"
						tabindex={stop === COLLAPSE_ALL ? 0 : -1}
						title={collapseAction.label}
						onfocus={() => (focused = COLLAPSE_ALL)}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => onCollapseAll(collapseAction.collapse)}
						class="flex h-9 w-9 items-center justify-center rounded-md text-[#424242] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#BDBDBD] dark:hover:bg-[#2C2C2C]"
					>
						<ToolbarIcon name={collapseAction.icon} />
						<span class="sr-only">{collapseAction.label}</span>
					</button>
				{/if}
			</div>
		{:else}
			<!--
				`my-0.5` on every group is the row gap: 4px between wrapped lines, as
				the old `gap-y-1` gave. `align-top` keeps each line exactly as tall as
				its buttons, where baseline alignment would add the text strut
				underneath. `mr-2` is the gap between groups.
			-->
			<div
				role="group"
				aria-label={group.label}
				class="my-0.5 mr-2 inline-flex items-center gap-0.5 align-top"
			>
				{#if index > 0}
					<!-- `mr-1.5` plus the group's own 2px gap makes 8px, matching the `mr-2` on its other side. -->
					<span
						aria-hidden="true"
						class="mr-1.5 hidden h-5 w-px bg-[#E0E0E0] sm:block dark:bg-[#3A3A3A]"
					></span>
				{/if}
				{#each group.controls as control (control.id)}
					{@const position = ORDER.get(control.id) ?? 0}
					{@const on = control.active?.(toolbar) ?? false}
					{@const usable = control.available?.(toolbar) ?? true}
					<button
						type="button"
						data-toolbar-control={control.id}
						tabindex={position === stop ? 0 : -1}
						aria-pressed={control.toggle ? on : undefined}
						aria-disabled={usable ? undefined : 'true'}
						aria-keyshortcuts={control.shortcut === undefined
							? undefined
							: shortcutAria(control.shortcut)}
						title={labelWithShortcut(control.label, control.shortcut)}
						onfocus={() => (focused = position)}
						onmousedown={(event) => event.preventDefault()}
						onclick={() => press(control)}
						class="flex h-9 w-9 items-center justify-center rounded-md text-[#424242] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:text-[#BDBDBD]
						{on
							? 'bg-[#E3F2FD] text-[#1976D2] dark:bg-[#1E3A5F] dark:text-[#90CAF9]'
							: 'hover:bg-[#F5F5F5] dark:hover:bg-[#2C2C2C]'}
						{usable ? '' : 'cursor-default opacity-40 hover:bg-transparent dark:hover:bg-transparent'}"
					>
						<ToolbarIcon name={control.icon} />
						<span class="sr-only">{control.label}</span>
					</button>
				{/each}
			</div>
		{/if}
	{/each}
</div>
