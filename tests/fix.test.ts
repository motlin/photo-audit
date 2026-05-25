import {describe, expect, it} from 'vitest';
import {collisionsIn, formatUndoLogEntry} from '../src/fix.ts';

describe('collisionsIn', () => {
	it('returns an empty set when every target is unique', () => {
		const collisions = collisionsIn([
			{from: '/a/one.jpg', to: '/a/2023-01-01 one.jpg'},
			{from: '/a/two.jpg', to: '/a/2023-01-02 two.jpg'},
		]);
		expect(collisions.size).toBe(0);
	});

	it('flags targets that appear more than once', () => {
		const collisions = collisionsIn([
			{from: '/a/one.jpg', to: '/a/2023-01-01 dup.jpg'},
			{from: '/a/two.jpg', to: '/a/2023-01-01 dup.jpg'},
			{from: '/a/three.jpg', to: '/a/2023-01-02 unique.jpg'},
		]);
		expect(collisions).toEqual(new Set(['/a/2023-01-01 dup.jpg']));
	});

	it('flags every duplicate target independently', () => {
		const collisions = collisionsIn([
			{from: '/a/1.jpg', to: '/a/x.jpg'},
			{from: '/a/2.jpg', to: '/a/x.jpg'},
			{from: '/a/3.jpg', to: '/a/y.jpg'},
			{from: '/a/4.jpg', to: '/a/y.jpg'},
		]);
		expect(collisions).toEqual(new Set(['/a/x.jpg', '/a/y.jpg']));
	});
});

describe('formatUndoLogEntry', () => {
	it('emits a single JSON line with absolute paths and ISO timestamp', () => {
		const entry = formatUndoLogEntry({
			from: '/photos/2024-10-11 153044 iMazing.MOV',
			to: '/photos/2023-05-26 18.29.41 iMazing.MOV',
			timestamp: '2026-05-25T10:00:00.000Z',
		});
		expect(entry).toBe(
			'{"timestamp":"2026-05-25T10:00:00.000Z","from":"/photos/2024-10-11 153044 iMazing.MOV","to":"/photos/2023-05-26 18.29.41 iMazing.MOV"}\n',
		);
	});

	it('produces output that round-trips through JSON.parse', () => {
		const entry = formatUndoLogEntry({
			from: '/a/x.jpg',
			to: '/a/y.jpg',
			timestamp: '2026-05-25T10:00:00.000Z',
		});
		expect(JSON.parse(entry)).toEqual({
			timestamp: '2026-05-25T10:00:00.000Z',
			from: '/a/x.jpg',
			to: '/a/y.jpg',
		});
	});
});
