import {mkdtemp, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {probeHardLinkSupport} from '../src/probeHardLink.ts';

describe('probeHardLinkSupport', () => {
	let dir = '';
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-probe-'));
	});
	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('returns true when source and destination are on the same APFS volume', async () => {
		const sourceFile = join(dir, 'source.jpg');
		await writeFile(sourceFile, '');
		expect(await probeHardLinkSupport(sourceFile, dir)).toBe(true);
	});

	it('returns false when the destination directory does not exist', async () => {
		const sourceFile = join(dir, 'source.jpg');
		await writeFile(sourceFile, '');
		expect(await probeHardLinkSupport(sourceFile, join(dir, 'does-not-exist'))).toBe(false);
	});

	it('returns false when the source file does not exist', async () => {
		expect(await probeHardLinkSupport(join(dir, 'missing.jpg'), dir)).toBe(false);
	});

	it('leaves both directories clean afterwards', async () => {
		const sourceFile = join(dir, 'source.jpg');
		await writeFile(sourceFile, '');
		await probeHardLinkSupport(sourceFile, dir);
		expect(await readdir(dir)).toEqual(['source.jpg']);
	});
});
