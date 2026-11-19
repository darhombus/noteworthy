/**
 * The shape of a batch of signed links, shared by the server that makes them
 * (`sign.server.ts`) and the browser that keeps them fresh (`links.ts`). Its own
 * file so that the browser never imports anything from a `.server` module, even
 * a type.
 */

/** How long a signed link works. */
export const SIGNED_URL_SECONDS = 60 * 60;

export type SignedMedia = {
	/**
	 * Signed URL by storage path, for every path that could be signed. A plain
	 * object rather than a Map so it passes through a load function unchanged.
	 */
	urls: Record<string, string>;
	/**
	 * When the links stop working, in milliseconds since the epoch. Taken from
	 * the moment before the request and rounded down to the second, as Storage
	 * rounds the time it signs at, so it is never later than Storage's own expiry
	 * while the two clocks agree.
	 */
	expiresAt: number;
	/**
	 * The server's clock when it signed, on the same footing as `expiresAt`. The
	 * browser times its refresh from the difference between the two rather than
	 * from `expiresAt` alone, because a phone's clock can be minutes out from the
	 * server's and the refresh is only ten minutes early.
	 */
	signedAt: number;
	/**
	 * Browser only, never sent by the server: when this browser had the batch in
	 * hand (or sent the request that fetched it), on the clock of the
	 * `MediaLinks` that takes it in (`deviceClock`). The links' life is counted
	 * from here, not from when a page happens to construct its links: data
	 * preloaded on hover can sit for minutes before the tap uses it.
	 */
	receivedAt?: number;
};
