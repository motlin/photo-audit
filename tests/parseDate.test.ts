import {describe, expect, it} from 'vitest';
import {parseDateFromString} from '../src/parseDate.ts';

describe('parseDateFromString', () => {
	it('parses an ISO date with compact time (iMazing export naming)', () => {
		expect(parseDateFromString('2024-10-11 153044 iMazing.MOV')).toEqual({
			year: 2024,
			month: 10,
			day: 11,
			time: {hour: 15, minute: 30, second: 44},
		});
	});

	it('parses a bare ISO date from a folder name', () => {
		expect(parseDateFromString('2023-05-26 - Palisades Park')).toEqual({
			year: 2023,
			month: 5,
			day: 26,
			time: null,
		});
	});

	it('parses a compact YYYYMMDD_HHMMSS Android-style filename', () => {
		expect(parseDateFromString('IMG_20130603_152246.jpg')).toEqual({
			year: 2013,
			month: 6,
			day: 3,
			time: {hour: 15, minute: 22, second: 46},
		});
	});

	it('parses an ISO date with dash-separated time', () => {
		expect(parseDateFromString('2013-06-03_17-18-14_803.jpg')).toEqual({
			year: 2013,
			month: 6,
			day: 3,
			time: {hour: 17, minute: 18, second: 14},
		});
	});

	it('parses an ISO date with dot-separated time (the format proposeFilename emits)', () => {
		expect(parseDateFromString('2021-04-24 04.50.29 ZinaBolotnovaPhotography-11.jpg')).toEqual({
			year: 2021,
			month: 4,
			day: 24,
			time: {hour: 4, minute: 50, second: 29},
		});
	});

	it('parses an ISO date with dot-separated time and sub-second .SSS suffix', () => {
		expect(parseDateFromString('2021-04-24 04.50.29.123 burst.jpg')).toEqual({
			year: 2021,
			month: 4,
			day: 24,
			time: {hour: 4, minute: 50, second: 29, millisecond: 123},
		});
	});

	it('parses a month-precision YYYY-MM folder', () => {
		expect(parseDateFromString('2022-06 Nadia Photo Shoot')).toEqual({
			year: 2022,
			month: 6,
			day: null,
			time: null,
		});
	});

	it('returns null when there is no date', () => {
		expect(parseDateFromString('IMG_4309.jpg')).toBeNull();
		expect(parseDateFromString('P1320671.jpg')).toBeNull();
		expect(parseDateFromString('Penn-Harvard Game [Mark]')).toBeNull();
	});

	it('does not mistake a year range for a date', () => {
		expect(parseDateFromString('2005-2013 Lightroom Catalog')).toBeNull();
		expect(parseDateFromString('2013-Present Lightroom Catalog')).toBeNull();
	});

	it('rejects impossible month/day values', () => {
		expect(parseDateFromString('2013-19-99 nonsense')).toBeNull();
		expect(parseDateFromString('99999999 digits')).toBeNull();
	});
});
