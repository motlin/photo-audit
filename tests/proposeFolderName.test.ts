import {describe, expect, it} from 'vitest';
import type {DateParts} from '../src/dateParts.ts';
import {proposeFolderName} from '../src/proposeName.ts';

const dateOnly = (year: number, month: number, day: number): DateParts => ({
	year,
	month,
	day,
	time: null,
});

describe('proposeFolderName', () => {
	it('replaces a leading ISO date and keeps the title suffix', () => {
		expect(proposeFolderName('2020-11-02 Genesis School Photos', dateOnly(2020, 10, 18))).toBe(
			'2020-10-18 Genesis School Photos',
		);
	});

	it('replaces a compact date and keeps the title suffix', () => {
		expect(proposeFolderName('20201102 Genesis School Photos', dateOnly(2020, 10, 18))).toBe(
			'2020-10-18 Genesis School Photos',
		);
	});

	it('prepends the date when the folder has no title (just a bare date)', () => {
		expect(proposeFolderName('2020-11-02', dateOnly(2020, 10, 18))).toBe('2020-10-18');
	});

	it('prepends the date when the folder name has no leading date at all', () => {
		expect(proposeFolderName('Genesis School Photos', dateOnly(2020, 10, 18))).toBe(
			'2020-10-18 Genesis School Photos',
		);
	});

	it('drops any time component from metadata (folders are day-precision)', () => {
		expect(
			proposeFolderName('2020-11-02 Genesis School Photos', {
				year: 2020,
				month: 10,
				day: 18,
				time: {hour: 12, minute: 34, second: 56},
			}),
		).toBe('2020-10-18 Genesis School Photos');
	});
});
