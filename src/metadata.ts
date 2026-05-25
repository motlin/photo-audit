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
 * Pull the most trustworthy capture date out of a file's metadata tags,
 * normalized to local wall-clock parts in `homeZone`.
 */
export function extractMetadataDate(tags: Tags, homeZone: string): MetadataDate | null {
	for (const tag of DATE_TAGS) {
		const raw = tags[tag];
		const date = toLocalDateParts(raw, homeZone);
		if (date !== null) {
			return {date, tag, confidence: confidenceOf(raw)};
		}
	}
	return null;
}
