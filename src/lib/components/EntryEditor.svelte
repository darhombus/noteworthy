<script lang="ts">
	/**
	 * The entry body field: a textarea that turns into TipTap.
	 *
	 * ---------------------------------------------------------------------------
	 * WHY THERE ARE TWO INPUTS AND NOT ONE
	 * ---------------------------------------------------------------------------
	 * TipTap cannot be server-rendered — `new Editor()` reads `document` while it
	 * constructs — so on the server this field has to be something else, and the
	 * "something else" is not free to be nothing. Between the server's HTML
	 * arriving and the editor's chunk loading there is a real window, short on a
	 * local stack and not short on a phone; this app's users are already ~250ms
	 * from Frankfurt before any of that starts. An empty box during that window is
	 * a page that looks broken, and a box you can type into that then throws the
	 * typing away is worse.
	 *
	 * So the field has two halves, and which one a person sees depends only on
	 * whether the browser runs scripts at all:
	 *
	 *   With JavaScript off, the textarea that was always here: the stored text,
	 *   posting the same `body` field to the same action, which turns it into
	 *   paragraphs with `toBody()`. It is inside `<noscript>`, so a browser that
	 *   runs scripts never builds it. See NO JAVASCRIPT below.
	 *
	 *   With JavaScript on, the editor's own box from the first frame: the
	 *   toolbar row, and the body drawn as the editor is about to draw it, until
	 *   the editor arrives and takes its place. See THE WAIT below. When it is
	 *   ready, a hidden `doc` field carrying the TipTap document goes in, and the
	 *   action prefers `doc` when it is there.
	 *
	 * ---------------------------------------------------------------------------
	 * THE WAIT
	 * ---------------------------------------------------------------------------
	 * The editor used to take over from the textarea, and everything under the
	 * Entry label moved as it did: a toolbar row appeared (49px at 1280px, 89 on
	 * a phone, 129 or 169 at 320) and pushed the text down by its height, the
	 * text lost its single-spaced plain-text shape for paragraphs, headings and
	 * photos, and the buttons changed. Measured frame by frame in
	 * `docs/constraints.md`, "The editor appears in place".
	 *
	 * So, before the editor, the box is already the editor's box. The row is the
	 * real row — the same component, lit as the editor will light it — so its
	 * height follows the width, the text size and the media in the entry exactly
	 * as the editor's does, because it is the editor's. The body is the read
	 * view's renderer (`$lib/entries/render`) wearing the editor's classes, with
	 * the editor's elements and figures (`EntryBlocks`, `editing`), drawn from the
	 * document the editor will open (`$lib/entries/opening`). When TipTap is
	 * ready its element goes into the box and the drawing comes out, in the same
	 * task, so no frame has both or neither.
	 *
	 * Nothing can be typed until then, and nothing pretends it can:
	 *
	 *   the body is ordinary text, not a `contenteditable` and not a `textbox`
	 *   — a screen reader reads it as the entry's paragraphs and headings, and
	 *   is not told there is a field to type in until there is one. A tap on it
	 *   puts no caret anywhere and opens no keyboard;
	 *
	 *   the toolbar row is `inert`: it cannot be focused or pressed, and is out
	 *   of the accessibility tree, until the editor it formats exists;
	 *
	 *   every media figure is `inert` (`EntryEditMedia`), so no player starts
	 *   that would stop when its figure is replaced, and links have no `href`
	 *   (`EntryMarks`), so a tap aimed at the text does not leave the page.
	 *
	 * The text used to be typeable in the textarea during the wait, and carried
	 * across. That went with the textarea: the wait is the editor's chunk, which
	 * is now fetched ahead (`$lib/entries/editor-import`), and a box that stays
	 * still is worth more than one that can be typed into a few hundred
	 * milliseconds early and then jumps.
	 *
	 * ---------------------------------------------------------------------------
	 * NO JAVASCRIPT
	 * ---------------------------------------------------------------------------
	 * `<noscript>` rather than `@media (scripting: none)`, because every browser
	 * has always supported it, and checked in Chromium, Firefox and WebKit with
	 * scripting on and off: with it off, the fields inside are ordinary fields of
	 * the form and are submitted; with it on, the parser keeps its contents as
	 * text and builds none of it. Svelte renders `<noscript>` contents on the
	 * server only, and an empty element in the browser.
	 *
	 * The editor's half is hidden without JavaScript by a stylesheet inside a
	 * `<noscript>` of its own, which only applies when scripting is off. The same
	 * stylesheet gives the `<noscript>` elements `display: contents`, so that
	 * what is inside lays out exactly as it did before it was wrapped — the
	 * footer's buttons stay flex items with their gap. That rule must never be a
	 * class on the element: Chromium skips building a `<noscript>`'s box when
	 * scripting is on, and `display: contents` gets round that, drawing the
	 * unparsed markup inside it as text on the page. Firefox and WebKit force it
	 * to `display: none`.
	 *
	 * That leaves the page working with no JavaScript at all, which is a real
	 * outcome rather than a happy accident. The cost is one fallback branch in
	 * the action, and `toBody()` — the function that branch calls — is already
	 * written and already tested.
	 *
	 * ---------------------------------------------------------------------------
	 * MEDIA
	 * ---------------------------------------------------------------------------
	 * The Add media button, a paste and a drop all end up in the same queue, which
	 * uploads one file at a time and puts a photo into the document only once its
	 * file is stored (`$lib/entries/uploads`). Until then a placeholder stands
	 * where it will go, drawn as a decoration rather than as content, so nothing
	 * half-uploaded is ever saved. Photos already in the body are drawn from
	 * signed links kept fresh beside the document (`$lib/media/links`).
	 *
	 * Two consequences reach this component. The page is told while a file is on
	 * its way, because leaving would lose it. And the textarea — which cannot show
	 * a photo at all — goes read-only for an entry that has one, rather than
	 * quietly becoming the version that gets saved.
	 *
	 * A recording is made in a panel under the toolbar (`AudioRecorder`) and,
	 * once added, is a file like any other: into the same queue, through the same
	 * intake, as if it had been picked through *Audio file*. While one is running
	 * or waiting to be added, the page is told, for the same reason as an upload.
	 *
	 * ---------------------------------------------------------------------------
	 * DIRTY
	 * ---------------------------------------------------------------------------
	 * The baseline is read back out of the editor rather than off the loaded row.
	 * TipTap normalises on open — filling in default attributes, dropping what its
	 * schema does not know — so `JSON.stringify(data.entry.content)` and the
	 * editor's first `getJSON()` routinely differ on a document nobody has
	 * touched. Comparing against the stored JSON would report every entry as
	 * unsaved the moment it opened, and the navigation guard would start asking
	 * about losing changes that do not exist.
	 */
	import { onMount, untrack, type Snippet } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { toPlainText } from '$lib/entries/body';
	import { importEditor } from '$lib/entries/editor-import';
	import { countMedia, hasMedia, mediaPaths } from '$lib/entries/media';
	import { openingOf } from '$lib/entries/opening';
	import { PINNED_TOP_UNMEASURED, usePinnedTop } from '$lib/layout/pinned-top';
	import { TOOLBAR_KEYS, type ToolbarState, type WordMark } from '$lib/entries/toolbar';
	import { MAX_MEDIA_PER_ENTRY } from '$lib/media/limits';
	import { pageMediaLinks, provideMediaLinks, type PageMedia } from '$lib/media/page-links';
	import { meterContext } from '$lib/media/recorder';
	import {
		recordingSupport,
		RECORDING_UNAVAILABLE,
		type RecordingSupport
	} from '$lib/media/recording';
	import { remainingAllowance } from '$lib/media/upload';
	import { measureUsage } from '$lib/media/usage-measured.svelte';
	import type { Json } from '$lib/types/database';
	import AudioRecorder from './AudioRecorder.svelte';
	import EntryBlocks from './EntryBlocks.svelte';
	import EntryToolbar from './EntryToolbar.svelte';
	import LinkDialog from './LinkDialog.svelte';

	let {
		content,
		owner,
		media,
		remaining,
		labelledBy,
		describedBy,
		invalid = false,
		onReady,
		onDocChange,
		onContentDropped,
		onUploading,
		onRecording,
		saveStatus,
		typed
	}: {
		content: Json;
		/**
		 * The textarea's text as a refused no-JavaScript submit posted it, to draw
		 * again in place of the stored text. Ignored by the editor: with
		 * JavaScript there is no submit to refuse.
		 */
		typed?: string;
		/**
		 * The person writing. Their photos go in their own folder, and a document
		 * pointing anywhere else is refused by the same sanitiser the server runs —
		 * so what opens here is exactly what a save would store.
		 */
		owner: string;
		/** The signed links for the photos this body already holds, or their promise on a tap. */
		media: PageMedia;
		/** Bytes left in the allowance when the page loaded, for the Add media menu. */
		remaining: number | null;
		/** The id of the field's visible name; the editor and the no-JavaScript textarea both use it. */
		labelledBy: string;
		describedBy?: string;
		invalid?: boolean;
		/**
		 * Fires once, with the stored document as TipTap normalised it on opening.
		 *
		 * This is the baseline autosave measures against, and it has to come from
		 * the editor rather than from the row — see DIRTY above. It doubles as the
		 * signal that the editor has taken over, which is what swaps the page's
		 * no-JavaScript save button for the autosave status.
		 */
		onReady?: (doc: string) => void;
		/** Fires on every change, and once immediately after `onReady`. */
		onDocChange?: (doc: string) => void;
		/**
		 * Fires once, and only when the stored body held something this build has
		 * no extension for — a node or mark that was taken out before the editor
		 * saw it. The page has to say so: what is on screen is less than what is
		 * in the row, and saving will make that permanent. Fires again, maybe with
		 * none, when `replaceContent` opens another document.
		 */
		onContentDropped?: (types: string[]) => void;
		/**
		 * Fires whenever a file starts or stops being on its way into the entry.
		 *
		 * An upload cannot survive the page: a placeholder is not in the document,
		 * and the request dies with the tab. So the page is told, and warns on the
		 * way out exactly as it does for text that has not been saved — see
		 * `holding` in `$lib/entries/entry-autosave.svelte.ts`.
		 */
		onUploading?: (busy: boolean) => void;
		/**
		 * Fires whenever a recording starts or stops being one that leaving would
		 * lose: running, or stopped and not yet added. Once added it is an upload,
		 * and `onUploading` takes over.
		 */
		onRecording?: (holding: boolean) => void;
		/**
		 * The page's autosave status, shown at the right-hand end of the pinned
		 * toolbar row so that it stays on screen however far down somebody writes.
		 * A snippet rather than an import because the status belongs to the page:
		 * the new-entry page decides for itself when there is anything to report.
		 * Rendered only while the editor is, which is also when autosave runs.
		 *
		 * It is handed `returnFocus`, below, for its Try again button to give focus
		 * back to the text when a retry works — the page has no editor to do that
		 * with, and this has no button to know about.
		 */
		saveStatus?: Snippet<[returnFocus: () => void]>;
	} = $props();

	// Captured once, for the same reason the page captures its own baseline: this
	// is what the field holds for the life of this page, and it must not follow
	// `data` if the load re-runs underneath somebody who is typing.
	/** The no-JavaScript textarea's text. See NO JAVASCRIPT above. */
	const loadedText = untrack(() => typed ?? toPlainText(content));

	/** What the editor will open with, for the box before it arrives. See THE WAIT above. */
	const opening = untrack(() => openingOf(content, owner));

	/**
	 * The editable element's id, for the toolbar's `aria-controls`.
	 *
	 * Not `body`. That id belongs to the textarea while the textarea exists, and
	 * for one render the two overlap — TipTap builds its DOM synchronously, so the
	 * editor is in the document a moment before Svelte flushes the update that
	 * removes the textarea. Two elements briefly sharing an id is the kind of
	 * thing `aria-controls` resolves wrongly and nothing else notices.
	 */
	const EDITOR_ID = 'body-editor';

	/**
	 * How far below the pinned toolbar a caret comes to rest when ProseMirror
	 * scrolls it into view. ProseMirror's own default against a bare window edge
	 * is 5px; this is a little more, because here the edge is a bordered bar and
	 * text sitting flush against it reads as tucked underneath.
	 */
	const CARET_CLEARANCE = 8;

	let host = $state<HTMLDivElement | null>(null);
	let editor = $state<Editor | null>(null);
	let serialized = $state('');
	let baseline = $state('');
	// Lit as the editor will light it on its first transaction, so the row does not
	// change as the editor takes over. See THE WAIT above.
	let toolbar = $state<ToolbarState>(untrack(() => ({ ...opening.toolbar })));
	let linkDialog = $state<ReturnType<typeof LinkDialog> | null>(null);
	let toggleMark = $state<((name: WordMark) => void) | null>(null);
	/** Collapse all and Expand all; set once the editor exists. */
	let collapseAll = $state<((collapse: boolean) => void) | null>(null);
	/** Files picked, pasted or dropped go here; set once the editor exists. */
	let addFiles = $state<((files: File[], options?: { audio?: boolean }) => void) | null>(null);
	/** `replaceContent`, below; set once the editor exists. */
	let replace: ((content: Json) => string) | null = null;

	/**
	 * Shows `content` in place of whatever the editor holds, as if it had been
	 * opened with it: "Use the saved version" (`$lib/entries/conflict.svelte`).
	 * Every upload waiting or under way is cancelled and its placeholder goes, the
	 * undo history is forgotten, and the document is returned as the editor now
	 * holds it, for autosave's baseline. `null` until the editor exists.
	 */
	export function replaceContent(content: Json): string | null {
		return replace?.(content) ?? null;
	}
	/** How many photos, videos and recordings the document holds, for the Add media menu's cap. */
	let mediaCount = $state(untrack(() => countMedia(content)));
	/**
	 * What the menu says is left. The load's figure to begin with, and after that
	 * whatever the last upload's own check found — which is the same function the
	 * insert policy calls, so the menu and the refusals cannot disagree.
	 */
	let space = $state(untrack(() => remaining));

	/**
	 * Whether this browser can record, asked once the page is in one. Nothing is
	 * shown before then — the toolbar only renders with the editor — so the
	 * server's placeholder answer is never on screen.
	 */
	let recordable = $state<RecordingSupport>({
		ok: false,
		reason: 'unavailable',
		message: RECORDING_UNAVAILABLE
	});
	/** The open recorder, with the meter's audio context made in the click that opened it. */
	let recorder = $state<{ context: AudioContext | null } | null>(null);

	function openRecorder(): void {
		if (recorder === null) {
			recorder = { context: meterContext() };
		}
	}

	function closeRecorder(): void {
		recorder = null;
		onRecording?.(false);
		editor?.view.focus();
	}

	/**
	 * The page's signed links, kept fresh for as long as this editor is open.
	 *
	 * Created here rather than passed in because the photo views inside
	 * ProseMirror read from it directly, and because a refresh must reach them
	 * without going through the document — `$lib/media/links` explains. On a tap
	 * `media` is a promise that lands after the text, and the body's paths are
	 * what it will bring (A BATCH STILL ON ITS WAY there): a link arriving is a
	 * new `src` in a view, never a transaction, so it is nothing to autosave.
	 */
	const links = pageMediaLinks(
		untrack(() => media),
		untrack(() => mediaPaths(content))
	);
	// For the photos in the box before the editor arrives (`EntryEditMedia`), which
	// show the same links the editor's own views are about to.
	provideMediaLinks(links);

	/**
	 * Whether the body as stored holds photos, which decides what the textarea
	 * does. Read from the loaded content once, like everything else here.
	 *
	 * The textarea is text and nothing else, so a save made from it would drop
	 * every photo in the entry — silently, and for good once the cleanup job
	 * removed the files. With no JavaScript, or before the editor's chunk lands,
	 * such an entry therefore shows its text read-only, and says why. The server
	 * keeps the same rule from its own side (`submittedBody`), for a submit that
	 * arrives anyway.
	 */
	const storedMedia = untrack(() => hasMedia(content));
	/** The pinned toolbar's height, border included. See STICKY TOOLBAR below. */
	let toolbarHeight = $state(0);

	/**
	 * What the app shell has pinned above this editor: the breadcrumb bar's height
	 * at `lg` and up, 0 below. The toolbar row sticks at this offset, and a caret
	 * has to clear it and the row together. Reactive, so both follow the bar.
	 */
	const pinnedAbove = usePinnedTop();

	/** How much of the top of the window is covered when the row is pinned. */
	let covered = $derived(pinnedAbove.height + toolbarHeight);

	let ready = $derived(editor !== null);

	// Reported upwards rather than bound. What the document currently is, is
	// something only this component knows — the page cannot read it off `data`,
	// because TipTap normalises on open and because anything typed into the
	// textarea before the editor arrived has been adopted since.
	$effect(() => {
		if (ready) {
			onDocChange?.(serialized);
		}
	});

	onMount(() => {
		let discarded = false;
		let created: Editor | null = null;
		let uploads: { destroy: () => void } | null = null;

		recordable = recordingSupport({
			secure: window.isSecureContext,
			microphone: typeof navigator.mediaDevices?.getUserMedia === 'function',
			recorder: typeof MediaRecorder !== 'undefined',
			isTypeSupported: (type) => MediaRecorder.isTypeSupported(type)
		});

		// The dynamic import is the whole of the SSR answer. `onMount` does not run
		// on the server, and an `import()` that never executes is never evaluated —
		// so TipTap and ProseMirror are not in the server's module graph, and not in
		// the bundle any other route loads either. It is usually under way already,
		// from the tap that led here or an idle moment before it
		// (`$lib/entries/editor-import`), and then this finds it.
		void (async () => {
			const {
				createEntryEditor,
				forEditor,
				readToolbarState,
				replaceDocument,
				setAllMediaCollapsed,
				toggleMarkAcrossWord
			} = await importEditor();

			// Guard both the teardown and the element: the chunk is network work, and
			// the component can be gone by the time it lands.
			if (discarded || host === null) {
				return;
			}

			/**
			 * Copies the new state field by field instead of replacing the object.
			 *
			 * This runs on every transaction, which means every keystroke. `$state`
			 * is a deep proxy, so assigning only the properties that actually
			 * changed wakes only the buttons that actually changed — where
			 * `toolbar = readToolbarState(...)` would invalidate all twelve on every
			 * character typed, for a row of buttons that is identical nearly every
			 * time.
			 */
			const syncToolbar = (ed: Editor): void => {
				const next = readToolbarState(ed);
				for (const key of TOOLBAR_KEYS) {
					if (toolbar[key] !== next[key]) {
						toolbar[key] = next[key];
					}
				}
			};

			// Stripped before the editor is built, not after. `forEditor` explains
			// why TipTap cannot be left to do this itself.
			const opened = forEditor(content, owner);
			if (opened.dropped.length > 0) {
				onContentDropped?.(opened.dropped);
			}

			const handle = createEntryEditor({
				element: host,
				elementId: EDITOR_ID,
				content: opened.content,
				labelledBy,
				owner,
				links,
				onUpdate: (doc) => {
					serialized = JSON.stringify(doc);
					mediaCount = countMedia(doc as Json);
				},
				// `transaction` rather than `update`: moving the cursor into bold text
				// changes no content and must still light the Bold button, and `update`
				// only fires when the document itself changed.
				onTransaction: syncToolbar,
				onRequestLink: requestLink,
				onUploadsBusy: (busy) => {
					onUploading?.(busy);
					// The queue has drained, so the sidebar's figure is out of date by
					// whatever was stored. Once per batch, not per file, and measured
					// with a plain request rather than `invalidate`: a refresh whose data
					// request fails makes SvelteKit load the address as a new document,
					// which offline is the browser's error page (see
					// `$lib/media/usage-measured.svelte`).
					if (!busy) {
						void measureUsage(remainingAllowance);
					}
				},
				onRemaining: (bytes) => (space = bytes)
			});
			created = handle.editor;
			uploads = handle.uploads;
			addFiles = (files, intakeOptions) => {
				handle.uploads.add(files, undefined, intakeOptions);
				// Back to the text: the picker took focus with it, and the caret is
				// where the photo is going.
				handle.editor.view.focus();
			};

			baseline = JSON.stringify(created.getJSON());
			onReady?.(baseline);

			// Held so the toolbar can reach the command without importing the module
			// it lives in — see `onToggleMark` on `EntryToolbar`.
			toggleMark = (name) => toggleMarkAcrossWord(created as Editor, name);
			collapseAll = (collapse) => setAllMediaCollapsed((created as Editor).view, collapse);
			replace = (replacement) => {
				const current = created as Editor;
				// First, so nothing lands in the document being put on screen.
				handle.uploads.cancel();
				const reopened = forEditor(replacement, owner);
				onContentDropped?.(reopened.dropped);
				replaceDocument(current, reopened.content);
				const json = current.getJSON();
				serialized = JSON.stringify(json);
				mediaCount = countMedia(json as Json);
				syncToolbar(current);
				return serialized;
			};

			serialized = JSON.stringify(created.getJSON());
			syncToolbar(created);
			// Last, because this is what takes the drawing of the body out of the box
			// (THE WAIT), in the same task as TipTap put its element in, and what lets
			// the `$effect` above start reporting the document.
			editor = created;
		})();

		return () => {
			discarded = true;
			uploads?.destroy();
			created?.destroy();
		};
	});

	/**
	 * Opening the link dialog, from the toolbar button or from Mod-K.
	 *
	 * The href under the cursor is read here rather than passed in, because the
	 * two callers know different amounts: the shortcut knows only that it fired,
	 * and the button knows only that it was pressed. Both mean "edit whatever link
	 * this is, or make one".
	 */
	function requestLink(): void {
		const current = editor;
		if (current === null) {
			return;
		}
		const href: unknown = current.getAttributes('link').href;
		linkDialog?.open(typeof href === 'string' && href.length > 0 ? href : null);
	}

	/**
	 * Applies a href, with three cases rather than one.
	 *
	 * `extendMarkRange('link')` is what makes editing an existing link work from a
	 * bare cursor: without it, a caret sitting in the middle of a link has an empty
	 * selection and `setLink` would apply the new href to nothing at all, leaving
	 * the old one untouched and the dialog looking like it had done its job.
	 *
	 * With nothing selected and no link under the cursor there is no text to mark,
	 * so the URL is inserted as its own linked text. The alternative was refusing —
	 * a disabled button, or a dialog that opens and then declines — and "paste a
	 * link on its own line" is far too ordinary a thing to want.
	 */
	function applyLink(href: string): void {
		const current = editor;
		if (current === null) {
			return;
		}

		if (current.state.selection.empty && !current.isActive('link')) {
			// Two chains, and the position read between them. The text has to exist
			// before there is a range to mark, so inserting and marking cannot be one
			// chain — `setLink` in the same chain would apply to the empty selection
			// that was there when the chain was built.
			const at = current.state.selection.from;
			current.chain().focus().insertContent({ type: 'text', text: href }).run();
			current
				.chain()
				.focus()
				.setTextSelection({ from: at, to: at + href.length })
				.setLink({ href })
				// Collapsed to *after* the link, and this is not tidiness. Leaving the
				// range selected leaves the new link text selected, so the very next
				// character typed replaces the link that was just made — which looks
				// like the editor having refused to add one. The selected case below
				// keeps its selection, because there the person chose those words.
				.setTextSelection(at + href.length)
				// And then the link is taken off the stored marks, because collapsing
				// is not enough on its own: TipTap's link mark reports
				// `inclusive() { return this.options.autolink }`, and autolink is on —
				// so a cursor sitting at the end of a link is *inside* it as far as
				// typing is concerned. Without this, the next word joins the link text
				// while the href stays as it was, and a sentence quietly becomes part
				// of a URL it does not match.
				//
				// Safe at an empty selection: `unsetMark` removes the mark over the
				// selected ranges, which here is the zero-width range at the cursor, so
				// the link just made is untouched and only the stored mark goes.
				.unsetMark('link')
				.run();
			return;
		}

		current.chain().focus().extendMarkRange('link').setLink({ href }).run();
	}

	function removeLink(): void {
		editor?.chain().focus().extendMarkRange('link').unsetLink().run();
	}

	// `aria-invalid` and `aria-describedby` arrive after the editor exists — the
	// error element they refer to only appears once a submit has been rejected —
	// so they are applied through `setOptions` rather than frozen in at creation.
	// Going around TipTap and setting them on `view.dom` by hand would work until
	// the next time ProseMirror re-applied its own `attributes` prop over the top.
	//
	// The scroll props travel in the same call, and not only for tidiness:
	// `setOptions` replaces TipTap's `editorProps` whole, so a second effect
	// setting them separately would leave TipTap holding half of what the view
	// was given.
	//
	// The toolbar row is drawn before the editor exists (THE WAIT), so
	// `bind:offsetHeight` has usually measured it by the time this first runs;
	// if not, this runs again with the real number, before anybody can type.
	//
	// What the caret has to clear is `covered`: the toolbar row plus whatever the
	// shell pins above it, which at `lg` and up is the breadcrumb bar. Both
	// heights are measured and both are reactive, so a change to either — the
	// row growing with a failure, the trail wrapping, the window crossing `lg` —
	// re-runs this with the new sum.
	//
	// ---------------------------------------------------------------------------
	// WHEN THE ROW GROWS UNDER THE CARET
	// ---------------------------------------------------------------------------
	// The scroll props only act when ProseMirror scrolls, and it scrolls on an
	// edit or a caret move — not when the pinned row gets taller by itself, which
	// it does when a failed save puts its message on a line of its own. The row
	// is in the flow, so it pushes the text down; the browser's scroll anchoring
	// then scrolls the page to hold that text still, and the net effect is the
	// row reaching down over the lines under it. A caret on one of those lines
	// is covered until the next keystroke.
	//
	// So when the row grows, the caret is scrolled clear here, by ProseMirror's
	// own `scrollIntoView` with the props just set — the same spacing as any
	// other scroll, and nothing if the caret is already clear. Two conditions,
	// both about not moving a page somebody is doing something else with:
	//
	//   the editor has focus — with it elsewhere there is no caret on screen,
	//   and scrolling to where it would be is not "keeping it clear";
	//
	//   the caret is on screen — somebody who has scrolled away to read is left
	//   where they are. Under the row counts as on screen; that is the case
	//   this is for.
	//
	// It dispatches a transaction with no steps, so nothing is edited and
	// autosave sees no change, and it never calls `focus()`.
	//
	// Only on growth, and not the first measurement: a shrinking row uncovers
	// lines rather than covering them, and the first height is the toolbar
	// appearing, not the row growing over anything. Growth of the pinned area as
	// a whole, so the breadcrumb bar getting taller counts as well.
	let appliedCover = 0;

	// ---------------------------------------------------------------------------
	// HOLDING THE LINE WHEN COLLAPSE ALL COMES AND GOES
	// ---------------------------------------------------------------------------
	// Collapse all appears with the first media item and goes with the last, and
	// at 320px that is a line of the pinned row (the save status no longer fits
	// after the buttons; `docs/constraints.md`, "The toolbar"). The row is in the
	// flow, so the text under it moves by that line. Chromium and Firefox put it
	// back with their scroll anchoring; Safari has none, and the line being
	// typed jumped 40px.
	//
	// So the caret's line is read just before the toolbar redraws for the
	// change — a pre-effect, after ProseMirror has drawn the item that caused it
	// and before Svelte adds or removes the button — and put back in the effect
	// above once the new height is measured. Where the browser has already
	// anchored, the line has not moved and nothing is scrolled. Only while the
	// caret is on screen; and a reading nothing used is forgotten two frames
	// later, since at most widths the row does not change height at all.
	let heldLine: number | null = null;

	$effect.pre(() => {
		const current = editor;
		// Read to be tracked: this runs when the button comes or goes.
		void toolbar.media;
		if (current === null) {
			return;
		}
		untrack(() => {
			if (!caretOnScreen(current)) {
				heldLine = null;
				return;
			}
			const read = current.view.coordsAtPos(current.state.selection.head).top;
			heldLine = read;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => {
					if (heldLine === read) {
						heldLine = null;
					}
				})
			);
		});
	});

	$effect(() => {
		const current = editor;
		if (current === null) {
			return;
		}

		current.setOptions({
			editorProps: {
				attributes: {
					id: EDITOR_ID,
					role: 'textbox',
					'aria-multiline': 'true',
					'aria-labelledby': labelledBy,
					...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
					...(invalid ? { 'aria-invalid': 'true' } : {}),
					class: 'entry-prose entry-edit prose max-w-none focus:outline-none'
				},
				// Every side spelled out: ProseMirror reads an object prop per side and
				// does no defaulting, so a missing `bottom` is `undefined`, compares as
				// NaN and silently stops the bottom edge scrolling at all. The three
				// sides the toolbar does not cover keep ProseMirror's own defaults.
				scrollThreshold: { top: covered, right: 0, bottom: 0, left: 0 },
				scrollMargin: { top: covered + CARET_CLEARANCE, right: 5, bottom: 5, left: 5 }
			}
		});

		// See HOLDING THE LINE below: put the caret's line back where it was before
		// the row changed height under it, if the browser has not already.
		const line = heldLine;
		heldLine = null;
		if (line !== null) {
			untrack(() => {
				const now = current.view.coordsAtPos(current.state.selection.head).top;
				if (Math.abs(now - line) >= 0.5) {
					window.scrollBy({ top: now - line, behavior: 'instant' });
				}
			});
		}

		const grew = appliedCover > 0 && covered > appliedCover;
		// Held at 0 until the toolbar has been measured, so that its first height
		// arriving is not taken for growth.
		appliedCover = toolbarHeight > 0 ? covered : 0;
		if (grew && current.view.hasFocus() && caretOnScreen(current)) {
			// Untracked: the transaction runs `syncToolbar`, which reads the toolbar
			// state, and read here that would make this effect re-run — and call
			// `setOptions` again — on every change to a button's pressed state.
			untrack(() => current.commands.scrollIntoView());
		}
	});

	/**
	 * Focus back into the text, with the caret where it was.
	 *
	 * For the save status's Try again button, which is about to disappear with
	 * focus on it (see `SaveStatus`). "Where it was" is ProseMirror's own
	 * selection: tabbing out to the button leaves it untouched, nothing can edit
	 * the document while focus is on the button, and `view.focus()` writes that
	 * selection back into the page as it focuses.
	 *
	 * `view.focus()` rather than TipTap's `focus` command. The command defers the
	 * focus to the next animation frame, by which time the button has gone and
	 * focus has already fallen to the page body; this runs before the button is
	 * removed, so focus goes straight from one to the other. It also focuses with
	 * `preventScroll`, so the page does not jump to the top of the editor as a
	 * plain `focus()` on an element this tall can.
	 *
	 * The only scroll is the caret spacing everything else uses, and only if the
	 * caret is on screen — the same rule as the row growing. A caret somebody
	 * scrolled away from stays scrolled away from until they type, when
	 * ProseMirror brings it back as it always has.
	 */
	function returnFocus(): void {
		const current = editor;
		if (current === null) {
			return;
		}
		// Untracked, as with the row growing: the transaction runs `syncToolbar`,
		// and this is called from inside another component's effect.
		untrack(() => {
			current.view.focus();
			if (caretOnScreen(current)) {
				current.commands.scrollIntoView();
			}
		});
	}

	/** Whether any of the caret is inside the window, including under the pinned row. */
	function caretOnScreen(current: Editor): boolean {
		const caret = current.view.coordsAtPos(current.state.selection.head);
		const height = window.visualViewport?.height ?? window.innerHeight;
		return caret.bottom > 0 && caret.top < height;
	}
