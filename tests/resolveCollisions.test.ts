import {describe, expect, it} from 'vitest';
import type {ProposedRename} from '../src/fix.ts';
import {resolveCollisions} from '../src/resolveCollisions.ts';

const OUT = '/out/2020 Decade/2020/2020-03/2020-03-03 Home';
const target = `${OUT}/2020-03-03 19.21.06 (iPhone 11 Pro).MOV`;

function byTo(list: readonly ProposedRename[]): string[] {
	return list.map((r) => r.to).sort();
}

// Default fakes: every file is a distinct size (so hashOf is never needed).
const sizeByPath = (sizes: Record<string, number>) => (p: string) => sizes[p] ?? p.length;
const hashByPath = (hashes: Record<string, string>) => (p: string) => hashes[p] ?? p;

describe('resolveCollisions', () => {
	it('passes non-colliding candidates through unchanged', () => {
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_1.MOV', to: `${OUT}/x.MOV`},
			{from: '/src/b/IMG_2.MOV', to: `${OUT}/y.MOV`},
		];
		const {resolved, droppedDuplicates} = resolveCollisions(
			candidates,
			() => {
				throw new Error('sizeOf must not be called for non-colliding candidates');
			},
			() => 'unused',
		);
		expect(resolved).toEqual(candidates);
		expect(droppedDuplicates).toEqual([]);
	});

	it('disambiguates distinct-content files (distinct by size, no hashing) that share a target', () => {
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_0001.MOV', to: target},
			{from: '/src/b/IMG_0002.MOV', to: target},
		];
		const {resolved, droppedDuplicates} = resolveCollisions(
			candidates,
			sizeByPath({'/src/a/IMG_0001.MOV': 100, '/src/b/IMG_0002.MOV': 200}),
			() => {
				throw new Error('hashOf must not be called when sizes already differ');
			},
		);
		expect(droppedDuplicates).toEqual([]);
		expect(byTo(resolved)).toEqual([
			`${OUT}/2020-03-03 19.21.06 IMG_0001 (iPhone 11 Pro).MOV`,
			`${OUT}/2020-03-03 19.21.06 IMG_0002 (iPhone 11 Pro).MOV`,
		]);
	});

	it('hashes same-size files and keeps both when their content differs', () => {
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_0001.MOV', to: target},
			{from: '/src/b/IMG_0002.MOV', to: target},
		];
		const {resolved, droppedDuplicates} = resolveCollisions(
			candidates,
			() => 500,
			hashByPath({'/src/a/IMG_0001.MOV': 'hashA', '/src/b/IMG_0002.MOV': 'hashB'}),
		);
		expect(droppedDuplicates).toEqual([]);
		expect(byTo(resolved)).toEqual([
			`${OUT}/2020-03-03 19.21.06 IMG_0001 (iPhone 11 Pro).MOV`,
			`${OUT}/2020-03-03 19.21.06 IMG_0002 (iPhone 11 Pro).MOV`,
		]);
	});

	it('drops true byte-duplicates (same size, same hash), keeping one at the clean name', () => {
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_0001.MOV', to: target},
			{from: '/src/b/IMG_0002.MOV', to: target},
		];
		const {resolved, droppedDuplicates} = resolveCollisions(
			candidates,
			() => 500,
			() => 'sameHash',
		);
		expect(resolved).toEqual([{from: '/src/a/IMG_0001.MOV', to: target}]);
		expect(droppedDuplicates).toEqual([{from: '/src/b/IMG_0002.MOV', to: target}]);
	});

	it('handles a mixed group: dedup the duplicate, disambiguate the distinct survivors', () => {
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_0001.MOV', to: target},
			{from: '/src/b/IMG_0002.MOV', to: target},
			{from: '/src/c/IMG_0003.MOV', to: target},
		];
		// All same size; IMG_0001 and IMG_0002 are byte-identical, IMG_0003 distinct.
		const {resolved, droppedDuplicates} = resolveCollisions(
			candidates,
			() => 500,
			hashByPath({
				'/src/a/IMG_0001.MOV': 'hashA',
				'/src/b/IMG_0002.MOV': 'hashA',
				'/src/c/IMG_0003.MOV': 'hashB',
			}),
		);
		expect(droppedDuplicates).toEqual([{from: '/src/b/IMG_0002.MOV', to: target}]);
		expect(byTo(resolved)).toEqual([
			`${OUT}/2020-03-03 19.21.06 IMG_0001 (iPhone 11 Pro).MOV`,
			`${OUT}/2020-03-03 19.21.06 IMG_0003 (iPhone 11 Pro).MOV`,
		]);
	});

	it('appends the stem before the extension when the name has no camera bracket', () => {
		const noCam = `${OUT}/2013-11-24 14.38.29.PNG`;
		const candidates: ProposedRename[] = [
			{from: '/src/a/IMG_0001.PNG', to: noCam},
			{from: '/src/b/IMG_0002.PNG', to: noCam},
		];
		const {resolved} = resolveCollisions(
			candidates,
			sizeByPath({'/src/a/IMG_0001.PNG': 1, '/src/b/IMG_0002.PNG': 2}),
			() => 'unused',
		);
		expect(byTo(resolved)).toEqual([
			`${OUT}/2013-11-24 14.38.29 IMG_0001.PNG`,
			`${OUT}/2013-11-24 14.38.29 IMG_0002.PNG`,
		]);
	});
});
