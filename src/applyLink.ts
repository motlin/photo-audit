import {access, appendFile, link} from 'node:fs/promises';
import {collisionsIn, formatUndoLogEntry, type ProposedRename} from './fix.ts';

export type ApplyLinkOutcome =
	| {kind: 'linked'; from: string; to: string}
	| {kind: 'skipped-collision'; from: string; to: string}
	| {kind: 'skipped-exists'; from: string; to: string};

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Add a hard link at `to` pointing to the same inode as `from`, then append
 * an entry to the undo log. The original file at `from` is untouched.
 * Caller-supplied `timestamp` keeps this function deterministic for tests.
 */
async function linkOne(candidate: ProposedRename, undoLogPath: string, timestamp: string): Promise<ApplyLinkOutcome> {
	if (await pathExists(candidate.to)) {
		return {kind: 'skipped-exists', from: candidate.from, to: candidate.to};
	}
	await link(candidate.from, candidate.to);
	await appendFile(undoLogPath, formatUndoLogEntry({timestamp, from: candidate.from, to: candidate.to}));
	return {kind: 'linked', from: candidate.from, to: candidate.to};
}

/**
 * Apply every candidate in order, hard-linking `from` -> `to`. Candidates
 * whose target collides with another candidate, or where the target already
 * exists on disk, are skipped and reported in the result.
 */
export async function applyLinks(
	candidates: readonly ProposedRename[],
	undoLogPath: string,
	timestamp: () => string,
): Promise<ApplyLinkOutcome[]> {
	const collisions = collisionsIn(candidates);
	const outcomes: ApplyLinkOutcome[] = [];
	for (const candidate of candidates) {
		if (collisions.has(candidate.to)) {
			outcomes.push({kind: 'skipped-collision', from: candidate.from, to: candidate.to});
			continue;
		}
		outcomes.push(await linkOne(candidate, undoLogPath, timestamp()));
	}
	return outcomes;
}
