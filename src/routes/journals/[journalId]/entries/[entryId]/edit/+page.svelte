<script lang="ts">
	/**
	 * Editing an entry. It saves itself.
	 *
	 * ---------------------------------------------------------------------------
	 * WHAT REPLACED THE SAVE BUTTON AND THE WARNING
	 * ---------------------------------------------------------------------------
	 * There used to be a Save button, and a `confirm()` on the way out asking
	 * whether to throw away unsaved changes. Both are gone, because the thing they
	 * protected against is gone: a pause in typing writes the entry, and there is
	 * normally nothing unsaved to lose.
	 *
	 * "Normally" is doing work in that sentence, which is why the guards are not
	 * gone so much as narrowed. A save can be waiting on its debounce, open on the
	 * network, or failed — and in all three cases there is still something a
	 * person would mind losing. The guards fire only then: links and the back
	 * button flush the save and go, a failed save asks first, and closing the tab
	 * warns. They live in `$lib/entries/entry-autosave.svelte.ts`, with the
	 * request and the controller's lifetime, because the new-entry page autosaves
	 * too and must leave exactly the way this one does.
	 *
	 * ---------------------------------------------------------------------------
	 * THE FORM IS STILL A FORM
	 * ---------------------------------------------------------------------------
	 * Autosave needs JavaScript. The field underneath it does not: with no
	 * JavaScript the body is a textarea, and this page is still a `<form>` posting
	 * to the action next door, Save button and all. The two halves are switched
	 * by whether the browser runs scripts, not by whether the editor has arrived:
	 * the textarea and the Cancel and Save buttons are inside `<noscript>`, and
	 * with JavaScript on the page is the editor's from the first frame — its box
	 * (`EntryEditor`, THE WAIT) and its Done — so nothing changes as it arrives.
	 */
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import ConflictDialog from '$lib/components/ConflictDialog.svelte';
	import EntryEditor from '$lib/components/EntryEditor.svelte';
	import FontPreloads from '$lib/components/FontPreloads.svelte';
	import SaveStatus from '$lib/components/SaveStatus.svelte';
	import { entryConflict, type EntryDraft } from '$lib/entries/conflict.svelte';
	import { entryAutosave } from '$lib/entries/entry-autosave.svelte';
	import { createSaveTracker } from '$lib/entries/revision';
	import { draftSender } from '$lib/entries/send-draft';
	import { unknownTypes } from '$lib/entries/opening';
	import { entryType } from '$lib/journals/fonts';
	import { RECORDING_NOT_ADDED } from '$lib/media/recording';
	import { liveCrumbLabel } from '$lib/nav/crumb-labels.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The entry as it was loaded, captured once. `untrack` says that deliberately:
	// a load re-running underneath somebody who is typing must not move the value
	// out from under them.
	const loaded = untrack(() => ({
		title: data.entry.title ?? '',
		entryDate: data.entry.entry_date
	}));

	type Draft = EntryDraft;

	const UPLOADING =
		'A file is still being added to this entry. Leaving now would lose it — the entry itself is saved. Leave anyway?';

	// What a refused no-JavaScript submit posted, when there was one, so that
	// drawing the page again does not throw away what was typed. Only ever set
	// without JavaScript: with it there is no submit to refuse.
	const echoed = untrack(() => form?.values ?? null);

	let title = $state(echoed?.title ?? loaded.title);
	let entryDate = $state(echoed?.entryDate ?? loaded.entryDate);
	let doc = $state<string | null>(null);

	/**
	 * Node and mark types the stored body held that this build cannot show.
	 *
	 * Normally empty. When it is not, what is on screen is less than what is in
	 * the row — and because the editor saves itself, the next keystroke makes the
	 * shorter version the real one. That has to be said out loud before it
	 * happens, not discovered afterwards.
	 *
	 * Known before the editor reports it (`$lib/entries/opening`), so the notice
	 * is above the form from the first frame instead of pushing the whole form
	 * down when the editor arrives.
	 */
	let dropped = $state<string[]>(untrack(() => unknownTypes(data.entry.content)));

	let saveUrl = $derived(
		resolve('/journals/[journalId]/entries/[entryId]/autosave', {
			journalId: data.journal.journal_id,
			entryId: data.entry.entry_id
		})
	);

	/** True while a file is on its way in: leaving would lose it. */
	let uploading = $state(false);

	/** True while a recording is running, or stopped and not yet added: leaving would lose it. */
	let recording = $state(false);

	let editor = $state<ReturnType<typeof EntryEditor> | null>(null);

	// The revision this page's text is made from, from the load onwards, and
	// every save's answer after it (`$lib/entries/send-draft`).
	const tracker = createSaveTracker(untrack(() => data.entry.revision));

	// Learning that the entry changed somewhere else, and the modal's two
	// choices (`$lib/entries/conflict.svelte`).
	const conflict = entryConflict({
		entryId: untrack(() => data.entry.entry_id),
		url: () => saveUrl,
		tracker,
		autosave: () => autosave,
		sender: () => sender,
		away: () => resolve('/journals/[journalId]', { journalId: data.journal.journal_id }),
		apply: (text) => {
			const body = editor?.replaceContent(text.content) ?? null;
			if (body === null) {
				return null;
			}
			title = text.title;
			entryDate = text.entryDate;
			return { title, entryDate, doc: body };
		}
	});

	const sender = draftSender(tracker, () => saveUrl, conflict.hooks);

	// The request, the controller, and the guards on the way out — see the note
	// in `entry-autosave.svelte.ts` for what leaving does and why.
	const autosave = entryAutosave<Draft>((draft) => sender.send(draft), {
		holding: () => (uploading ? UPLOADING : recording ? RECORDING_NOT_ADDED : null)
	});

	// One effect over all three fields, so a change to any of them is a change to
	// the entry. Guarded on `doc`, because until the editor has reported its
	// document there is no complete draft to save and nothing to compare against.
	$effect(() => {
		const body = doc;
		if (body === null) {
			return;
		}
		autosave.change({ title, entryDate, doc: body });
	});

	let editHref = $derived(
		resolve('/journals/[journalId]/entries/[entryId]/edit', {
			journalId: data.journal.journal_id,
			entryId: data.entry.entry_id
		})
	);

	let readHref = $derived(
		resolve('/journals/[journalId]/entries/[entryId]', {
			journalId: data.journal.journal_id,
			entryId: data.entry.entry_id
		})
	);

	// The title as typed, as the server will store it (trimmed, empty is no
	// title): on the entry's crumb and the tab (`$lib/nav/crumb-labels.svelte`).
	let shownTitle = $derived(title.trim() === '' ? 'Untitled' : title.trim());
	liveCrumbLabel(
		() => readHref,
		() => shownTitle
	);
