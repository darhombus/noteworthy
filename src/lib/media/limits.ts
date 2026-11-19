/**
 * How much a person can store.
 *
 * Megabytes here are binary (1 MB = 1,048,576 bytes), as the bucket's previous
 * 30 MB limit was. Both figures are enforced by the database — this file is what
 * the browser checks first so the refusal can say what happened, with numbers —
 * and a test in `tests/rls/media.test.ts` fails if either drifts from it.
 */

export const MB = 1024 * 1024;

/** One file. Set on the `media` bucket, so Storage itself refuses anything larger. */
export const FILE_LIMIT_BYTES = 25 * MB;

/**
 * One account, however it is spent. Every object in the person's folder counts,
 * including files no entry refers to any more, until the cleanup job removes
 * them. `public.media_allowance_remaining()` says what is left.
 */
export const ALLOWANCE_BYTES = 70 * MB;

/**
 * Photos, videos and recordings in one entry, all kinds counted together. The
 * toolbar stops offering more at this number, and `submittedBody` refuses a
 * document holding more, so a document written some other way cannot either.
 */
export const MAX_MEDIA_PER_ENTRY = 20;

/**
 * The long side of a stored photo, in pixels. Photos are scaled down to it in
 * the browser before upload and never scaled up. GIFs are exempt: they are
 * stored as they are, so that their animation survives.
 */
export const IMAGE_MAX_EDGE = 2048;

/** The most a processed photo may weigh once stored. GIFs are exempt, as above. */
export const IMAGE_MAX_BYTES = 2 * MB;
