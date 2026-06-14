import {basename, dirname, extname, join} from 'node:path';
import type {ProposedRename} from './fix.ts';

export interface CollisionResolution {
	/** Candidates to link: deduped and, where needed, disambiguated. */
	resolved: ProposedRename[];
	/** True byte-duplicates that were intentionally dropped (one kept per content). */
	droppedDuplicates: ProposedRename[];
}

function stemOf(path: string): string {
	const base = basename(path);
	return base.slice(0, base.length - extname(base).length);
}

/**
 * Restore the source file's stem into a proposed name so two distinct files
 * that landed on the same target get unique paths. The stem goes just before
 * the `(camera)` bracket when present, otherwise before the extension:
 *   `2020-03-03 19.21.06 (iPhone 11 Pro).MOV`
 *     -> `2020-03-03 19.21.06 IMG_0001 (iPhone 11 Pro).MOV`
 */
function disambiguate(to: string, from: string): string {
	const dir = dirname(to);
	const base = basename(to);
	const ext = extname(base);
	const name = base.slice(0, base.length - ext.length);
	const stem = stemOf(from);
	const parenIdx = name.indexOf(' (');
	const newName =
		parenIdx === -1
			? `${name} ${stem}${ext}`
			: `${name.slice(0, parenIdx + 1)}${stem} ${name.slice(parenIdx + 1)}${ext}`;
	return join(dir, newName);
}

/**
 * Within one collision group, assign each candidate a content key. Files are
 * bucketed by size first; a size that only one file has is distinct content
 * (no hash needed), and only files that share a size are hashed. This keeps
 * the digest cost proportional to genuine same-size collisions.
 */
function contentKeys(
	group: readonly ProposedRename[],
	sizeOf: (path: string) => number,
	hashOf: (path: string) => string,
): Map<ProposedRename, string> {
	const bySize = new Map<number, ProposedRename[]>();
	for (const candidate of group) {
		const size = sizeOf(candidate.from);
		const list = bySize.get(size);
		if (list === undefined) {
			bySize.set(size, [candidate]);
		} else {
			list.push(candidate);
		}
	}
	const keys = new Map<ProposedRename, string>();
	for (const [size, sameSize] of bySize) {
		if (sameSize.length === 1) {
			keys.set(sameSize[0]!, `size:${size}`);
		} else {
			for (const candidate of sameSize) {
				keys.set(candidate, `size:${size}:hash:${hashOf(candidate.from)}`);
			}
		}
	}
	return keys;
}

/**
 * Resolve same-target collisions by content rather than dropping every member.
 * Within each group of candidates proposing the same `to`:
 *   - true byte-duplicates collapse to one kept entry; the redundant copies are
 *     returned in `droppedDuplicates`.
 *   - genuinely distinct survivors are disambiguated by restoring the source
 *     stem, so all of them are kept with unique paths.
 * Non-colliding candidates pass through unchanged. `sizeOf`/`hashOf` are only
 * consulted for colliding candidates, and `hashOf` only for same-size files.
 */
export function resolveCollisions(
	candidates: readonly ProposedRename[],
	sizeOf: (path: string) => number,
	hashOf: (path: string) => string,
): CollisionResolution {
	const byTarget = new Map<string, ProposedRename[]>();
	for (const candidate of candidates) {
		const list = byTarget.get(candidate.to);
		if (list === undefined) {
			byTarget.set(candidate.to, [candidate]);
		} else {
			list.push(candidate);
		}
	}

	const resolved: ProposedRename[] = [];
	const droppedDuplicates: ProposedRename[] = [];
	for (const group of byTarget.values()) {
		if (group.length === 1) {
			resolved.push(group[0]!);
			continue;
		}
		const keys = contentKeys(group, sizeOf, hashOf);
		const keptByContent = new Map<string, ProposedRename>();
		for (const candidate of group) {
			const key = keys.get(candidate)!;
			if (keptByContent.has(key)) {
				droppedDuplicates.push(candidate);
			} else {
				keptByContent.set(key, candidate);
			}
		}
		const survivors = [...keptByContent.values()];
		if (survivors.length === 1) {
			resolved.push(survivors[0]!);
		} else {
			for (const candidate of survivors) {
				resolved.push({from: candidate.from, to: disambiguate(candidate.to, candidate.from)});
			}
		}
	}
	return {resolved, droppedDuplicates};
}