</script>

<svelte:head>
	<title>Editing {shownTitle} · Noteworthy</title>
</svelte:head>

<FontPreloads files={data.fontFiles} />

<main>
	<div class="mx-auto max-w-3xl px-4 py-10 sm:px-6">
		<!--
			The save status is not up here with the heading: it is at the end of the
			editor's pinned toolbar row, passed in below as `saveStatus`.

			It has moved twice, for the same reason both times. It started at the
			bottom of the form, where "Unsaved changes" used to be, and the editor is
			sixteen rows tall, so on a 900px screen that was below the fold before
			anybody typed a word. It moved up beside this heading, and that held until
			the toolbar started staying on screen through a long entry: then the
			heading was the thing that scrolled away, and the status went with it.
			A failure nobody can see is a silent failure, which is the one thing
			autosave must not produce, so the status now goes where somebody writing
			is always looking.
		-->
		<h1 class="text-2xl font-semibold text-[#212121] dark:text-[#F5F5F5]">Edit entry</h1>
		<p class="mt-1 text-sm text-[#616161] dark:text-[#9E9E9E]">
			In {data.journal.title}
		</p>

		{#if dropped.length > 0}
			<p
				role="alert"
				class="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
			>
				Part of this entry could not be opened and has been left out of the editor ({dropped.join(
					', '
				)}). It is still stored, but editing this entry will replace what is stored with what you
				see here.
			</p>
		{/if}

		{#if form?.stale}
			<!-- The modal's two choices, without JavaScript: the form below holds the
			     entry's current revision, and the link draws the saved version. -->
			<p
				role="alert"
				class="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				This entry changed somewhere else. Save again to keep your version, or
				<a href={editHref} class="font-medium underline">open the saved version</a>.
			</p>
		{:else if form?.errors.form}
			<p
				role="alert"
				class="mt-6 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
			>
				{form.errors.form}
			</p>
		{/if}

		<!-- The journal's font and size, for the title field and the body alone (`layout.css`, ENTRY FONTS). -->
		<form method="POST" use:enhance class="mt-6 space-y-5" {...entryType(data.journal)}>
			<div>
				<label for="title" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Title <span class="font-normal text-[#616161] dark:text-[#9E9E9E]">(optional)</span>
				</label>
				<!-- `data-editor-shortcuts`: Ctrl/Cmd+K here does not open search (`$lib/search/shortcut`). -->
				<input
					id="title"
					name="title"
					type="text"
					maxlength="200"
					data-editor-shortcuts
					bind:value={title}
					aria-invalid={form?.errors.title ? 'true' : undefined}
					aria-describedby={form?.errors.title ? 'title-error' : undefined}
					class="entry-title-field mt-1 w-full rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				{#if form?.errors.title}
					<p id="title-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.title}
					</p>
				{/if}
			</div>

			<div>
				<label for="entryDate" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Date
				</label>
				<input
					id="entryDate"
					name="entryDate"
					type="date"
					required
					bind:value={entryDate}
					aria-invalid={form?.errors.entryDate ? 'true' : undefined}
					aria-describedby={form?.errors.entryDate ? 'entryDate-error' : undefined}
					class="mt-1 rounded-lg border border-[#E0E0E0] bg-white px-3 py-2 text-[#212121] focus:border-[#1976D2] focus:ring-2 focus:ring-[#1976D2]/30 dark:border-[#3A3A3A] dark:bg-[#121212] dark:text-[#F5F5F5]"
				/>
				<p class="mt-1 text-xs text-[#616161] dark:text-[#9E9E9E]">
					The day this entry is about, not the day you typed it.
				</p>
				{#if form?.errors.entryDate}
					<p id="entryDate-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.entryDate}
					</p>
				{/if}
			</div>

			<div>
				<!--
					Not a `<label for>`: both fields it names point back here with
					`aria-labelledby` — the editor, a contenteditable no `for` can target,
					and the no-JavaScript textarea. That textarea is inside `<noscript>`,
					which with script on is text, not elements, so a `for="body"` matched
					no id and Chromium's Issues tab reported it (docs/constraints.md,
					"Labels and lazy images").
				-->
				<span id="body-label" class="block text-sm font-medium text-[#212121] dark:text-[#F5F5F5]">
					Entry
				</span>
				<EntryEditor
					bind:this={editor}
					content={data.entry.content}
					typed={echoed?.body}
					owner={data.owner}
					media={data.media}
					remaining={data.remaining}
					onUploading={(busy) => (uploading = busy)}
					onRecording={(holding) => (recording = holding)}
					labelledBy="body-label"
					describedBy={form?.errors.body ? 'body-error' : undefined}
					invalid={Boolean(form?.errors.body)}
					onReady={(baseline) => {
						// The baseline first, so the controller opens on "saved" rather
						// than treating the stored document as an unsaved change.
						autosave.reset({ title: loaded.title, entryDate: loaded.entryDate, doc: baseline });
					}}
					onDocChange={(value) => (doc = value)}
					onContentDropped={(types) => (dropped = types)}
				>
					{#snippet saveStatus(returnFocus: () => void)}
						<!-- Rendered by the editor once it has taken over, which is when autosave starts. -->
						<SaveStatus
							status={autosave.display}
							onRetry={() => void autosave.flush()}
							{returnFocus}
						/>
					{/snippet}
				</EntryEditor>
				{#if form?.errors.body}
					<p id="body-error" class="mt-1 text-sm text-red-600 dark:text-red-400">
						{form.errors.body}
					</p>
				{/if}
			</div>

			<div class="flex flex-wrap items-center justify-end gap-3">
				<!--
					"Done" rather than "Cancel". There is nothing to cancel any more —
					the entry has been saving all along — and offering to abandon work
					that is already stored would be a lie about what the button does.
					Before the editor arrives nothing has been typed, so Done is true
					then too.
				-->
				<a
					data-needs-js
					href={readHref}
					class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
				>
					Done
				</a>
				<!--
					The no-JavaScript half of the switch. Nothing autosaves here, so the
					page keeps the button it always had. `data-no-js`: see NO JAVASCRIPT
					in `EntryEditor`.
				-->
				<noscript data-no-js>
					<!-- Written by the server, never hydrated: `<noscript>` is not. -->
					<input type="hidden" name="revision" value={form?.revision ?? data.entry.revision} />
					<input type="hidden" name="saveId" value={data.saveId} />
					<a
						href={readHref}
						class="rounded-lg border border-[#E0E0E0] px-4 py-2 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 dark:border-[#3A3A3A] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]"
					>
						Cancel
					</a>
					<button
						type="submit"
						class="rounded-lg bg-[#1976D2] px-4 py-2 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40"
					>
						Save changes
					</button>
				</noscript>
			</div>
		</form>
	</div>
	<ConflictDialog {conflict} />
</main>
