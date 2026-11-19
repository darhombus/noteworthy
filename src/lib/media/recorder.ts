/**
 * A recording in progress: the microphone, the recorder, the level meter, and
 * the watch on time and size. Browser only. The rules it follows are
 * `recording.ts`; the panel that shows it is `AudioRecorder.svelte`.
 *
 * ---------------------------------------------------------------------------
 * THE MICROPHONE IS LET GO OF EVERY WAY OUT
 * ---------------------------------------------------------------------------
 * The browser's recording indicator — the red dot in the tab, the orange one
 * on a phone — stays on for as long as any track from `getUserMedia` is live,
 * whether or not anything is still recording. So every way a recording ends
 * stops the tracks: Stop (once the recorder has handed over its last slice),
 * Cancel (at once), the recorder failing, the microphone going away, and the
 * panel being torn down with the page. `release` is the one place that does
 * it, and it is safe to call twice.
 *
 * ---------------------------------------------------------------------------
 * WHAT COMES OUT
 * ---------------------------------------------------------------------------
 * A `File`, typed as it will be stored (`recordedType`), named for when it was
 * made, and — for WebM — with the length its recorder did not write
 * (`webm.ts`), so that the player in the panel can already seek in it. It goes
 * into the entry through the same intake, queue and placeholder as a picked
 * audio file: nothing about a recording's upload is its own.
 */
import {
	levelOf,
	NOTHING_RECORDED,
	planRecording,
	recorderFailedMessage,
	recordedType,
	recordingName,
	recordingProgress,
	RECORDING_BITS_PER_SECOND,
	RECORDING_SLICE_MS,
	type RecordingFormat,
	type RecordingLimit,
	type RecordingPlan,
	type RecordingProgress
} from './recording';
import { withDuration } from './webm';

/** How often the clock and the size are looked at. */
const TICK_MS = 250;

/** How long Stop waits for the recorder's last slice before letting go regardless. */
const STOP_WAIT_MS = 3000;

export type RecordingTick = { elapsedMs: number; bytes: number; progress: RecordingProgress };

export type RecordingResult = {
	file: File;
	elapsedMs: number;
	/** Who or what stopped it. */
	stoppedBy: 'person' | RecordingLimit | 'failure';
	/** What the recorder said when it failed, for `stoppedBy: 'failure'`. */
	failure: string | null;
};

export type RecorderEvents = {
	onTick: (tick: RecordingTick) => void;
	/** From 0 to 1, about sixty times a second. */
	onLevel: (level: number) => void;
	onStopped: (result: RecordingResult) => void;
	/** Nothing was recorded, and this says why. */
	onFailed: (message: string) => void;
};

export type ActiveRecording = {
	plan: RecordingPlan;
	/** Stops and keeps what was recorded; `onStopped` follows. */
	stop: () => void;
	/** Stops and keeps nothing, and lets go of the microphone at once. */
	cancel: () => void;
};

/**
 * An `AudioContext` for the level meter, made while the click that asked for a
 * recording is still being handled: Safari leaves one made later suspended.
 * `null` where there is none to be had; the meter then stays still, and the
 * recording is unaffected.
 */
export function meterContext(): AudioContext | null {
	try {
		return new AudioContext();
	} catch {
		return null;
	}
}

/**
 * Asks for the microphone and starts recording. Rejects with whatever
 * `getUserMedia` or the recorder threw, for `microphoneMessage` to explain.
 */
