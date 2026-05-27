import {link, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {applyUndo, parseUndoLog, removeEmptyAncestors} from '../src/applyUndo.ts';

describe('parseUndoLog', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-undo-parse-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('returns an empty list when the log does not exist', async () => {
		expect(await parseUndoLog(join(dir, 'missing.log'))).toEqual([]);
	});

	it('parses every JSON-Lines entry and skips blank lines', async () => {
		const log = join(dir, 'rename.log');
		await writeFile(
			log,
			'{"timestamp":"2026-05-26T10:00:00.000Z","from":"/a/x.jpg","to":"/a/y.jpg"}\n\n{"timestamp":"2026-05-26T10:00:01.000Z","from":"/a/p.jpg","to":"/a/q.jpg"}\n',
		);
		expect(await parseUndoLog(log)).toEqual([
			{timestamp: '2026-05-26T10:00:00.000Z', from: '/a/x.jpg', to: '/a/y.jpg'},
			{timestamp: '2026-05-26T10:00:01.000Z', from: '/a/p.jpg', to: '/a/q.jpg'},
		]);
	});

	it('throws when a non-blank line is not valid JSON', async () => {
		const log = join(dir, 'bad.log');
		await writeFile(log, '{"from":"/a/x.jpg","to":"/a/y.jpg"}\nnot json\n');
		await expect(parseUndoLog(log)).rejects.toThrow();
	});
});

describe('applyUndo', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-undo-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('unlinks the `to` path when it is still hard-linked to the `from` path', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(from, 'pixels');
		await link(from, to);

		const outcomes = await applyUndo([{timestamp: 't', from, to}]);

		expect(outcomes).toEqual([{kind: 'unlinked', from, to}]);
		await expect(stat(to)).rejects.toMatchObject({code: 'ENOENT'});
		expect(await readFile(from, 'utf8')).toBe('pixels');
	});

	it('skips when the target was already removed', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(from, 'pixels');

		const outcomes = await applyUndo([{timestamp: 't', from, to}]);

		expect(outcomes).toEqual([{kind: 'skipped-missing-target', from, to}]);
	});

	it('skips when the original is missing (cannot verify the link is safe to remove)', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(to, 'pixels');

		const outcomes = await applyUndo([{timestamp: 't', from, to}]);

		expect(outcomes).toEqual([{kind: 'skipped-missing-original', from, to}]);
		await expect(stat(to)).resolves.toBeDefined();
	});

	it('skips when `from` and `to` point to different inodes (link was severed)', async () => {
		const from = join(dir, 'a.jpg');
		const to = join(dir, '2024-01-02 a.jpg');
		await writeFile(from, 'original');
		await writeFile(to, 'replaced-with-different-content');

		const outcomes = await applyUndo([{timestamp: 't', from, to}]);

		expect(outcomes).toEqual([{kind: 'skipped-link-severed', from, to}]);
		expect(await readFile(to, 'utf8')).toBe('replaced-with-different-content');
	});

	it('processes multiple entries independently', async () => {
		const from1 = join(dir, 'a.jpg');
		const to1 = join(dir, '2024-01-02 a.jpg');
		const from2 = join(dir, 'b.jpg');
		const to2 = join(dir, '2024-01-03 b.jpg');
		await writeFile(from1, 'A');
		await link(from1, to1);
		await writeFile(from2, 'B');

		const outcomes = await applyUndo([
			{timestamp: 't1', from: from1, to: to1},
			{timestamp: 't2', from: from2, to: to2},
		]);

		expect(outcomes).toEqual([
			{kind: 'unlinked', from: from1, to: to1},
			{kind: 'skipped-missing-target', from: from2, to: to2},
		]);
	});
});

describe('removeEmptyAncestors', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-rmdir-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('removes empty parent directories up to (but not including) the stop root', async () => {
		const nested = join(dir, 'a', 'b', 'c');
		await mkdir(nested, {recursive: true});
		await removeEmptyAncestors(join(nested, 'gone.jpg'), dir);
		await expect(stat(join(dir, 'a'))).rejects.toMatchObject({code: 'ENOENT'});
		await expect(stat(dir)).resolves.toBeDefined();
	});

	it('stops at the first non-empty ancestor', async () => {
		const nested = join(dir, 'a', 'b', 'c');
		await mkdir(nested, {recursive: true});
		await writeFile(join(dir, 'a', 'sibling.jpg'), '');
		await removeEmptyAncestors(join(nested, 'gone.jpg'), dir);
		await expect(stat(join(dir, 'a', 'b'))).rejects.toMatchObject({code: 'ENOENT'});
		await expect(stat(join(dir, 'a'))).resolves.toBeDefined();
	});

	it('is a no-op when the parent does not exist', async () => {
		await expect(removeEmptyAncestors(join(dir, 'nope', 'file.jpg'), dir)).resolves.toBeUndefined();
	});
});
