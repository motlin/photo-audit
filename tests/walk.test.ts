import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {walkMedia} from '../src/walk.ts';

async function collect(root: string, excludeRoots: string[] = []): Promise<string[]> {
	const out: string[] = [];
	for await (const p of walkMedia(root, excludeRoots)) {
		out.push(p);
	}
	return out.sort();
}

describe('walkMedia', () => {
	let root: string;

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), 'walk-'));
		await mkdir(join(root, 'event'), {recursive: true});
		await mkdir(join(root, 'event', 'nested'), {recursive: true});
		await mkdir(join(root, 'Organized', '2020 Decade'), {recursive: true});
		await writeFile(join(root, 'top.jpg'), 'x');
		await writeFile(join(root, 'event', 'a.heic'), 'x');
		await writeFile(join(root, 'event', 'nested', 'b.mov'), 'x');
		await writeFile(join(root, 'event', 'notes.txt'), 'x');
		await writeFile(join(root, '.hidden.jpg'), 'x');
		await writeFile(join(root, 'Organized', '2020 Decade', 'linked.jpg'), 'x');
	});

	afterAll(async () => {
		const {rm} = await import('node:fs/promises');
		await rm(root, {recursive: true, force: true});
	});

	it('recursively yields media files and skips non-media and hidden entries', async () => {
		const found = await collect(root);
		expect(found).toEqual(
			[
				join(root, 'Organized', '2020 Decade', 'linked.jpg'),
				join(root, 'event', 'a.heic'),
				join(root, 'event', 'nested', 'b.mov'),
				join(root, 'top.jpg'),
			].sort(),
		);
	});

	it('skips an excluded subtree so the output hierarchy is not re-walked', async () => {
		const found = await collect(root, [join(root, 'Organized')]);
		expect(found).toEqual(
			[join(root, 'event', 'a.heic'), join(root, 'event', 'nested', 'b.mov'), join(root, 'top.jpg')].sort(),
		);
		expect(found).not.toContain(join(root, 'Organized', '2020 Decade', 'linked.jpg'));
	});

	it('skips every listed exclude root', async () => {
		const found = await collect(root, [join(root, 'Organized'), join(root, 'event')]);
		expect(found).toEqual([join(root, 'top.jpg')]);
	});
});
