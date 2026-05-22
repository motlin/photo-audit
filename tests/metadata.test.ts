import {ExifDate, ExifDateTime} from 'exiftool-vendored';
import {describe, expect, it} from 'vitest';
import {toLocalDateParts} from '../src/metadata.ts';

// ExifDateTime constructor:
//   year, month, day, hour, minute, second, millisecond?, tzoffsetMinutes?,
//   rawValue?, zoneName?, inferredZone?

describe('toLocalDateParts', () => {
	it('converts a defaulted-UTC video date to the home timezone', () => {
		// QuickTime CreateDate stored in UTC; exiftool-vendored could not find a
		// real zone, so it defaulted to UTC (inferredZone === true).
		const defaultedUtc = new ExifDateTime(2019, 2, 11, 4, 49, 44, undefined, 0, '2019:02:11 04:49:44', 'UTC', true);
		expect(toLocalDateParts(defaultedUtc, 'America/New_York')).toEqual({
			year: 2019,
			month: 2,
			day: 10,
			time: {hour: 23, minute: 49, second: 44},
		});
	});

	it('uses an explicit-offset date as-is, never shifting to the home zone', () => {
		// QuickTime CreationDate carries a real offset; its wall-clock is already
		// the capture-local date, regardless of where the library owner lives.
		const zoned = new ExifDateTime(
			2023,
			5,
			26,
			18,
			29,
			41,
			undefined,
			-240,
			'2023:05:26 18:29:41-04:00',
			'UTC-4',
			false,
		);
		expect(toLocalDateParts(zoned, 'America/Los_Angeles')).toEqual({
			year: 2023,
			month: 5,
			day: 26,
			time: {hour: 18, minute: 29, second: 41},
		});
	});

	it('uses a backfilled real-zone date as-is', () => {
		// exiftool-vendored recovered the true zone from a sibling tag, so the
		// wall-clock is already correct even though inferredZone is true.
		const backfilled = new ExifDateTime(
			2023,
			5,
			26,
			18,
			29,
			41,
			undefined,
			-240,
			'2023:05:26 22:29:41',
			'America/New_York',
			true,
		);
		expect(toLocalDateParts(backfilled, 'America/Los_Angeles')).toEqual({
			year: 2023,
			month: 5,
			day: 26,
			time: {hour: 18, minute: 29, second: 41},
		});
	});

	it('uses an explicitly-UTC EXIF date as-is (the photographer meant that date)', () => {
		// JPG DateTimeOriginal written as "...Z": the zone is explicit, not
		// defaulted, so the date label is taken at face value.
		const explicitUtc = new ExifDateTime(2020, 10, 18, 0, 0, 0, undefined, 0, '2020-10-18T00:00:00Z', 'UTC', false);
		expect(toLocalDateParts(explicitUtc, 'America/New_York')).toEqual({
			year: 2020,
			month: 10,
			day: 18,
			time: {hour: 0, minute: 0, second: 0},
		});
	});

	it('handles a date-only ExifDate', () => {
		expect(toLocalDateParts(new ExifDate(2010, 3, 3), 'America/New_York')).toEqual({
			year: 2010,
			month: 3,
			day: 3,
			time: null,
		});
	});

	it('returns null for non-date values', () => {
		expect(toLocalDateParts(undefined, 'America/New_York')).toBeNull();
		expect(toLocalDateParts('2020:01:01', 'America/New_York')).toBeNull();
	});
});
