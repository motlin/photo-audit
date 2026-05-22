import {ExifDate, ExifDateTime, type Tags} from 'exiftool-vendored';
import type {DateParts} from './dateParts.ts';

/**
 * Metadata tags holding a capture date, in priority order.
 *
 * `CreationDate` (QuickTime Keys) is timezone-aware and preferred for video.
 * `CreateDate` is listed last because for QuickTime it is stored in UTC and
 * can land a late-evening clip on the wrong calendar day.
 */
const DATE_TAGS = [
	'SubSecDateTimeOriginal',
	'DateTimeOriginal',
	'CreationDate',
	'CreateDate',
	'MediaCreateDate',
] as const satisfies readonly (keyof Tags)[];

function toDateParts(value: unknown): DateParts | null {
	if (value instanceof ExifDateTime || value instanceof ExifDate) {
		const {year, month, day} = value;
		if (year == null || month == null || day == null) {
			return null;
		}
		if (value instanceof ExifDate) {
			return {year, month, day, time: null};
		}
		return {
			year,
			month,
			day,
			time: {
				hour: value.hour ?? 0,
				minute: value.minute ?? 0,
				second: value.second ?? 0,
			},
		};
	}
	return null;
}

export interface MetadataDate {
	date: DateParts;
	/** Which metadata tag the date came from. */
	tag: string;
}

/** Pull the most trustworthy capture date out of a file's metadata tags. */
export function extractMetadataDate(tags: Tags): MetadataDate | null {
	for (const tag of DATE_TAGS) {
		const date = toDateParts(tags[tag]);
		if (date !== null) {
			return {date, tag};
		}
	}
	return null;
}
