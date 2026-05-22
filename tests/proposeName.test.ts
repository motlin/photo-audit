import {describe, expect, it} from 'vitest';
import type {DateParts} from '../src/dateParts.ts';
import {proposeFilename} from '../src/proposeName.ts';

const dateTime = (
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
): DateParts => ({
	year,
	month,
	day,
	time: {hour, minute, second},
});

const dateOnly = (year: number, month: number, day: number): DateParts => ({
	year,
	month,
	day,
	time: null,
});

describe('proposeFilename', () => {
	it('prepends date and time to an unlabeled file', () => {
		expect(proposeFilename('ZinaBolotnovaPhotography-11.jpg', dateTime(2021, 4, 24, 4, 50, 29))).toBe(
			'2021-04-24 045029 ZinaBolotnovaPhotography-11.jpg',
		);
	});

	it('replaces a wrong leading date+time and keeps the rest of the name', () => {
		expect(proposeFilename('2024-10-11 153044 iMazing.MOV', dateTime(2023, 5, 26, 18, 29, 41))).toBe(
			'2023-05-26 182941 iMazing.MOV',
		);
	});

	it('replaces a wrong leading compact date', () => {
		expect(proposeFilename('20240101_120000 trip.jpg', dateTime(2023, 7, 4, 9, 15, 0))).toBe(
			'2023-07-04 091500 trip.jpg',
		);
	});

	it('keeps seconds even when the time is midnight, so same-day files stay distinct', () => {
		expect(proposeFilename('a.jpg', dateTime(2020, 10, 18, 0, 0, 0))).toBe('2020-10-18 000000 a.jpg');
	});

	it('prepends when the file has no extension', () => {
		expect(proposeFilename('snapshot', dateTime(2024, 1, 2, 8, 0, 0))).toBe('2024-01-02 080000 snapshot');
	});

	it('uses just date and time when the name is nothing but a wrong date', () => {
		expect(proposeFilename('2024-10-11.jpg', dateTime(2023, 5, 26, 18, 29, 41))).toBe('2023-05-26 182941.jpg');
	});

	it('falls back to date only when metadata carries no time', () => {
		expect(proposeFilename('scan.jpg', dateOnly(2010, 3, 3))).toBe('2010-03-03 scan.jpg');
	});
});