export async function startRecording(options: {
	format: RecordingFormat;
	remaining: number | null;
	context: AudioContext | null;
	events: RecorderEvents;
}): Promise<ActiveRecording> {
	const { format, remaining, context, events } = options;
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

	let recorder: MediaRecorder;
	try {
		recorder = new MediaRecorder(stream, {
			mimeType: format.mimeType,
			audioBitsPerSecond: RECORDING_BITS_PER_SECOND
		});
	} catch (thrown) {
		for (const track of stream.getTracks()) {
			track.stop();
		}
		throw thrown;
	}

	// Planned on what the recorder says it will write, which is not always what
	// it was asked for — and not until it has started: Chromium's AAC recorder
	// reports the 64 kbps it was asked for when constructed, and its 96 kbps
	// floor from `start` on. Planned here first in case `start` never comes.
	const planFor = (): RecordingPlan =>
		planRecording(remaining, recorder.audioBitsPerSecond || RECORDING_BITS_PER_SECOND);
	let plan = planFor();

	const parts: Blob[] = [];
	let bytes = 0;
	let startedAt: number | null = null;
	let stoppedAt: number | null = null;
	let stoppedBy: RecordingResult['stoppedBy'] = 'person';
	let failure: string | null = null;
	let discarded = false;
	let released = false;
	let finishing = false;
	let delivered = false;
	let frame = 0;
	let ticker: ReturnType<typeof setInterval> | null = null;
	let stopTimer: ReturnType<typeof setTimeout> | null = null;
	const began = new Date();

	// The meter: the microphone into an analyser, read every frame. Nothing is
	// connected to the speakers, so nothing is heard.
	let source: MediaStreamAudioSourceNode | null = null;
	let analyser: AnalyserNode | null = null;
	if (context !== null) {
		try {
			source = context.createMediaStreamSource(stream);
			analyser = context.createAnalyser();
			analyser.fftSize = 1024;
			source.connect(analyser);
			void context.resume().catch(() => {});
			const samples = new Float32Array(analyser.fftSize);
			const read = (): void => {
				if (released || analyser === null) {
					return;
				}
				analyser.getFloatTimeDomainData(samples);
				events.onLevel(levelOf(samples));
				frame = requestAnimationFrame(read);
			};
			frame = requestAnimationFrame(read);
		} catch {
			source = null;
			analyser = null;
		}
	}

	const elapsed = (): number =>
		startedAt === null ? 0 : (stoppedAt ?? performance.now()) - startedAt;

	function release(): void {
		if (released) {
			return;
		}
		released = true;
		cancelAnimationFrame(frame);
		if (ticker !== null) {
			clearInterval(ticker);
		}
		if (stopTimer !== null) {
			clearTimeout(stopTimer);
		}
		source?.disconnect();
		analyser?.disconnect();
		for (const track of stream.getTracks()) {
			track.stop();
		}
		events.onLevel(0);
	}

	async function deliver(): Promise<void> {
		release();
		// Once: the `stop` event and the timer after it can both get here.
		if (discarded || delivered) {
			return;
		}
		delivered = true;
		const type = recordedType(recorder.mimeType || parts[0]?.type || '', format.type);
		if (bytes === 0) {
			events.onFailed(failure === null ? NOTHING_RECORDED : recorderFailedMessage(failure));
			return;
		}
		let blob = new Blob(parts, { type });
		if (type === 'audio/webm') {
			const fixed = withDuration(new Uint8Array(await blob.arrayBuffer()));
			if (fixed !== null) {
				blob = new Blob([fixed], { type });
			}
		}
		events.onStopped({
			file: new File([blob], recordingName(began, type), { type }),
			// Stopped by the clock, it is as long as the limit: the tick that noticed
			// may be a moment later, and "30:01, the longest a recording can be"
			// would contradict itself.
			elapsedMs: stoppedBy === 'time' ? Math.min(elapsed(), plan.limitMs) : elapsed(),
			stoppedBy,
			failure
		});
	}

	function finish(by: RecordingResult['stoppedBy']): void {
		if (finishing) {
			return;
		}
		finishing = true;
		stoppedBy = by;
		stoppedAt = performance.now();
		if (ticker !== null) {
			clearInterval(ticker);
			ticker = null;
		}
		if (recorder.state === 'inactive') {
			void deliver();
			return;
		}
		// The last slice arrives, then `stop`. A recorder that never says `stop`
		// (it happens when the track has already ended) is not waited on forever.
		stopTimer = setTimeout(() => void deliver(), STOP_WAIT_MS);
		recorder.addEventListener('stop', () => void deliver(), { once: true });
		try {
			recorder.stop();
		} catch {
			void deliver();
		}
	}

	function check(): void {
		if (startedAt === null || finishing) {
			return;
		}
		const now = elapsed();
		const progress = recordingProgress(plan, now, bytes);
		events.onTick({ elapsedMs: now, bytes, progress });
		if (progress.stop !== null) {
			finish(progress.stop);
		}
	}

	recorder.addEventListener('dataavailable', (event) => {
		if (event.data.size > 0) {
			parts.push(event.data);
			bytes += event.data.size;
		}
		// Straight away rather than at the next tick: a slice is when the size
		// changes, and the budget leaves room for about one more.
		check();
	});
	recorder.addEventListener('error', (event) => {
		const { error } = event as Event & { error?: DOMException };
		failure = error ? `${error.name}: ${error.message}` : 'unknown error';
		finish('failure');
	});
	let running = (): void => {};
	const started = new Promise<void>((resolve) => (running = resolve));
	recorder.addEventListener(
		'start',
		() => {
			startedAt = performance.now();
			plan = planFor();
			ticker = setInterval(check, TICK_MS);
			check();
			running();
		},
		{ once: true }
	);
	// A recorder that fails before it starts says so through `error`, and the
	// caller has nothing to wait for.
	recorder.addEventListener('error', running, { once: true });
	// Unplugged, taken by another app, or the permission withdrawn mid-recording.
	for (const track of stream.getAudioTracks()) {
		track.addEventListener('ended', () => {
			if (!finishing) {
				failure = 'the microphone stopped';
				finish('failure');
			}
		});
	}

	try {
		recorder.start(RECORDING_SLICE_MS);
	} catch (thrown) {
		discarded = true;
		release();
		throw thrown;
	}
	// Returned once it is really recording, so the panel's plan is the one the
	// recorder settled on, and Stop cannot be pressed before there is anything
	// to stop.
	await Promise.race([started, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS))]);

	return {
		get plan() {
			return plan;
		},
		stop: () => finish('person'),
		cancel: () => {
			discarded = true;
			release();
			finish('person');
		}
	};
}
