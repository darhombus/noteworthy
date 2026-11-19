<script lang="ts">
	/**
	 * Recording audio into an entry: asking for the microphone, the recording
	 * itself, and listening back before it is added.
	 *
	 * ---------------------------------------------------------------------------
	 * A PANEL UNDER THE TOOLBAR, NOT A DIALOG
	 * ---------------------------------------------------------------------------
	 * It sits in the pinned toolbar row, under the buttons, for as long as the
	 * recording is open. Not a modal dialog, for two reasons. A modal dialog
	 * closes on Escape, and in Chromium a second Escape closes it whether the
	 * page agrees or not — one stray key would throw away half an hour of
	 * somebody talking. And somebody recording may want to write a line while
	 * they do, which a modal would forbid. Pinned, it stays on screen however
	 * far down they write; the row's height is measured already, so the caret
	 * keeps clear of it like it keeps clear of the buttons.
	 *
	 * Nothing here takes Escape. The panel's buttons are ordinary Tab stops after
	 * the toolbar's one stop and before the text, like the save status's Try
	 * again, and never part of the toolbar's arrow-key walk.
	 *
	 * ---------------------------------------------------------------------------
	 * WHAT IS SAID, AND WHEN
	 * ---------------------------------------------------------------------------
	 * Before a word is recorded, how long it can be (`limitNote`). A minute before
	 * the end, that the end is near and what it is. When it stops by itself, why,
	 * and that everything is kept. Those three go to a polite live region as well
	 * as the screen. The clock and the meter do not: announced every second they
	 * would drown out everything else. A refused microphone is an alert.
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		formatClock,
		limitNote,
		microphoneMessage,
		nearEndNote,
		noRoomToRecord,
		planRecording,
		recorderFailedMessage,
		RECORDING_MIN_MS,
		stoppedNote,
		type RecordingFormat,
		type RecordingPlan
	} from '$lib/media/recording';
	import { startRecording, type ActiveRecording, type RecordingResult } from '$lib/media/recorder';

	let {
		format,
		remaining,
		context,
		onAdd,
		onClose,
		onHolding
	}: {
		/** What this browser records in, from `recordingSupport`. */
		format: RecordingFormat;
		/** Bytes left in the allowance, or `null` if it could not be read. */
		remaining: number | null;
		/** For the level meter; see `meterContext`. Closed when this goes. */
		context: AudioContext | null;
		/** The recording, to go into the entry through the upload queue. */
		onAdd: (file: File) => void;
		/** Finished with, one way or another: the editor takes focus back. */
		onClose: () => void;
		/** Whether leaving now would lose a recording. */
		onHolding: (holding: boolean) => void;
	} = $props();

	type Phase =
		| { name: 'asking' }
		| { name: 'recording'; plan: RecordingPlan }
		| { name: 'review'; result: RecordingResult; url: string }
		| { name: 'error'; message: string };

	let phase = $state<Phase>({ name: 'asking' });
	let elapsed = $state(0);
	let endsAt = $state(0);
	let level = $state(0);
	let nearEnd = $state<string | null>(null);
	/** What the live region last said. */
	let announcement = $state('');

	let active: ActiveRecording | null = null;
	let gone = false;

	let stopButton = $state<HTMLButtonElement | null>(null);
	let addButton = $state<HTMLButtonElement | null>(null);
	let message = $state<HTMLElement | null>(null);

	$effect(() => {
		onHolding(phase.name === 'recording' || phase.name === 'review');
	});

	async function focusAfterRender(target: () => HTMLElement | null): Promise<void> {
		await tick();
		target()?.focus();
	}

	onMount(() => {
		// Checked before asking for the microphone, so nobody is asked for it to be
		// told there is no room. Planned at Chromium's AAC floor, the highest rate a
		// recorder here was seen to insist on; the real plan follows once the
		// recorder says what it will use.
		if (remaining !== null && planRecording(remaining, 96_000).limitMs < RECORDING_MIN_MS) {
			phase = { name: 'error', message: noRoomToRecord(remaining) };
			void focusAfterRender(() => message);
			return;
		}
		void begin();
	});

	async function begin(): Promise<void> {
		try {
			const started = await startRecording({
				format,
				remaining,
				context,
				events: {
					onTick: ({ elapsedMs, progress }) => {
						elapsed = elapsedMs;
						endsAt = progress.endsAtMs;
						if (progress.nearEnd && nearEnd === null) {
							nearEnd = nearEndNote(progress.endsBy);
							announcement = nearEnd;
						}
					},
					onLevel: (value) => (level = value),
					onStopped: review,
					onFailed: (failed) => {
						active = null;
						phase = { name: 'error', message: failed };
						announcement = '';
						void focusAfterRender(() => message);
					}
				}
			});
			if (gone) {
				started.cancel();
				return;
			}
			active = started;
			endsAt = started.plan.limitMs;
			phase = { name: 'recording', plan: started.plan };
			announcement = `Recording. ${limitNote(started.plan, remaining)}`;
			void focusAfterRender(() => stopButton);
		} catch (thrown) {
			if (gone) {
				return;
			}
			phase = { name: 'error', message: microphoneMessage(thrown, navigator.userAgent) };
			void focusAfterRender(() => message);
		}
	}

	function review(result: RecordingResult): void {
		active = null;
		if (gone) {
			return;
		}
		const note =
			result.stoppedBy === 'person'
				? null
				: result.stoppedBy === 'failure'
					? recorderFailedMessage(result.failure ?? 'unknown error')
					: stoppedNote(result.stoppedBy, result.elapsedMs);
		phase = { name: 'review', result, url: URL.createObjectURL(result.file) };
		elapsed = result.elapsedMs;
		stoppedBy = note;
		announcement = note ?? `Recording stopped at ${formatClock(result.elapsedMs)}.`;
		void focusAfterRender(() => addButton);
	}

	/** Why it stopped, when that was not the person pressing Stop. */
	let stoppedBy = $state<string | null>(null);

	function stop(): void {
		active?.stop();
	}

	function close(): void {
		if (phase.name === 'review') {
			URL.revokeObjectURL(phase.url);
		}
		active?.cancel();
		active = null;
		onHolding(false);
		onClose();
	}

	function add(): void {
		if (phase.name !== 'review') {
			return;
		}
		const { file } = phase.result;
		URL.revokeObjectURL(phase.url);
		onHolding(false);
		onAdd(file);
		onClose();
	}

	onDestroy(() => {
		gone = true;
		active?.cancel();
		active = null;
		if (phase.name === 'review') {
			URL.revokeObjectURL(phase.url);
		}
		void context?.close().catch(() => {});
	});

	const secondary =
		'rounded-lg border border-[#E0E0E0] bg-white px-3 py-1.5 text-sm text-[#212121] hover:bg-[#F5F5F5] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5] dark:hover:bg-[#2C2C2C]';
	const primary =
		'rounded-lg bg-[#1976D2] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1565C0] focus-visible:ring-2 focus-visible:ring-[#1976D2]/40 focus-visible:outline-none';
