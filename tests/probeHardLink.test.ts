import {mkdtemp, rm} from 'node:fs/promises';
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

	it('returns true on a filesystem that supports hard links (macOS tmpdir is APFS)', async () => {
		expect(await probeHardLinkSupport(dir)).toBe(true);
	});

	it('returns false when the directory does not exist', async () => {
		expect(await probeHardLinkSupport(join(dir, 'does-not-exist'))).toBe(false);
	});

	it('leaves the directory clean afterwards', async () => {
		await probeHardLinkSupport(dir);
		const {readdir} = await import('node:fs/promises');
		expect(await readdir(dir)).toEqual([]);
	});
});
