// Helpers to convert Apple's Cocoa-epoch timestamps (reference date
// 2001-01-01T00:00:00Z) into JavaScript `Date` values.
//
// `attachment.created_date` in chat.db is **seconds** since the Cocoa epoch.
// `message.date`            in chat.db is **nanoseconds** since the Cocoa
// epoch. Apple writes `0` for "unset", so callers should treat that the same
// as null.
//
// better-sqlite3 returns INTEGER columns as `bigint` by default, so the
// helpers accept `bigint` in addition to `number`.

const COCOA_EPOCH_UNIX_OFFSET_SECONDS = 978307200;
const NANOS_PER_MILLI = 1_000_000n;
const MILLIS_PER_SECOND = 1000n;
const COCOA_EPOCH_UNIX_OFFSET_MILLIS = BigInt(COCOA_EPOCH_UNIX_OFFSET_SECONDS) * MILLIS_PER_SECOND;

export function cocoaSecondsToDate(value: number | bigint | null): Date | null {
	if (value === null) return null;
	if (typeof value === 'bigint') {
		if (value === 0n) return null;
		const unixMillis = (value + BigInt(COCOA_EPOCH_UNIX_OFFSET_SECONDS)) * MILLIS_PER_SECOND;
		return new Date(Number(unixMillis));
	}
	if (value === 0) return null;
	return new Date((value + COCOA_EPOCH_UNIX_OFFSET_SECONDS) * 1000);
}

export function cocoaNanosToDate(value: number | bigint | null): Date | null {
	if (value === null) return null;
	if (typeof value === 'bigint') {
		if (value === 0n) return null;
		const cocoaMillis = value / NANOS_PER_MILLI;
		return new Date(Number(cocoaMillis + COCOA_EPOCH_UNIX_OFFSET_MILLIS));
	}
	if (value === 0) return null;
	const cocoaMillis = Math.trunc(value / 1_000_000);
	return new Date(cocoaMillis + COCOA_EPOCH_UNIX_OFFSET_SECONDS * 1000);
}
