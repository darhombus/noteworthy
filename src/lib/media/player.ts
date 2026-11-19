/**
 * A video or audio player in an entry: its keys, its focus, and the link it
 * plays from. Plain DOM, so the editor's node view and the read view's
 * component share every line of it.
 *
 * The players themselves are the browser's own (`controls`). What this adds is
 * the same keyboard in every browser, and links that are replaced without the
 * person noticing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE BROWSERS DO ON THEIR OWN
 * ---------------------------------------------------------------------------
 * Established in Chromium 153, Firefox 155 and Playwright's WebKit 26.6 on
 * Windows, with the element itself focused and nothing of ours attached:
 *
 *                 Chromium            Firefox            WebKit
 *   Space         play/pause          play/pause         scrolls the page
 *   K, M, F       nothing             nothing            nothing
 *   ← / →         seek ±0.2 s         seek ±5 s          scroll
 *   ↑ / ↓         volume ±0.05        volume ±0.1        scroll
 *   Home / End    start / end         start / end        scroll
 *
 * So each browser does some of what is wanted, differently, and a handler that
 * simply added the rest would fight them: our Space and Chromium's Space would
 * each toggle, and cancel out. The browser's own handling is therefore
 * switched off for the keys handled here, and this does all of them — except
 * Space in Firefox, which is left to Firefox (FIREFOX AND SPACE).
 *
 * How it is switched off is the part that differs. `preventDefault()` on the
 * keydown does it in Firefox and WebKit wherever it is called. Chromium's
 * player acts from a listener on the media element that runs *before* any
 * listener a page adds to that element, and it checks `defaultPrevented` — so
 * a keydown prevented at the element is too late there, and one prevented on
 * the way down, in the capture phase of an ancestor, is not. Hence the one
 * listener below, a capture-phase `keydown` on the element wrapping the
 * player, which works the same in all three. Keys not handled here (Home, End,
 * Enter, Tab) are left to the browser.
 *
 * ---------------------------------------------------------------------------
 * CHROMIUM'S INNER BUTTONS
 * ---------------------------------------------------------------------------
 * Chromium's control bar is a shadow tree of real buttons (play, the timeline,
 * volume, full screen, the ⋮ menu), each a Tab stop after the element itself.
 * While one of *those* has focus, Chromium sends the page no key events at
 * all — not even to a capture listener on `window` — and no pointer events from
 * the bar either. Clicking its play button leaves focus there, and the keys
 * here would stop working.
 *
 * The element's own events still fire, though: `play`, `pause`, `seeked`,
 * `volumechange`. So whenever one does while focus is inside the player, and
 * focus did not get there by keyboard, focus is put back on the element
 * itself, and the keys work again from the next press. That covers a click on
 * the bar. Somebody who tabbed to one of the buttons is left on it — it is
 * their place — and its keys are Chromium's: Space and Enter press it, and the
 * sliders take their own arrows. See ONLY TAKING FOCUS BACK FROM A MOUSE for
 * how "by keyboard" is judged, and the two cases it gets wrong.
 *
 * Focus is only ever moved from inside the player to the player. A video
 * ending while somebody types elsewhere fires `pause`, and must not take
 * their caret.
 *
 * ---------------------------------------------------------------------------
 * LINKS
 * ---------------------------------------------------------------------------
 * A player fetches as it goes — seeking asks for that part of the file — so it
 * needs a working link for as long as it plays, not only when it starts.
 * Changing `src` makes the element start over: it reloads, stops, and goes back
 * to the beginning. So a fresh link is put in at a moment nobody will notice:
 *
 *   straight away if the player is not playing, at the same position;
 *   while it plays, not at all — the old link is refreshed ten minutes before
 *   it expires, so it still has that long — until it is paused or ends;
 *   or the moment the old link fails, which is when it has to be.
 *
 * A failure that happens while playing, or when somebody pressed play, is
 * reported to the links (which refresh once) and the play is tried again from
 * the same point with the fresh link. A second failure is left to the links,
 * which mark the file missing, and the surface says it could not be played.
 */

export type PlayerKind = 'video' | 'audio';

export type PlayerAction =
	'toggle' | 'back' | 'forward' | 'louder' | 'quieter' | 'mute' | 'fullscreen';

export const SEEK_SECONDS = 5;
export const VOLUME_STEP = 0.1;

