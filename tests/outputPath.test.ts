import {describe, expect, it} from 'vitest';
import type {DateParts} from '../src/dateParts.ts';
import {computeOutputDirectory, pickDaySuffix} from '../src/outputPath.ts';

const date = (year: number, month: number, day: number): DateParts => ({
	year,
	month,
	day,
	time: {hour: 12, minute: 0, second: 0},
});

describe('pickDaySuffix', () => {
	it('returns the date-stripped folder title when it is meaningful', () => {
		expect(pickDaySuffix('2022-06 Nadia Photo Shoot', null)).toBe('Nadia Photo Shoot');
	});

	it('returns the folder title in preference to a place when both exist', () => {
		expect(pickDaySuffix('2022-06 Nadia Photo Shoot', 'Edgewater, NJ')).toBe('Nadia Photo Shoot');
	});

	it('strips bare-date folders to nothing and falls back to place', () => {
		expect(pickDaySuffix('2024-01-02', 'Edgewater, New Jersey, United States')).toBe(
			'Edgewater, New Jersey, United States',
		);
	});

	it('treats common dump-folder names as non-informative and falls back to place', () => {
		expect(pickDaySuffix('Image Capture', 'Edgewater, NJ')).toBe('Edgewater, NJ');
		expect(pickDaySuffix('Mobile Photos', 'Edgewater, NJ')).toBe('Edgewater, NJ');
		expect(pickDaySuffix('Screenshots', 'Edgewater, NJ')).toBe('Edgewater, NJ');
		expect(pickDaySuffix('iMazing', 'Edgewater, NJ')).toBe('Edgewater, NJ');
	});

	it('matches dump-folder names case-insensitively and ignores surrounding whitespace', () => {
		expect(pickDaySuffix('  image capture  ', 'Edgewater, NJ')).toBe('Edgewater, NJ');
	});

	it('returns null when no folder title and no place is available', () => {
		expect(pickDaySuffix('Image Capture', null)).toBeNull();
		expect(pickDaySuffix('2024-01-02', null)).toBeNull();
	});

	it('returns null when both source folder and place are null', () => {
		expect(pickDaySuffix(null, null)).toBeNull();
	});
});

describe('computeOutputDirectory', () => {
	it('groups by decade, year, year-month, and a day-folder', () => {
		expect(
			computeOutputDirectory({
				outputRoot: '/library',
				metadataDate: date(2024, 1, 2),
				sourceFolderName: null,
				place: null,
			}),
		).toBe('/library/2020 Decade/2024/2024-01/2024-01-02');
	});

	it('puts the place in the day-folder suffix when no informative source folder is present', () => {
		expect(
			computeOutputDirectory({
				outputRoot: '/library',
				metadataDate: date(2024, 1, 2),
				sourceFolderName: 'Image Capture',
				place: 'Edgewater, New Jersey, United States',
			}),
		).toBe('/library/2020 Decade/2024/2024-01/2024-01-02 Edgewater, New Jersey, United States');
	});

	it('prefers an informative folder title over a place', () => {
		expect(
			computeOutputDirectory({
				outputRoot: '/library',
				metadataDate: date(2022, 6, 4),
				sourceFolderName: '2022-06-04 Addams family shoot',
				place: 'Hopewell, NJ',
			}),
		).toBe('/library/2020 Decade/2022/2022-06/2022-06-04 Addams family shoot');
	});

	it('computes the decade by rounding the year down to the nearest ten', () => {
		expect(
			computeOutputDirectory({
				outputRoot: '/library',
				metadataDate: date(2015, 7, 16),
				sourceFolderName: null,
				place: null,
			}),
		).toBe('/library/2010 Decade/2015/2015-07/2015-07-16');
	});

	it('omits the day folder and suffix when includeDayFolder is false', () => {
		expect(
			computeOutputDirectory({
				outputRoot: '/out',
				metadataDate: date(2026, 5, 11),
				sourceFolderName: 'Motlins',
				place: null,
				includeDayFolder: false,
			}),
		).toBe('/out/2020 Decade/2026/2026-05');
	});
});
