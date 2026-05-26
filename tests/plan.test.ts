import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {parsePlan, readPlanFile, writePlanFile} from '../src/plan.ts';

describe('parsePlan', () => {
	it('returns an empty list for empty input', () => {
		expect(parsePlan('')).toEqual([]);
		expect(parsePlan('\n\n')).toEqual([]);
	});

	it('parses one JSON entry per non-blank line', () => {
		const content =
			'{"from":"/a/foo.jpg","to":"/a/2024-01-02 foo.jpg","kind":"WRONG_DATE"}\n' +
			'{"from":"/a/bar.jpg","to":"/a/2024-01-03 bar.jpg","kind":"MISSING_DATE"}\n';
		expect(parsePlan(content)).toEqual([
			{from: '/a/foo.jpg', to: '/a/2024-01-02 foo.jpg', kind: 'WRONG_DATE'},
			{from: '/a/bar.jpg', to: '/a/2024-01-03 bar.jpg', kind: 'MISSING_DATE'},
		]);
	});

	it('throws when a non-blank line is not valid JSON', () => {
		expect(() => parsePlan('{"from":"/x"\nnot json')).toThrow();
	});
});

describe('writePlanFile and readPlanFile', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-plan-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('writes entries as JSON-Lines that round-trip through readPlanFile', async () => {
		const entries = [
			{from: '/a/foo.jpg', to: '/a/2024-01-02 foo.jpg', kind: 'WRONG_DATE' as const},
			{from: '/a/bar.jpg', to: '/a/2024-01-03 bar.jpg', kind: 'MISSING_DATE' as const},
		];
		const path = join(dir, 'plan.jsonl');
		await writePlanFile(path, entries);
		const raw = await readFile(path, 'utf8');
		expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
		expect(await readPlanFile(path)).toEqual(entries);
	});

	it('readPlanFile returns an empty list when the file does not exist', async () => {
		expect(await readPlanFile(join(dir, 'missing.jsonl'))).toEqual([]);
	});

	it('readPlanFile respects user edits (e.g. removed lines)', async () => {
		const path = join(dir, 'plan.jsonl');
		await writeFile(path, '{"from":"/a/keep.jpg","to":"/a/2024-01-02 keep.jpg","kind":"WRONG_DATE"}\n');
		expect(await readPlanFile(path)).toEqual([
			{from: '/a/keep.jpg', to: '/a/2024-01-02 keep.jpg', kind: 'WRONG_DATE'},
		]);
	});
});