/** Actions that flip something, which a held-down key must not flip back and forth. */
const ONCE: ReadonlySet<PlayerAction> = new Set(['toggle', 'mute', 'fullscreen']);

type KeyFacts = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>;

/**
 * What `event` asks the player to do, or `null` for a key the player leaves
 * alone. A key held with Ctrl, Cmd or Alt is somebody else's shortcut.
 */
export function playerAction(event: KeyFacts, kind: PlayerKind): PlayerAction | null {
	if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
		return null;
	}
	switch (event.key) {
		case ' ':
		case 'k':
		case 'K':
			return 'toggle';
		case 'ArrowLeft':
			return 'back';
		case 'ArrowRight':
			return 'forward';
		case 'ArrowUp':
			return 'louder';
		case 'ArrowDown':
			return 'quieter';
		case 'm':
		case 'M':
			return 'mute';
		case 'f':
		case 'F':
			return kind === 'video' ? 'fullscreen' : null;
		default:
			return null;
	}
}

/** The parts of a media element the actions touch, so tests can hand in a stand-in. */
export type Playable = Pick<
	HTMLMediaElement,
	'paused' | 'ended' | 'currentTime' | 'duration' | 'volume' | 'muted' | 'play' | 'pause'
> &
	Partial<Pick<HTMLVideoElement, 'requestFullscreen'>> & {
		webkitEnterFullscreen?: () => void;
	};

type FullscreenDocument = Pick<Document, 'fullscreenElement' | 'exitFullscreen'>;

/**
 * Where a five-second seek from `from` lands: never before the start, and never
 * past the end when the end is known.
 */
export function seekTarget(action: 'back' | 'forward', from: number, duration: number): number {
	if (action === 'back') {
		return Math.max(0, from - SEEK_SECONDS);
	}
	const target = from + SEEK_SECONDS;
	return Number.isFinite(duration) ? Math.min(duration, target) : target;
}

/** Rounded to a tenth, so ten presses up from nothing is exactly full. */
function step(volume: number, by: number): number {
	return Math.min(1, Math.max(0, Math.round((volume + by) * 10) / 10));
}

export function perform(
	action: PlayerAction,
	media: Playable,
	doc: FullscreenDocument | null = typeof document === 'undefined' ? null : document
): void {
	switch (action) {
		case 'toggle':
			if (media.paused || media.ended) {
				// A refused play (no link yet, a file that will not decode) reports
				// itself through the element's `error`, not through this promise.
				void media.play()?.catch(() => {});
			} else {
				media.pause();
			}
			return;
		case 'back':
		case 'forward':
			media.currentTime = seekTarget(action, media.currentTime, media.duration);
			return;
		case 'louder':
			media.volume = step(media.volume, VOLUME_STEP);
			return;
		case 'quieter':
			media.volume = step(media.volume, -VOLUME_STEP);
			return;
		case 'mute':
			media.muted = !media.muted;
			return;
		case 'fullscreen':
			if (doc !== null && doc.fullscreenElement === (media as unknown)) {
				void doc.exitFullscreen().catch(() => {});
			} else if (typeof media.requestFullscreen === 'function') {
				void media.requestFullscreen().catch(() => {});
			} else {
				// iPhone Safari has no element full screen, only the video's own.
				media.webkitEnterFullscreen?.();
			}
			return;
	}
}

/**
 * A key that would type, or delete, if it reached editable text.
 *
 * ---------------------------------------------------------------------------
 * TYPING INSIDE THE EDITOR
 * ---------------------------------------------------------------------------
 * In the editor the player sits inside the contenteditable. With the player
 * focused, a key this module does not use — F on audio, any letter — goes to
 * the browser, and WebKit takes it as typing into the editable text around the
 * player: focus leaves the player and the key lands in the entry. Chromium and
 * Firefox leave it alone. So inside the editor, keys that would type or delete
 * are swallowed while the player has focus; Enter, Tab, Escape, Home and End
 * still go to the browser, which needs them for its own controls and for
 * moving on.
 */
function isTyping(event: KeyboardEvent): boolean {
	if (event.ctrlKey || event.metaKey || event.altKey) {
		return false;
	}
	return event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete';
}

/** Media events that mean the person just used the browser's own controls. */
const CONTROL_EVENTS = ['play', 'pause', 'seeked', 'volumechange', 'ratechange'] as const;

