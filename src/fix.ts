/**
 * Pure helpers for the `--fix` rename mode. Filesystem and process side effects
 * live in `cli.ts`; this module exists so the planning logic can be unit-tested
 * without touching disk.
 */

export interface ProposedRename {
	/** Absolute path of the existing file. */
	from: string;
	/** Absolute path the file would be renamed to. */
	to: string;
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
