import {readFile, rmdir, stat, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {UndoLogEntry} from './fix.ts';

export type UndoOutcome =
	| {kind: 'unlinked'; from: string; to: string}
	| {kind: 'skipped-missing-target'; from: string; to: string}
	| {kind: 'skipped-missing-original'; from: string; to: string}
	| {kind: 'skipped-link-severed'; from: string; to: string};

/**
 * Read the JSON-Lines undo log at `path`. Returns an empty list when the file
 * does not exist (no prior --fix run, nothing to undo). Throws when a non-blank
 * line is not parseable, since a corrupted log should stop --undo loudly
 * rather than silently lose entries.
 */
export async function parseUndoLog(path: string): Promise<UndoLogEntry[]> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
	const entries: UndoLogEntry[] = [];
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') {
			continue;
		}
		entries.push(JSON.parse(trimmed) as UndoLogEntry);
	}
	return entries;
}

async function inodeOf(path: string): Promise<number | null> {
	try {
		return (await stat(path)).ino;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/**
 * Reverse the hard-link aliases recorded in `entries`. Each `to` is unlinked
 * only when it is still hard-linked to its corresponding `from` (same inode).
 * Other cases are skipped with a labelled reason so the caller can report them
 * without --undo destroying user-edited replacements.
 */
export async function applyUndo(entries: readonly UndoLogEntry[]): Promise<UndoOutcome[]> {
	const outcomes: UndoOutcome[] = [];
	for (const {from, to} of entries) {
		const toInode = await inodeOf(to);
		if (toInode === null) {
			outcomes.push({kind: 'skipped-missing-target', from, to});
			continue;
		}
		const fromInode = await inodeOf(from);
		if (fromInode === null) {
			outcomes.push({kind: 'skipped-missing-original', from, to});
			continue;
		}
		if (fromInode !== toInode) {
			outcomes.push({kind: 'skipped-link-severed', from, to});
			continue;
		}
		await unlink(to);
		outcomes.push({kind: 'unlinked', from, to});
	}
	return outcomes;
}

/**
 * Walk up from the parent of `removedPath`, rmdir-ing each directory that is
 * now empty. Stops at `stopRoot` (exclusive) or at the first non-empty
 * directory. Uses rmdir, which fails on non-empty directories, so this is
 * safe to call against trees the user may have added unrelated files to.
 */
export async function removeEmptyAncestors(removedPath: string, stopRoot: string): Promise<void> {
	let dir = dirname(removedPath);
	while (dir !== stopRoot && dir !== dirname(dir)) {
		try {
			await rmdir(dir);
		} catch {
			return;
		}
		dir = dirname(dir);
	}
}