/**
 * How soon after a Tab a focus arriving in the player counts as arriving by
 * keyboard. The two are one task apart; this is generous.
 */
const TAB_WINDOW_MS = 500;

/**
 * Whether this is Firefox, whose own player takes Space. See FIREFOX AND SPACE.
 *
 * An engine check rather than a feature check, deliberately: what is being
 * asked is how one engine's player behaves, and no feature test answers that.
 * `Firefox/` and not `Gecko`, which every Chromium user agent claims to be like.
 */
export function browserTakesSpace(userAgent: string): boolean {
	return /\bFirefox\/\d/.test(userAgent);
}

/**
 * The keyboard, on `wrapper` — the element around the player, not the player:
 * see WHAT THE BROWSERS DO ON THEIR OWN. Returns a function that detaches it.
 *
 * Handled keys are also stopped from going any further, which in the editor is
 * what keeps them from ProseMirror: its handlers are on the editor's own
 * element, an ancestor of `wrapper`, and never see them.
 *
 * Seeks are taken one at a time. A held arrow key repeats about thirty times a
 * second, faster than a seek completes, and Playwright's WebKit lands a seek
 * started while another is still running at 0 — back to the beginning, from a
 * key that meant "on a bit". So while one is running, the next target is kept,
 * each press adding its five seconds to it, and set when the running one ends.
 *
 * ---------------------------------------------------------------------------
 * FIREFOX AND SPACE
 * ---------------------------------------------------------------------------
 * Firefox's inner control buttons are Tab stops like Chromium's, but their keys
 * do reach the page — reported as coming from the player, so the page cannot
 * tell which button has focus. Taking Space there would turn Space on Firefox's
 * own mute button into play/pause. Firefox's player already does Space itself —
 * play/pause on the player, and press on a focused button — so in Firefox,
 * Space is left to it entirely: not prevented, not acted on. The arrows and the
 * letters are still this module's, because there Firefox does something else
 * (its own step sizes) or nothing.
 *
 * ---------------------------------------------------------------------------
 * ONLY TAKING FOCUS BACK FROM A MOUSE — A HEURISTIC
 * ---------------------------------------------------------------------------
 * Moving focus back to the player after its controls are used (CHROMIUM'S
 * INNER BUTTONS) is right for somebody who clicked, and wrong for somebody who
 * tabbed to a control on purpose: it takes their place away. The page cannot see
 * a click on Chromium's control bar, but it can see how focus got into the
 * player. So focus is only moved while the player was not reached by keyboard:
 *
 *   by keyboard — a Tab from the player itself into its controls, or focus
 *   arriving in the player within moments of a Tab anywhere (tabbing in from
 *   before it, or Shift+Tab from after it);
 *
 *   not by keyboard — focus arriving with no Tab before it (a click on the
 *   control bar from outside), or any pointer press the page does see.
 *
 * Coming back in is judged afresh. It is a guess from what the page is
 * shown, and two cases guess wrong: somebody who tabs into the controls and
 * then clicks the bar keeps the old gap (the keys do nothing until they click
 * the picture, because that click is invisible), and a screen reader in its
 * reading mode presses buttons with no Tab the page could see, so it is
 * treated as a mouse and has focus moved. `docs/constraints.md` records both.
 */
