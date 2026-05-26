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

const dateTimeMs = (
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
	millisecond: number,
): DateParts => ({
	year,
	month,
	day,
	time: {hour, minute, second, millisecond},
});

describe('proposeFilename', () => {
	it('prepends date and time to an unlabeled file', () => {
		expect(proposeFilename('ZinaBolotnovaPhotography-11.jpg', dateTime(2021, 4, 24, 4, 50, 29))).toBe(
			'2021-04-24 04.50.29 ZinaBolotnovaPhotography-11.jpg',
		);
	});

	it('replaces a wrong leading date+time and keeps the rest of the name', () => {
		expect(proposeFilename('2024-10-11 153044 iMazing.MOV', dateTime(2023, 5, 26, 18, 29, 41))).toBe(
			'2023-05-26 18.29.41 iMazing.MOV',
		);
	});

	it('replaces a wrong leading compact date', () => {
		expect(proposeFilename('20240101_120000 trip.jpg', dateTime(2023, 7, 4, 9, 15, 0))).toBe(
			'2023-07-04 09.15.00 trip.jpg',
		);
	});

	it('replaces a leading date already in HH.MM.SS form', () => {
		expect(proposeFilename('2024-10-11 15.30.44 iMazing.MOV', dateTime(2023, 5, 26, 18, 29, 41))).toBe(
			'2023-05-26 18.29.41 iMazing.MOV',
		);
	});

	it('keeps seconds even when the time is midnight, so same-day files stay distinct', () => {
		expect(proposeFilename('a.jpg', dateTime(2020, 10, 18, 0, 0, 0))).toBe('2020-10-18 00.00.00 a.jpg');
	});

	it('prepends when the file has no extension', () => {
		expect(proposeFilename('snapshot', dateTime(2024, 1, 2, 8, 0, 0))).toBe('2024-01-02 08.00.00 snapshot');
	});

	it('uses just date and time when the name is nothing but a wrong date', () => {
		expect(proposeFilename('2024-10-11.jpg', dateTime(2023, 5, 26, 18, 29, 41))).toBe('2023-05-26 18.29.41.jpg');
	});

	it('falls back to date only when metadata carries no time', () => {
		expect(proposeFilename('scan.jpg', dateOnly(2010, 3, 3))).toBe('2010-03-03 scan.jpg');
	});

	it('uses sub-second precision to keep burst-mode frames distinct', () => {
		const first = proposeFilename('IMG_0001.jpg', dateTimeMs(2024, 7, 4, 12, 0, 0, 123));
		const second = proposeFilename('IMG_0002.jpg', dateTimeMs(2024, 7, 4, 12, 0, 0, 456));
		expect(first).toBe('2024-07-04 12.00.00.123 IMG_0001.jpg');
		expect(second).toBe('2024-07-04 12.00.00.456 IMG_0002.jpg');
		expect(first).not.toBe(second);
	});

	it('replaces a leading date that already carries .SSS sub-seconds', () => {
		expect(proposeFilename('2024-10-11 15.30.44.999 iMazing.MOV', dateTimeMs(2023, 5, 26, 18, 29, 41, 250))).toBe(
			'2023-05-26 18.29.41.250 iMazing.MOV',
		);
	});

	it('strips camera-ID stems like IMG_063842 when stripCameraId is true', () => {
		expect(proposeFilename('IMG_063842.jpg', dateTimeMs(2024, 1, 2, 7, 25, 16, 395), {stripCameraId: true})).toBe(
			'2024-01-02 07.25.16.395.jpg',
		);
	});

	it('strips DSC_/DSCF/DSCN patterns from Nikon/Sony/Fujifilm cameras', () => {
		expect(proposeFilename('DSC_1234.JPG', dateTime(2020, 5, 1, 10, 0, 0), {stripCameraId: true})).toBe(
			'2020-05-01 10.00.00.JPG',
		);
		expect(proposeFilename('DSCF0001.JPG', dateTime(2020, 5, 1, 10, 0, 0), {stripCameraId: true})).toBe(
			'2020-05-01 10.00.00.JPG',
		);
		expect(proposeFilename('DSCN9999.JPG', dateTime(2020, 5, 1, 10, 0, 0), {stripCameraId: true})).toBe(
			'2020-05-01 10.00.00.JPG',
		);
	});

	it('strips PXL_ Google Pixel naming', () => {
		expect(
			proposeFilename('PXL_20240315_182434523.jpg', dateTime(2024, 3, 15, 18, 24, 34), {stripCameraId: true}),
		).toBe('2024-03-15 18.24.34.jpg');
	});

	it('keeps human-meaningful names even with stripCameraId enabled', () => {
		expect(proposeFilename('vacation-cabo.jpg', dateTime(2024, 1, 2, 7, 25, 16), {stripCameraId: true})).toBe(
			'2024-01-02 07.25.16 vacation-cabo.jpg',
		);
	});

	it('keeps the original stem by default (stripCameraId omitted)', () => {
		expect(proposeFilename('IMG_063842.jpg', dateTime(2024, 1, 2, 7, 25, 16))).toBe(
			'2024-01-02 07.25.16 IMG_063842.jpg',
		);
	});

	it('strips a camera-ID stem that follows a leading-date prefix', () => {
		expect(proposeFilename('2023-09-01 IMG_5555.jpg', dateTime(2024, 1, 2, 7, 25, 16), {stripCameraId: true})).toBe(
			'2024-01-02 07.25.16.jpg',
		);
	});
});
