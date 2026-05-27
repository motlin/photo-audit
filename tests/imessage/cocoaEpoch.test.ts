import {describe, expect, it} from 'vitest';
import {cocoaNanosToDate, cocoaSecondsToDate} from '../../src/imessage/cocoaEpoch.ts';

describe('cocoaSecondsToDate', () => {
	it('converts a known Cocoa-epoch seconds value to the matching UTC Date', () => {
		expect(cocoaSecondsToDate(756262242)).toEqual(new Date('2024-12-19T00:50:42.000Z'));
	});

	it('returns null for null input', () => {
		expect(cocoaSecondsToDate(null)).toBeNull();
	});

	it('returns null for 0 (Apple sentinel for unset)', () => {
		expect(cocoaSecondsToDate(0)).toBeNull();
	});

	it('accepts bigint inputs (better-sqlite3 returns INTEGER as bigint)', () => {
		expect(cocoaSecondsToDate(756262242n)).toEqual(new Date('2024-12-19T00:50:42.000Z'));
	});

	it('returns null for 0n bigint', () => {
		expect(cocoaSecondsToDate(0n)).toBeNull();
	});
});

describe('cocoaNanosToDate', () => {
	it('converts a known Cocoa-epoch nanoseconds value to the matching UTC Date', () => {
		expect(cocoaNanosToDate(756262242n * 1_000_000_000n)).toEqual(new Date('2024-12-19T00:50:42.000Z'));
	});

	it('returns null for null input', () => {
		expect(cocoaNanosToDate(null)).toBeNull();
	});

	it('returns null for 0 (Apple sentinel for unset)', () => {
		expect(cocoaNanosToDate(0)).toBeNull();
	});

	it('accepts bigint inputs and preserves millisecond precision', () => {
		expect(cocoaNanosToDate(756262242123n * 1_000_000n)).toEqual(new Date('2024-12-19T00:50:42.123Z'));
	});

	it('returns null for 0n bigint', () => {
		expect(cocoaNanosToDate(0n)).toBeNull();
	});

	it('accepts a plain number when within Number.MAX_SAFE_INTEGER', () => {
		expect(cocoaNanosToDate(756262242 * 1_000_000_000)).toEqual(new Date('2024-12-19T00:50:42.000Z'));
	});
});
