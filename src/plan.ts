import {readFile, writeFile} from 'node:fs/promises';

export interface PlanEntry {
	/** Absolute path of the existing file. */
	from: string;
	/** Absolute path of the hard-linked alias to create. */
	to: string;
	/** Which finding kind motivated the link, for human review. */
	kind: 'WRONG_DATE' | 'MISSING_DATE' | 'CONSISTENT';
}

function formatPlanEntry(entry: PlanEntry): string {
	return `${JSON.stringify({from: entry.from, to: entry.to, kind: entry.kind})}\n`;
}

/**
 * Parse a JSON-Lines plan. Blank lines are skipped so users can edit a plan
 * file by deleting whole entries without breaking the format.
 */
export function parsePlan(content: string): PlanEntry[] {
	const entries: PlanEntry[] = [];
	for (const line of content.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') {
			continue;
		}
		entries.push(JSON.parse(trimmed) as PlanEntry);
	}
	return entries;
}

export async function writePlanFile(path: string, entries: readonly PlanEntry[]): Promise<void> {
	const body = entries.map(formatPlanEntry).join('');
	await writeFile(path, body, 'utf8');
}

export async function readPlanFile(path: string): Promise<PlanEntry[]> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return [];
		}
		throw error;
	}
	return parsePlan(raw);
}
