import {ExifDate, ExifDateTime, type Tags} from 'exiftool-vendored';
import type {DateParts} from './dateParts.ts';

/**
 * Metadata tags holding a capture date, in priority order.
 *
 * `CreationDate` (QuickTime Keys) is timezone-aware and preferred for video.
 * `CreateDate` is listed after it because for QuickTime it is stored in UTC;
 * see {@link toLocalDateParts} for how that UTC value is handled.
 */
const DATE_TAGS = [
	'SubSecDateTimeOriginal',
	'DateTimeOriginal',
	'CreationDate',
	'CreateDate',
	'MediaCreateDate',
] as const satisfies readonly (keyof Tags)[];

/**
 * True when exiftool-vendored *defaulted* a date to UTC because it could not
 * find a real timezone (its `defaultVideosToUTC` behavior for video files).
 *
 * In that case the wall-clock is a UTC value, not a local one, and must be
 * converted. An explicitly-UTC date (`inferredZone === false`, e.g. an EXIF
 * value written as "...Z") is taken at face value, and a date whose zone was
 * recovered from another tag has a non-UTC zone, so neither matches here.
 */
function isDefaultedUtc(value: ExifDateTime): boolean {
	return value.zone === 'UTC' && value.inferredZone === true;
}

function partsFromExifDateTime(value: ExifDateTime): DateParts {
	return {
		year: value.year,
		month: value.month,
		day: value.day,
		time: {hour: value.hour, minute: value.minute, second: value.second},
	};
}

/**
 * Convert a metadata date value to the calendar date the photo belongs to,
 * expressed as local wall-clock parts.
 *
 * A defaulted-UTC value is converted into `homeZone`; every other value
 * already carries the intended local wall-clock and is used unchanged.
 */
export function toLocalDateParts(value: unknown, homeZone: string): DateParts | null {
	if (value instanceof ExifDate) {
		if (value.month === undefined || value.day === undefined) {
			return null;
		}
		return {year: value.year, month: value.month, day: value.day, time: null};
	}
	if (value instanceof ExifDateTime) {
		if (isDefaultedUtc(value)) {
			const local = value.setZone(homeZone);
			if (local !== undefined) {
				return partsFromExifDateTime(local);
			}
		}
		return partsFromExifDateTime(value);
	}
	return null;
}

/**
 * How much we trust the wall-clock portion of a metadata date.
 *
 * `date-only` means the source had no real time component — either an `ExifDate`
 * value, or an `ExifDateTime` stamped at exactly 00:00:00 (a "date-only"
 * sentinel that some software writes when only the calendar day is known).
 * `high` means a real wall-clock time was recorded.
 */
export type MetadataConfidence = 'high' | 'date-only';

export interface MetadataDate {
	date: DateParts;
	/** Which metadata tag the date came from. */
	tag: string;
	confidence: MetadataConfidence;
}

/**
 * True when this `ExifDateTime` looks like a date-only sentinel rather than a
 * captured wall-clock time: midnight to the second.
 */
function isMidnightExifDateTime(value: ExifDateTime): boolean {
	return value.hour === 0 && value.minute === 0 && value.second === 0;
}

function confidenceOf(value: unknown): MetadataConfidence {
	if (value instanceof ExifDate) {
		return 'date-only';
	}
	if (value instanceof ExifDateTime && isMidnightExifDateTime(value)) {
		return 'date-only';
	}
	return 'high';
}

/**
 * True when this candidate's wall-clock is a real local time rather than a
 * defaulted-UTC value that had to be shifted into the home zone. An explicit
 * EXIF "...Z" (zone known, `inferredZone === false`) counts as a real zone.
 */
function hasRealZone(value: unknown): boolean {
	if (value instanceof ExifDateTime) {
		return !isDefaultedUtc(value);
	}
	return true;
}

/**
 * True when the candidate carries a real captured wall-clock time, not a
 * midnight or date-only sentinel.
 */
function hasRealTime(value: unknown): boolean {
	return confidenceOf(value) === 'high';
}

/**
 * Pull the most trustworthy capture date out of a file's metadata tags,
 * normalized to local wall-clock parts in `homeZone`.
 *
 * Every {@link DATE_TAGS} entry is scored on two axes:
 *   1. real wall-clock time (non-midnight) beats date-only/midnight sentinels
 *   2. an explicit or recovered timezone beats a defaulted-UTC value
 *
 * The {@link DATE_TAGS} order acts as a tie-breaker. This lets a real
 * `CreateDate` override a midnight `DateTimeOriginal`, while still preferring
 * `SubSecDateTimeOriginal` over `DateTimeOriginal` when they are equivalent.
 */
export function extractMetadataDate(tags: Tags, homeZone: string): MetadataDate | null {
	type Candidate = {
		date: DateParts;
		tag: (typeof DATE_TAGS)[number];
		raw: unknown;
	};

	const candidates: Candidate[] = [];
	for (const tag of DATE_TAGS) {
		const raw = tags[tag];
		const date = toLocalDateParts(raw, homeZone);
		if (date !== null) {
			candidates.push({date, tag, raw});
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	// `candidates` is already in DATE_TAGS order, so the reduce keeps the
	// earlier-listed tag whenever the time-then-zone scores tie.
	const best = candidates.reduce((winner, current) => {
		if (hasRealTime(current.raw) !== hasRealTime(winner.raw)) {
			return hasRealTime(current.raw) ? current : winner;
		}
		if (hasRealZone(current.raw) !== hasRealZone(winner.raw)) {
			return hasRealZone(current.raw) ? current : winner;
		}
		return winner;
	});

	return {date: best.date, tag: best.tag, confidence: confidenceOf(best.raw)};
}