</script>

<!--
	The no-JavaScript half, and the stylesheet that hides the other half when
	scripting is off. See NO JAVASCRIPT above: `data-no-js` is given
	`display: contents` by that stylesheet only, never by a class.

	`<noscript>` contents are never hydrated (Svelte renders them on the server
	only), so `value` here is safe — it is not the hydrated-input trap in
	"Inputs written by an expression".
-->
<noscript
	><style>
		[data-needs-js] {
			display: none !important;
		}
		[data-no-js] {
			display: contents;
		}
	</style></noscript
>
<noscript data-no-js>
	<!--
		Read-only when the entry holds photos: this box cannot show them, so
		anything saved from it would be an entry with its photos deleted. The note
		below says so, and `aria-describedby` points at it — the field is otherwise
		one somebody would sit and type into before noticing nothing happens.
		Read-only rather than disabled, because a disabled field is not submitted
		at all and the server checks this text against what is stored.

		The read-only grey is one class or the other, never both with `bg-white`:
		two background utilities on one element are settled by their order in the
		built stylesheet, not in this attribute, and `bg-white` came later — so the
		grey never showed. `block`, because a textarea is inline-block, and the
		line it sat on added a gap under it: 6px in Chromium, 5.5 in WebKit, 1.5
		in Firefox. `entry-textarea` is the body's family, size and line height,
		which follow the journal's font and size (`layout.css`, ENTRY FONTS).
	-->
	<textarea
		id="body"
		name="body"
		rows="16"
		required
		readonly={storedMedia}
		value={loadedText}
		aria-labelledby={labelledBy}
		aria-invalid={invalid ? 'true' : undefined}
		aria-describedby={[describedBy, storedMedia ? 'body-has-media' : undefined]
			.filter((id) => id !== undefined)
			.join(' ') || undefined}
		class="entry-textarea mt-1 block w-full rounded-lg border border-[#E0E0E0] px-4 py-3 text-[#212121] focus:border-[#BDBDBD] focus:ring-0 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:focus:border-[#616161] {storedMedia
			? 'bg-[#FAFAFA] dark:bg-[#1E1E1E]'
			: 'bg-white dark:bg-[#121212]'}"></textarea>
	{#if storedMedia}
		<p id="body-has-media" class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			This entry has photos, video or audio. The plain text box can’t show them, so its text stays
			as it is until the editor loads — with JavaScript on. The title and date can still be saved.
		</p>
	{/if}
</noscript>

<!--
	The editor's box, drawn from the first frame (THE WAIT above), and hidden
	without JavaScript (`data-needs-js`). Always in the DOM, because `bind:this`
	is how the editor is given somewhere to mount and a node inside an `{#if}`
	does not exist yet when `onMount` runs.

	The toolbar sits inside the box rather than above it, so that the border and
	its focus state belong to one field instead of drawing a line between the
	controls and the thing they control. `focus-within` therefore also applies
	when a toolbar button has focus, which is correct: the field is where the
	person is.

	The focus state is a slightly stronger grey border and nothing else. It was a
	blue border with a blue ring, which is right for a field somebody fills in and
	leaves, and wrong for one they sit in for twenty minutes: a coloured frame
	around the whole of a long entry, the whole time, pulls the eye off the words.
	The grey still says which field has focus without competing with them. The
	no-JavaScript textarea above matches. Its `focus:ring-0` is needed, not tidiness:
	`@tailwindcss/forms` gives every textarea a blue ring and border of its own on
	focus, and taking the old blue classes off without it would have brought that
	back. The contenteditable is not something that plugin styles, and its own
	browser outline is switched off by `focus:outline-none` in `editorProps`.
-->
<div
	data-needs-js
	class="mt-1 rounded-lg border border-[#E0E0E0] bg-white focus-within:border-[#BDBDBD] dark:border-[#3A3A3A] dark:bg-[#121212] dark:focus-within:border-[#616161]"
>
	<!--
			STICKY TOOLBAR

			Pinned to the top of the window while the box is on screen, so a long
			entry can be formatted without scrolling back up to the controls. `sticky`
			rather than anything measured from scroll events: the browser keeps it in
			place, and because the box is its containing block it lets go by itself
			when the box's bottom edge reaches it, leaving with the editor rather
			than hanging over whatever comes after.

			`top` is whatever the shell has pinned above it (`pinnedAbove`): the
			breadcrumb bar's height at `lg` and up, where the bar sticks, and 0 below,
			where it scrolls away with the page. A style rather than a class because
			it is a measured number and follows the bar — except in the server's
			HTML and the frames before the layout has measured anything, where it
			is a class with the bar's one-line height (`PINNED_TOP_UNMEASURED`), so
			a reload that comes back scrolled past the row does not pin it under the
			bar first. The app's header is not
			involved: it is a normal-flow bar below `lg`, and at `lg` the sticky
			sidebar beside this column, not over it. No ancestor between here and
			the root sets `overflow`, which is what would otherwise make the nearest
			one, rather than the window, the thing this sticks inside.

			`z-10` because ProseMirror's element is `position: relative` (TipTap's
			injected CSS), and a positioned element later in the document paints over
			an earlier one at the same level — the text would scroll across the
			buttons instead of under them. The solid background, the same colour as
			the box, is what the text then scrolls behind; the toolbar's own
			`border-b` is the edge it scrolls under.

			`rounded-t-lg` because this sits inside the box's rounded border with no
			`overflow: hidden` to clip it, so square corners would paint over the
			inside of the border's curve.

			The row holds the toolbar and, after it, the page's save status. The
			border and padding are on the row rather than on the toolbar, so the edge
			the text scrolls under runs the full width whichever of the two is
			taller. The status is floated right: it sits at the end of the last line
			of buttons when it fits there, and drops to a line of its own below the
			buttons when it does not. Measured with "Saved", it fits at every width
			from 320px to 1280px except about 528–590px, where the buttons have only
			just come onto one line and leave no room. A failure and its Try again
			button drop at every width, which is the row growing on purpose.
			`flow-root` is what makes the row grow to hold it when it drops.
			`EntryToolbar` explains why the toolbar has to be `inline` for that to work.

			The status is a sibling of the toolbar and not inside it. Tab reaches its
			Try again button after the toolbar's one stop and before the text, and
			the arrow keys never do, because they only move between the toolbar's own
			buttons. `empty:hidden` is for the new-entry page before there is
			anything to report: the snippet renders nothing, and an empty float with
			a margin could still be pushed onto a line of its own at a width where
			the buttons fill the last line exactly. Svelte's block markers are
			comment nodes, which `:empty` ignores.

			The height is measured, not assumed, because it is not one number: one
			row of buttons at desktop widths, two on a 390px phone, three at 360px,
			more of each under a larger text size (the buttons are sized in rem), and
			more again whenever a failure takes a line of its own. `bind:offsetHeight`
			is a ResizeObserver on this row plus one reading on mount, so it follows
			every one of those changes, not only the first. It feeds ProseMirror's
			scroll props above, which is what keeps the caret out from underneath.

			Drawn before the editor exists, `inert` until it does: see THE WAIT
			above. It is the same element throughout, so nothing in it is redrawn
			as the editor takes over except that it comes alive.
		-->
	<div
		bind:offsetHeight={toolbarHeight}
		data-pinned-row
		style:top={pinnedAbove.measured ? `${pinnedAbove.height}px` : undefined}
		inert={!ready}
		class="sticky z-10 flow-root rounded-t-lg border-b border-[#E0E0E0] bg-white px-2 py-1 dark:border-[#3A3A3A] dark:bg-[#121212] {pinnedAbove.measured
			? ''
			: PINNED_TOP_UNMEASURED}"
	>
		<EntryToolbar
			{editor}
			{toolbar}
			controls={EDITOR_ID}
			media={{
				remaining: space,
				full: mediaCount >= MAX_MEDIA_PER_ENTRY,
				onFiles: (files, intakeOptions) => addFiles?.(files, intakeOptions),
				recording: {
					support: recordable,
					open: recorder !== null,
					onRecord: openRecorder
				}
			}}
			onRequestLink={requestLink}
			onToggleMark={(name) => toggleMark?.(name)}
			onCollapseAll={(collapse) => collapseAll?.(collapse)}
		/>
		{#if saveStatus}
			<div class="float-right my-0.5 ml-2 empty:hidden">{@render saveStatus(returnFocus)}</div>
		{/if}
		<!--
				In the pinned row, after the toolbar and the save status: on screen
				however far down somebody writes while recording, and in Tab order
				after the toolbar's one stop and before the text. The row's measured
				height includes it, so the caret keeps clear of it too.
			-->
		{#if recorder !== null && recordable.ok}
			<AudioRecorder
				format={recordable}
				remaining={space}
				context={recorder.context}
				onAdd={(file) => addFiles?.([file], { audio: true })}
				onClose={closeRecorder}
				onHolding={(holding) => onRecording?.(holding)}
			/>
		{/if}
	</div>
	<div class="px-4 py-3">
		{#if !ready}
			<!--
				The body as the editor is about to draw it: the editor's classes on the
				element that stands in for ProseMirror's, and `entry-waiting` for the
				rules TipTap injects only once it runs (`layout.css`). Ordinary text —
				see THE WAIT above for why it is not a field.
			-->
			<div class="entry-prose entry-edit entry-waiting prose max-w-none">
				<EntryBlocks blocks={opening.blocks} editing selected={opening.selected} />
			</div>
		{/if}
		<div bind:this={host}></div>
	</div>
</div>

{#if ready}
	<input type="hidden" name="doc" value={serialized} />

	<!--
		Rendered alongside the editor rather than always, because a dialog for
		formatting an editor that is not there has nothing to open onto — and its
		`open()` is reached through `bind:this`, so it has to exist before the
		toolbar can call it. Both are true at the same moment.
	-->
	<LinkDialog
		bind:this={linkDialog}
		onApply={applyLink}
		onRemove={removeLink}
		onClose={(untouched) => {
			// At once, not through `commands.focus()`, which waits a frame and would
			// take focus back from wherever it went meanwhile (LinkDialog, FOCUS ON
			// CLOSING).
			if (untouched) {
				editor?.view.focus();
			}
		}}
	/>
{/if}
