import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {applyLinks} from '../src/applyLink.ts';

describe('applyLinks', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-link-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	const timestamp = () => '2026-05-26T10:00:00.000Z';
	const undoLog = () => join(dir, 'photo-audit-renames.log');

	it('creates a hard link at the target path pointing to the source inode', async () => {
		const from = join(dir, 'IMG_063842.jpg');
		const to = join(dir, '2024-01-02 07.25.16 IMG_063842.jpg');
		await writeFile(from, 'pixels');

		const outcomes = await applyLinks([{from, to}], undoLog(), timestamp);

		expect(outcomes).toEqual([{kind: 'linked', from, to}]);
		const [sourceStat, targetStat] = await Promise.all([stat(from), stat(to)]);
		expect(targetStat.ino).toBe(sourceStat.ino);
		expect(targetStat.nlink).toBeGreaterThanOrEqual(2);
	});

	it('keeps the original path readable after linking', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(from, 'original-bytes');

		await applyLinks([{from, to}], undoLog(), timestamp);

		expect(await readFile(from, 'utf8')).toBe('original-bytes');
		expect(await readFile(to, 'utf8')).toBe('original-bytes');
	});

	it('appends a JSON-Lines undo entry for every linked file', async () => {
		const from1 = join(dir, 'a.jpg');
		const to1 = join(dir, '2024-01-02 a.jpg');
		const from2 = join(dir, 'b.jpg');
		const to2 = join(dir, '2024-01-03 b.jpg');
		await writeFile(from1, 'A');
		await writeFile(from2, 'B');

		await applyLinks(
			[
				{from: from1, to: to1},
				{from: from2, to: to2},
			],
			undoLog(),
			timestamp,
		);

		const log = await readFile(undoLog(), 'utf8');
		const lines = log
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line) as {from: string; to: string});
		expect(lines).toEqual([
			{timestamp: '2026-05-26T10:00:00.000Z', from: from1, to: to1},
			{timestamp: '2026-05-26T10:00:00.000Z', from: from2, to: to2},
		]);
	});

	it('skips a candidate when the target already exists', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(from, 'A');
		await writeFile(to, 'pre-existing');

		const outcomes = await applyLinks([{from, to}], undoLog(), timestamp);

		expect(outcomes).toEqual([{kind: 'skipped-exists', from, to}]);
		expect(await readFile(to, 'utf8')).toBe('pre-existing');
	});

	it('skips every candidate whose proposed target collides with another candidate', async () => {
		const from1 = join(dir, 'first.jpg');
		const from2 = join(dir, 'second.jpg');
		const dup = join(dir, '2024-01-02 dup.jpg');
		await writeFile(from1, '1');
		await writeFile(from2, '2');

		const outcomes = await applyLinks(
			[
				{from: from1, to: dup},
				{from: from2, to: dup},
			],
			undoLog(),
			timestamp,
		);

		expect(outcomes).toEqual([
			{kind: 'skipped-collision', from: from1, to: dup},
			{kind: 'skipped-collision', from: from2, to: dup},
		]);
	});
});
