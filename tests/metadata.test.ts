import {ExifDate, ExifDateTime, type Tags} from 'exiftool-vendored';
import {describe, expect, it} from 'vitest';
import {extractMetadataDate, toLocalDateParts} from '../src/metadata.ts';

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

describe('extractMetadataDate confidence', () => {
	it("flags a midnight ExifDateTime as 'date-only' low confidence", () => {
		const midnight = new ExifDateTime(2020, 10, 18, 0, 0, 0, undefined, 0, '2020-10-18T00:00:00Z', 'UTC', false);
		const tags = {DateTimeOriginal: midnight} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).not.toBeNull();
		expect(result?.confidence).toBe('date-only');
	});

	it("flags an ExifDate (no time component) as 'date-only' low confidence", () => {
		const tags = {DateTimeOriginal: new ExifDate(2021, 4, 12)} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).not.toBeNull();
		expect(result?.confidence).toBe('date-only');
	});

	it("flags an ExifDateTime with a real wall-clock time as 'high' confidence", () => {
		const wallClock = new ExifDateTime(
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
		const tags = {DateTimeOriginal: wallClock} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).not.toBeNull();
		expect(result?.confidence).toBe('high');
	});
});

describe('extractMetadataDate tag selection', () => {
	it('prefers a real-timestamp CreateDate over a midnight DateTimeOriginal', () => {
		// Real-world case from iMazing dump: DateTimeOriginal was a date-only
		// sentinel at midnight, while CreateDate carried the real capture time.
		const midnightOriginal = new ExifDateTime(
			2021,
			4,
			12,
			0,
			0,
			0,
			undefined,
			0,
			'2021:04:12 00:00:00Z',
			'UTC',
			false,
		);
		const realCreate = new ExifDateTime(2021, 5, 15, 15, 25, 0, undefined, 0, '2021:05:15 15:25:00Z', 'UTC', false);
		const tags = {
			DateTimeOriginal: midnightOriginal,
			CreateDate: realCreate,
		} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).not.toBeNull();
		expect(result?.tag).toBe('CreateDate');
		expect(result?.confidence).toBe('high');
		expect(result?.date).toEqual({
			year: 2021,
			month: 5,
			day: 15,
			time: {hour: 15, minute: 25, second: 0},
		});
	});

	it('prefers an explicit-offset CreationDate over a defaulted-UTC CreateDate', () => {
		const defaultedUtcCreate = new ExifDateTime(
			2019,
			2,
			11,
			4,
			49,
			44,
			undefined,
			0,
			'2019:02:11 04:49:44',
			'UTC',
			true,
		);
		const zonedCreation = new ExifDateTime(
			2019,
			2,
			10,
			23,
			49,
			44,
			undefined,
			-300,
			'2019:02:10 23:49:44-05:00',
			'UTC-5',
			false,
		);
		const tags = {
			CreateDate: defaultedUtcCreate,
			CreationDate: zonedCreation,
		} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/Los_Angeles');
		expect(result).not.toBeNull();
		expect(result?.tag).toBe('CreationDate');
		expect(result?.date).toEqual({
			year: 2019,
			month: 2,
			day: 10,
			time: {hour: 23, minute: 49, second: 44},
		});
	});

	it('falls back to precedence order when candidates tie on confidence and zone', () => {
		const subSec = new ExifDateTime(2022, 6, 1, 10, 0, 0, 500, -240, '2022:06:01 10:00:00.5-04:00', 'UTC-4', false);
		const original = new ExifDateTime(
			2022,
			6,
			1,
			10,
			0,
			0,
			undefined,
			-240,
			'2022:06:01 10:00:00-04:00',
			'UTC-4',
			false,
		);
		const tags = {
			SubSecDateTimeOriginal: subSec,
			DateTimeOriginal: original,
		} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result?.tag).toBe('SubSecDateTimeOriginal');
	});

	it("marks the picked date 'date-only' when every candidate is midnight", () => {
		const midnightOriginal = new ExifDateTime(
			2021,
			4,
			12,
			0,
			0,
			0,
			undefined,
			0,
			'2021:04:12 00:00:00Z',
			'UTC',
			false,
		);
		const midnightCreate = new ExifDateTime(
			2021,
			4,
			12,
			0,
			0,
			0,
			undefined,
			0,
			'2021:04:12 00:00:00Z',
			'UTC',
			false,
		);
		const tags = {
			DateTimeOriginal: midnightOriginal,
			CreateDate: midnightCreate,
		} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).not.toBeNull();
		expect(result?.confidence).toBe('date-only');
	});
});