export function bindPlayerKeys(
	wrapper: HTMLElement,
	media: HTMLMediaElement,
	kind: PlayerKind,
	options: { editable?: boolean; browserTakesSpace?: boolean } = {}
): () => void {
	const doc = media.ownerDocument;
	const nativeSpace =
		options.browserTakesSpace ??
		(typeof navigator !== 'undefined' && browserTakesSpace(navigator.userAgent));

	/** Whether focus got into the player by keyboard. See the heuristic above. */
	let byKeyboard = false;
	/** When the page last saw a Tab, on the event clock. */
	let tabbedAt = Number.NEGATIVE_INFINITY;

	/** A seek waiting for the running one to finish. */
	let queued: number | null = null;

	const seek = (action: 'back' | 'forward'): void => {
		const target = seekTarget(action, queued ?? media.currentTime, media.duration);
		if (media.seeking) {
			queued = target;
		} else {
			// Cleared as well as used: WebKit reports `seeking` false a moment
			// before it fires `seeked`, and a target left queued would be applied
			// by that late event, on top of this one.
			queued = null;
			media.currentTime = target;
		}
	};

	const onSeeked = (): void => {
		if (queued !== null) {
			const target = queued;
			queued = null;
			media.currentTime = target;
		}
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.target !== media) {
			return;
		}
		if (event.key === 'Tab' && !event.shiftKey) {
			// From the player itself into its own controls.
			byKeyboard = true;
			return;
		}
		if (event.key === ' ' && nativeSpace) {
			// Firefox's. Not prevented, so its player acts; stopped, so nothing
			// of the page's — the editor included — takes it as well.
			event.stopPropagation();
			return;
		}
		const action = playerAction(event, kind);
		if (action === null) {
			if (options.editable === true && isTyping(event)) {
				// See TYPING INSIDE THE EDITOR.
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (event.repeat && ONCE.has(action)) {
			return;
		}
		if (action === 'back' || action === 'forward') {
			seek(action);
		} else {
			perform(action, media, doc);
		}
	};

	// See CHROMIUM'S INNER BUTTONS, and the heuristic above.
	const reclaim = (): void => {
		if (!byKeyboard && doc.activeElement === media) {
			media.focus({ preventScroll: true });
		}
	};

	const onAnyKeyDown = (event: KeyboardEvent): void => {
		if (event.key === 'Tab') {
			tabbedAt = event.timeStamp;
		}
	};
	const onPointerDown = (): void => {
		byKeyboard = false;
	};
	// Judged afresh every time focus comes in from outside, which is also
	// what forgets the last visit: no `focusout` handler is needed.
	const onFocusIn = (event: FocusEvent): void => {
		byKeyboard = event.timeStamp - tabbedAt < TAB_WINDOW_MS;
	};

	const releasePlace = keepPlaceThroughFullscreen(media);

	wrapper.addEventListener('keydown', onKeyDown, true);
	wrapper.addEventListener('focusin', onFocusIn);
	doc.addEventListener('keydown', onAnyKeyDown, true);
	doc.addEventListener('pointerdown', onPointerDown, true);
	media.addEventListener('seeked', onSeeked);
	for (const type of CONTROL_EVENTS) {
		media.addEventListener(type, reclaim);
	}
	doc.addEventListener('fullscreenchange', reclaim);

	return () => {
		releasePlace();
		wrapper.removeEventListener('keydown', onKeyDown, true);
		wrapper.removeEventListener('focusin', onFocusIn);
		doc.removeEventListener('keydown', onAnyKeyDown, true);
		doc.removeEventListener('pointerdown', onPointerDown, true);
		media.removeEventListener('seeked', onSeeked);
		for (const type of CONTROL_EVENTS) {
			media.removeEventListener(type, reclaim);
		}
		doc.removeEventListener('fullscreenchange', reclaim);
	};
}

/**
 * How tall this browser draws an audio player, measured, never assumed.
 *
 * Each engine draws its own: 54px in Chromium 153, 40px in Firefox 155, 31px
 * in Playwright's WebKit 26.6 — and any of them may change. So an empty
 * `<audio controls>` is put on the page out of sight, its height read, and
 * taken away. An empty one is drawn at the same height as one with a file, in
 * all three.
 */
export function audioPlayerHeight(doc: Document): number {
	const probe = doc.createElement('audio');
	probe.controls = true;
	probe.setAttribute('aria-hidden', 'true');
	probe.style.cssText =
		'position:absolute;visibility:hidden;pointer-events:none;left:-10000px;top:0;width:300px;display:block';
	doc.body.append(probe);
	const height = probe.getBoundingClientRect().height;
	probe.remove();
	return height;
}

/** The class a video with no picture is drawn with. See `fitSoundOnlyVideo`. */
export const SOUND_ONLY_CLASS = 'entry-media-sound';

/**
 * Draws a video that turns out to have no picture as the audio player it is.
 * Returns a function that detaches it.
 *
 * New uploads with no picture are stored as audio (`$lib/media/prepare`), so
 * this is for the rest: a QuickTime file with sound only, which has no audio
 * type to become, and a video node saved before uploads were checked. A
 * `<video>` with nothing to show draws a video-sized box behind its controls —
 * 150px of black in Chromium, 343px in Firefox — but sized to the height this
 * browser gives an audio player, its controls are drawn exactly as an audio
 * player's are, in both. Measured when the metadata says there is no picture,
 * so the height follows whatever this browser draws.
 */
export function fitSoundOnlyVideo(video: HTMLVideoElement): () => void {
	const check = (): void => {
		if (video.readyState < 1) {
			return;
		}
		if (video.videoWidth === 0 && video.videoHeight === 0) {
			video.classList.add(SOUND_ONLY_CLASS);
			video.style.height = `${audioPlayerHeight(video.ownerDocument)}px`;
		} else {
			video.classList.remove(SOUND_ONLY_CLASS);
			video.style.removeProperty('height');
		}
	};
	check();
	video.addEventListener('loadedmetadata', check);
	return () => video.removeEventListener('loadedmetadata', check);
}

/** How long after leaving full screen the window's own resize may still arrive. */
const RETURN_WINDOW_MS = 1000;

/**
 * Brings the page back to the player when it leaves full screen. Returns a
 * function that detaches it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PLACE IS LOST
 * ---------------------------------------------------------------------------
 * Full screen gives the window the whole screen. While the video fills it, the
 * page underneath is laid out again at the screen's size — wider, so the text
 * wraps less and the page is shorter — and its scroll position moves with that
 * layout. Leaving gives the old size back, and neither Chromium nor Firefox
 * restores the scroll position: Chromium does only when the window did not
 * change size. The page is left wherever the wider layout put it, with the
 * video somewhere off screen. It is the scroll position, not the player: the
 * element is the same one throughout and keeps its focus.
 *
 * So where the player sat in the window is kept while it is not full screen,
 * frozen from the moment it goes full screen (the scrolling that entering and
 * leaving cause must not overwrite it), and on the way out the page is
 * scrolled until the player sits there again. Twice: once the layout has
 * settled, and again if the window's resize back arrives after that, which it
 * does on its own schedule.
 *
 * Focus goes back to the player too if leaving dropped it on the page itself,
 * so the keys go on working. It is never taken from anything else.
 *
 * iPhone Safari plays a video full screen in its own player, with
 * `webkitbeginfullscreen` and `webkitendfullscreen` on the element rather than
 * `fullscreenchange` on the document; both are listened for. That half is
 * untested: no browser this project can drive plays video that way.
 */
export function keepPlaceThroughFullscreen(media: HTMLMediaElement): () => void {
	const doc = media.ownerDocument;
	const win = doc.defaultView;
	if (win === null) {
		return () => {};
	}

	/** The player's distance from the top of the window, the last time it was on the page. */
	let placeTop: number | null = null;
	/** From going full screen until the page is back where it was. */
	let away = false;
	let settle: ReturnType<typeof setTimeout> | null = null;

	const remember = (): void => {
		if (!away && doc.fullscreenElement === null) {
			placeTop = media.getBoundingClientRect().top;
		}
	};

	const restore = (): void => {
		if (placeTop === null || doc.fullscreenElement !== null) {
			return;
		}
		const off = media.getBoundingClientRect().top - placeTop;
		if (Math.abs(off) >= 1) {
			win.scrollBy({ top: off, behavior: 'instant' });
		}
		if (doc.activeElement === null || doc.activeElement === doc.body) {
			media.focus({ preventScroll: true });
		}
	};

	const onResizeBack = (): void => {
		win.requestAnimationFrame(restore);
	};

	const leave = (): void => {
		if (!away) {
			return;
		}
		win.requestAnimationFrame(() => win.requestAnimationFrame(restore));
		win.addEventListener('resize', onResizeBack);
		if (settle !== null) {
			clearTimeout(settle);
		}
		settle = setTimeout(() => {
			win.removeEventListener('resize', onResizeBack);
			away = false;
			settle = null;
			remember();
		}, RETURN_WINDOW_MS);
	};

	const enter = (): void => {
		away = true;
		if (settle !== null) {
			// Back in before the last return had settled: that one is abandoned.
			clearTimeout(settle);
			settle = null;
			win.removeEventListener('resize', onResizeBack);
		}
	};

	const onFullscreenChange = (): void => {
		if (doc.fullscreenElement === media) {
			enter();
		} else if (doc.fullscreenElement === null) {
			leave();
		}
	};

	remember();
	win.addEventListener('scroll', remember, { passive: true });
	win.addEventListener('resize', remember);
	doc.addEventListener('fullscreenchange', onFullscreenChange);
	media.addEventListener('webkitbeginfullscreen', enter);
	media.addEventListener('webkitendfullscreen', leave);

	return () => {
		if (settle !== null) {
			clearTimeout(settle);
		}
		win.removeEventListener('scroll', remember);
		win.removeEventListener('resize', remember);
		win.removeEventListener('resize', onResizeBack);
		doc.removeEventListener('fullscreenchange', onFullscreenChange);
		media.removeEventListener('webkitbeginfullscreen', enter);
		media.removeEventListener('webkitendfullscreen', leave);
	};
}

export type PlayerSource = {
	/** A link for the file arrived, first or fresh. See LINKS. */
	set: (url: string) => void;
	destroy: () => void;
};

type SourceMedia = Pick<
	HTMLMediaElement,
	| 'src'
	| 'paused'
	| 'ended'
	| 'currentTime'
	| 'duration'
	| 'error'
	| 'readyState'
	| 'play'
	| 'addEventListener'
	| 'removeEventListener'
	| 'getAttribute'
>;

/**
 * Keeps `media` playing from the page's current link for its file. `loaded`
 * and `failed` are `MediaLinks.loaded` and `MediaLinks.failed` for this path.
 *
 * `initial` is the link the element was rendered with, if it was — the read
 * view's server-side render puts it in the HTML, and it may already have
 * loaded, or failed, before this runs.
 */
export function createPlayerSource(
	media: SourceMedia,
	links: { loaded: () => void; failed: (url: string) => void },
	initial: string | null = null
): PlayerSource {
	let current: string | null = initial;
	/** A fresh link held back while the player plays. */
	let waiting: string | null = null;
	/** Whether the person wanted it playing when it last failed. */
	let resume = false;
	/** Whether the person last asked it to play, as opposed to pause. */
	let wantsPlay = false;
	/** Where it had got to: an element that failed may have forgotten. */
	let position = 0;
	let destroyed = false;

	const playing = (): boolean => !media.paused && !media.ended;

	const apply = (url: string): void => {
		const at = Math.max(position, media.currentTime || 0);
		const again = resume;
		resume = false;
		waiting = null;
		current = url;
		media.src = url;
		if (at > 0 || again) {
			const restore = (): void => {
				if (destroyed) {
					return;
				}
				if (at > 0) {
					media.currentTime = Number.isFinite(media.duration) ? Math.min(at, media.duration) : at;
				}
				if (again) {
					void media.play()?.catch(() => {});
				}
			};
			media.addEventListener('loadedmetadata', restore, { once: true });
		}
	};

	const listeners: [string, () => void][] = [
		['play', () => (wantsPlay = true)],
		[
			'pause',
			() => {
				wantsPlay = false;
				if (waiting !== null && media.error === null) {
					apply(waiting);
				}
			}
		],
		['timeupdate', () => (position = media.currentTime)],
		// Only a play that actually got going settles the link. A file whose
		// metadata loads and whose playback then fails would otherwise reset the
		// one retry every time, and ask for fresh links for ever.
		['playing', () => links.loaded()],
		[
			'loadedmetadata',
			() => {
				if (!wantsPlay) {
					links.loaded();
				}
			}
		],
		['error', () => fail()]
	];

	/** The link a failure was last reported for: one link fails once. */
	let reported: string | null = null;

	const fail = (): void => {
		if (destroyed || current === null || reported === current) {
			return;
		}
		// Seen twice when the element failed before this was listening: its
		// `error` is already set when the check below runs, and the event itself
		// may still be on its way. Reporting both would spend the one retry.
		reported = current;
		resume = wantsPlay || playing();
		links.failed(current);
	};

	for (const [type, listener] of listeners) {
		media.addEventListener(type, listener);
	}

	// Already failed before anything was listening: the server's link had died
	// by the time the page arrived.
	if (initial !== null && media.error !== null) {
		fail();
	} else if (initial !== null && media.readyState >= 1) {
		links.loaded();
	}

	return {
		set(url) {
			if (destroyed) {
				return;
			}
			if (url === current && media.error === null) {
				waiting = null;
				return;
			}
			if (media.getAttribute('src') === null || media.error !== null || !playing()) {
				apply(url);
			} else {
				waiting = url;
			}
		},
		destroy() {
			destroyed = true;
			for (const [type, listener] of listeners) {
				media.removeEventListener(type, listener);
			}
		}
	};
}
