import {describe, expect, it} from 'vitest';
import {formatDate} from '../src/dateParts.ts';

describe('formatDate', () => {
	it('formats a month-precision date', () => {
		expect(formatDate({year: 2022, month: 6, day: null, time: null})).toBe('2022-06');
	});

	it('formats a day-precision date without time', () => {
		expect(formatDate({year: 2010, month: 3, day: 3, time: null})).toBe('2010-03-03');
	});

	it('formats a date with second-precision time', () => {
		expect(
			formatDate({
				year: 2021,
				month: 4,
				day: 24,
				time: {hour: 4, minute: 50, second: 29},
			}),
		).toBe('2021-04-24 04.50.29');
	});

	it('appends .SSS sub-seconds when millisecond is present', () => {
		expect(
			formatDate({
				year: 2021,
				month: 4,
				day: 24,
				time: {hour: 4, minute: 50, second: 29, millisecond: 123},
			}),
		).toBe('2021-04-24 04.50.29.123');
	});

	it('zero-pads millisecond to three digits', () => {
		expect(
			formatDate({
				year: 2021,
				month: 4,
				day: 24,
				time: {hour: 4, minute: 50, second: 29, millisecond: 7},
			}),
		).toBe('2021-04-24 04.50.29.007');
	});

	it('emits .000 when millisecond is explicitly zero (known precision, not absent)', () => {
		expect(
			formatDate({
				year: 2021,
				month: 4,
				day: 24,
				time: {hour: 4, minute: 50, second: 29, millisecond: 0},
			}),
		).toBe('2021-04-24 04.50.29.000');
	});

	it('omits the millisecond segment when the millisecond field is absent', () => {
		expect(
			formatDate({
				year: 2021,
				month: 4,
				day: 24,
				time: {hour: 4, minute: 50, second: 29},
			}),
		).toBe('2021-04-24 04.50.29');
	});
});
