import {ExifDate, ExifDateTime, type Tags} from 'exiftool-vendored';
import {describe, expect, it} from 'vitest';
import {
	extractCameraInfo,
	extractMetadataDate,
	extractDateOrEdit,
	formatCameraSuffix,
	toLocalDateParts,
} from '../src/metadata.ts';

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

	it('ignores edit-only tags like ModifyDate even when no capture tag is present', () => {
		// Photoshop-edited file: no capture tag at all, only edit-session tags.
		const modify = new ExifDateTime(
			2018,
			4,
			20,
			21,
			53,
			52,
			undefined,
			-240,
			'2018:04:20 21:53:52-04:00',
			'UTC-4',
			false,
		);
		const tags = {
			ModifyDate: modify,
			Software: 'Adobe Photoshop CC 2015.5 (Windows)',
		} as unknown as Tags;
		const result = extractMetadataDate(tags, 'America/New_York');
		expect(result).toBeNull();
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

describe('extractDateOrEdit', () => {
	it('returns a capture metadata value when capture tags are present', () => {
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
		const result = extractDateOrEdit(tags, 'America/New_York');
		expect(result?.kind).toBe('capture');
		if (result?.kind === 'capture') {
			expect(result.metadata.tag).toBe('DateTimeOriginal');
			expect(result.metadata.confidence).toBe('high');
		}
	});

	it('returns null when there are no capture or edit tags at all', () => {
		const tags = {} as unknown as Tags;
		expect(extractDateOrEdit(tags, 'America/New_York')).toBeNull();
	});

	it("returns an 'edit-derived' value when only edit tags + editing software are present", () => {
		// Adobe Photoshop edit of an older photo: no DateTimeOriginal at all,
		// just XMP CreateDate (first edit save) and ModifyDate (last edit).
		const firstEdit = new ExifDateTime(
			2018,
			4,
			20,
			21,
			53,
			52,
			undefined,
			-240,
			'2018:04:20 21:53:52-04:00',
			'UTC-4',
			false,
		);
		const lastEdit = new ExifDateTime(
			2018,
			4,
			21,
			9,
			28,
			45,
			undefined,
			-240,
			'2018:04:21 09:28:45-04:00',
			'UTC-4',
			false,
		);
		const tags = {
			ModifyDate: lastEdit,
			MetadataDate: lastEdit,
			Software: 'Adobe Photoshop CC 2015.5 (Windows)',
			History: [
				{Action: 'saved', When: firstEdit},
				{Action: 'saved', When: lastEdit},
			],
		} as unknown as Tags;
		const result = extractDateOrEdit(tags, 'America/New_York');
		expect(result?.kind).toBe('edit-derived');
		if (result?.kind === 'edit-derived') {
			expect(result.software).toBe('Adobe Photoshop CC 2015.5 (Windows)');
			expect(result.firstEdit).toEqual({
				year: 2018,
				month: 4,
				day: 20,
				time: {hour: 21, minute: 53, second: 52},
			});
			expect(result.lastEdit).toEqual({
				year: 2018,
				month: 4,
				day: 21,
				time: {hour: 9, minute: 28, second: 45},
			});
		}
	});

	it('recognizes Lightroom as edit software', () => {
		const modify = new ExifDateTime(2019, 1, 1, 12, 0, 0, undefined, 0, '2019:01:01 12:00:00Z', 'UTC', false);
		const tags = {
			ModifyDate: modify,
			CreatorTool: 'Adobe Lightroom Classic 9.0',
		} as unknown as Tags;
		const result = extractDateOrEdit(tags, 'America/New_York');
		expect(result?.kind).toBe('edit-derived');
		if (result?.kind === 'edit-derived') {
			expect(result.software).toBe('Adobe Lightroom Classic 9.0');
		}
	});

	it('does not flag edit-derived when capture tags are also present', () => {
		// File has both DateTimeOriginal AND edit tags + Photoshop Software:
		// this is the common "I edited a photo but kept the original capture
		// timestamp" case. The capture date wins.
		const capture = new ExifDateTime(
			2018,
			1,
			1,
			10,
			0,
			0,
			undefined,
			-300,
			'2018:01:01 10:00:00-05:00',
			'UTC-5',
			false,
		);
		const modify = new ExifDateTime(
			2020,
			6,
			15,
			14,
			30,
			0,
			undefined,
			-240,
			'2020:06:15 14:30:00-04:00',
			'UTC-4',
			false,
		);
		const tags = {
			DateTimeOriginal: capture,
			ModifyDate: modify,
			Software: 'Adobe Photoshop CC 2015.5 (Windows)',
		} as unknown as Tags;
		const result = extractDateOrEdit(tags, 'America/New_York');
		expect(result?.kind).toBe('capture');
	});

	it('does not flag edit-derived when edit tags exist without recognized editing software', () => {
		// Plain camera JPEG: ModifyDate is set by the camera firmware to match
		// capture time. We require explicit editing software to avoid false
		// positives.
		const modify = new ExifDateTime(
			2020,
			1,
			1,
			10,
			0,
			0,
			undefined,
			-300,
			'2020:01:01 10:00:00-05:00',
			'UTC-5',
			false,
		);
		const tags = {
			ModifyDate: modify,
			Software: 'Canon EOS R5 firmware 1.6.0',
		} as unknown as Tags;
		const result = extractDateOrEdit(tags, 'America/New_York');
		expect(result).toBeNull();
	});
});

describe('extractCameraInfo', () => {
	it('returns trimmed Make and Model when both are present', () => {
		const tags = {Make: 'Apple', Model: 'iPhone 15 Pro'} as unknown as Tags;
		expect(extractCameraInfo(tags)).toEqual({make: 'Apple', model: 'iPhone 15 Pro'});
	});

	it('returns null fields when the tags are absent', () => {
		expect(extractCameraInfo({} as Tags)).toEqual({make: null, model: null});
	});

	it('treats empty strings and whitespace-only values as null', () => {
		const tags = {Make: '   ', Model: ''} as unknown as Tags;
		expect(extractCameraInfo(tags)).toEqual({make: null, model: null});
	});
});

describe('formatCameraSuffix', () => {
	it('returns null when both make and model are null', () => {
		expect(formatCameraSuffix({make: null, model: null})).toBeNull();
	});

	it('returns just the model when make is null', () => {
		expect(formatCameraSuffix({make: null, model: 'iPhone 15 Pro'})).toBe('iPhone 15 Pro');
	});

	it('returns just the make when model is null', () => {
		expect(formatCameraSuffix({make: 'Canon', model: null})).toBe('Canon');
	});

	it('combines make and model as "Make Model"', () => {
		expect(formatCameraSuffix({make: 'Apple', model: 'iPhone 15 Pro'})).toBe('Apple iPhone 15 Pro');
	});

	it('drops the make when the model already starts with it (e.g. Canon Canon EOS 5D)', () => {
		expect(formatCameraSuffix({make: 'Canon', model: 'Canon EOS 5D Mark IV'})).toBe('Canon EOS 5D Mark IV');
	});

	it('strips a "CORPORATION" suffix from the make (e.g. NIKON CORPORATION D850)', () => {
		expect(formatCameraSuffix({make: 'NIKON CORPORATION', model: 'D850'})).toBe('NIKON D850');
	});
});