</script>

<!--
	`clear-both` so it starts below the save status, which floats at the end of
	the last line of buttons.
-->
<section
	aria-label="Recording audio"
	data-recorder={phase.name}
	class="clear-both mx-1 mt-1 mb-1 rounded-lg border border-[#E0E0E0] bg-[#FAFAFA] px-3 py-2 text-sm text-[#212121] dark:border-[#3A3A3A] dark:bg-[#1E1E1E] dark:text-[#F5F5F5]"
>
	<p class="sr-only" aria-live="polite">{announcement}</p>

	{#if phase.name === 'asking'}
		<div class="flex flex-wrap items-center gap-3">
			<p class="mr-auto text-[#616161] dark:text-[#9E9E9E]">
				Waiting for the microphone. If your browser asks, choose Allow.
			</p>
			<button type="button" class={secondary} onclick={close}>Cancel</button>
		</div>
	{:else if phase.name === 'recording'}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<span class="flex items-center gap-2 font-medium">
				<span aria-hidden="true" class="h-2.5 w-2.5 rounded-full bg-[#C62828] dark:bg-[#EF9A9A]"
				></span>
				Recording
			</span>
			<span role="timer" class="font-mono tabular-nums" data-recorder-clock>
				{formatClock(elapsed)}
				<span class="text-[#616161] dark:text-[#9E9E9E]">/ {formatClock(endsAt)}</span>
			</span>
			<!--
				Hidden from assistive technology: it changes sixty times a second, and
				what it says — that sound is arriving — is for eyes checking the
				microphone is on.
			-->
			<span
				aria-hidden="true"
				class="relative h-2 w-24 overflow-hidden rounded-full bg-[#E0E0E0] dark:bg-[#3A3A3A]"
			>
				<span
					data-recorder-level={level.toFixed(2)}
					class="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-[#1976D2] dark:bg-[#90CAF9]"
					style:transform="scaleX({level})"
				></span>
			</span>
			<span class="ml-auto flex gap-2">
				<button bind:this={stopButton} type="button" class={primary} onclick={stop}>Stop</button>
				<button type="button" class={secondary} onclick={close}>Cancel</button>
			</span>
		</div>
		<!--
			The limit stays said for the whole recording. The warning joins it rather
			than replacing it, so a recording that is short from the start — little
			space left — is still told why before the warning arrives.
		-->
		<p class="mt-1 text-xs text-[#616161] dark:text-[#9E9E9E]">
			{limitNote(phase.plan, remaining)}
		</p>
		{#if nearEnd !== null}
			<p class="mt-1 text-xs font-medium text-[#212121] dark:text-[#F5F5F5]" data-recorder-warning>
				{nearEnd}
			</p>
		{/if}
	{:else if phase.name === 'review'}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<span class="font-medium">Recording, {formatClock(elapsed)}</span>
			<span class="ml-auto flex gap-2">
				<button bind:this={addButton} type="button" class={primary} onclick={add}>
					Add to entry
				</button>
				<button type="button" class={secondary} onclick={close}>Discard</button>
			</span>
		</div>
		<audio class="mt-2 block w-full" controls preload="metadata" src={phase.url}></audio>
		{#if stoppedBy !== null}
			<p class="mt-1 text-xs text-[#616161] dark:text-[#9E9E9E]">{stoppedBy}</p>
		{/if}
	{:else}
		<div class="flex flex-wrap items-start gap-3">
			<p
				bind:this={message}
				role="alert"
				tabindex="-1"
				class="mr-auto min-w-0 flex-1 text-[#C62828] focus:outline-none dark:text-[#EF9A9A]"
			>
				{phase.message}
			</p>
			<button type="button" class={secondary} onclick={close}>Close</button>
		</div>
	{/if}
</section>
