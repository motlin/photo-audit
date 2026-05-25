/**
 * Pure helpers for the `--fix` rename mode. Filesystem and process side effects
 * live in `cli.ts`; this module exists so the planning logic can be unit-tested
 * without touching disk.
 */

import type {DateParts} from './dateParts.ts';

export interface ProposedRename {
	/** Absolute path of the existing file. */
	from: string;
	/** Absolute path the file would be renamed to. */
	to: string;
}

/** Default fraction of files that must agree before a folder rename is proposed. */
const FOLDER_CONSENSUS_THRESHOLD = 0.8;

/** One file's metadata date as a `YYYY-MM-DD` key. */
function dateKey(date: DateParts): string {
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');
	return `${pad(date.year, 4)}-${pad(date.month)}-${date.day === null ? '00' : pad(date.day)}`;
}

export interface FolderConsensus {
	/** The single calendar date the majority of files agree on. */
	date: DateParts;
	/** Number of files whose metadata matches `date`. */
	agreeing: number;
	/** Total number of files contributing to the vote. */
	total: number;
}

/**
 * Compute the consensus calendar date across a folder's files. Returns a
 * consensus only when one date claims at least `threshold` (default 80%) of
 * the votes; otherwise null, meaning the folder's files disagree too much to
 * propose a single rename.
 */
export function folderConsensus(
	dates: readonly DateParts[],
	threshold = FOLDER_CONSENSUS_THRESHOLD,
): FolderConsensus | null {
	if (dates.length === 0) {
		return null;
	}
	const buckets = new Map<string, {date: DateParts; count: number}>();
	for (const date of dates) {
		const key = dateKey(date);
		const bucket = buckets.get(key);
		if (bucket === undefined) {
			buckets.set(key, {date, count: 1});
		} else {
			bucket.count += 1;
		}
	}
	let winner: {date: DateParts; count: number} | null = null;
	for (const bucket of buckets.values()) {
		if (winner === null || bucket.count > winner.count) {
			winner = bucket;
		}
	}
	if (winner === null) {
		return null;
	}
	if (winner.count / dates.length < threshold) {
		return null;
	}
	return {date: winner.date, agreeing: winner.count, total: dates.length};
}

/**
 * Targets in `proposed` that appear more than once. Two findings proposing the
 * same final path cannot both succeed; `--fix` must skip every member of such
 * a collision rather than letting whichever runs first clobber the other.
 */
export function collisionsIn(proposed: readonly ProposedRename[]): Set<string> {
	const counts = new Map<string, number>();
	for (const {to} of proposed) {
		counts.set(to, (counts.get(to) ?? 0) + 1);
	}
	const collisions = new Set<string>();
	for (const [target, count] of counts) {
		if (count > 1) {
			collisions.add(target);
		}
	}
	return collisions;
}

export interface UndoLogEntry {
	timestamp: string;
	from: string;
	to: string;
}

/**
 * One line of the JSON-lines undo log. Includes the trailing newline so callers
 * can append the result directly. Field order is fixed for human readability.
 */
export function formatUndoLogEntry(entry: UndoLogEntry): string {
	const ordered = {timestamp: entry.timestamp, from: entry.from, to: entry.to};
	return `${JSON.stringify(ordered)}\n`;
}
