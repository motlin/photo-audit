import type {DateParts} from './dateParts.ts';

export interface FolderFileEntry {
	path: string;
	metadataDate: DateParts;
	folderPath: string;
}

export interface DatedFolder {
	folderPath: string;
	folderDate: DateParts;
}

export type FolderWarning =
	| {
			kind: 'FOLDER_AFTER_FILES';
			folderPath: string;
			folderDate: DateParts;
			earliestFile: DateParts;
			latestFile: DateParts;
			fileCount: number;
	  }
	| {
			kind: 'FOLDER_UNIFORM_METADATA';
			folderPath: string;
			folderDate: DateParts;
			sharedTimestamp: DateParts;
			fileCount: number;
	  };

function dayValue(date: DateParts): number {
	return date.year * 10000 + date.month * 100 + (date.day ?? 0);
}

function compareDay(a: DateParts, b: DateParts): number {
	return dayValue(a) - dayValue(b);
}

function timestampsIdentical(a: DateParts, b: DateParts): boolean {
	return (
		a.year === b.year &&
		a.month === b.month &&
		a.day === b.day &&
		(a.time?.hour ?? null) === (b.time?.hour ?? null) &&
		(a.time?.minute ?? null) === (b.time?.minute ?? null) &&
		(a.time?.second ?? null) === (b.time?.second ?? null)
	);
}

function uniformTimestamp(dates: readonly DateParts[]): DateParts | null {
	if (dates.length < 2) {
		return null;
	}
	const first = dates[0];
	if (first === undefined || first.time === null) {
		return null;
	}
	for (let i = 1; i < dates.length; i++) {
		const current = dates[i];
		if (current === undefined || !timestampsIdentical(first, current)) {
			return null;
		}
	}
	return first;
}

/**
 * Aggregate per-file metadata into folder-level warnings. Returns at most one
 * warning per folder; the uniform-metadata case takes precedence over
 * folder-after-files since identical timestamps usually mean the metadata is
 * an mtime fallback rather than a real capture date.
 *
 * Folders whose date is on or before the earliest file (the "starting day"
 * label pattern, e.g. "2015-07-15 Levi's Birth/" with files from later that
 * week) are intentionally silent.
 */
export function planFolderWarnings(
	files: readonly FolderFileEntry[],
	folders: readonly DatedFolder[],
): FolderWarning[] {
	const filesByFolder = new Map<string, FolderFileEntry[]>();
	for (const entry of files) {
		const bucket = filesByFolder.get(entry.folderPath);
		if (bucket === undefined) {
			filesByFolder.set(entry.folderPath, [entry]);
		} else {
			bucket.push(entry);
		}
	}

	const warnings: FolderWarning[] = [];
	for (const {folderPath, folderDate} of folders) {
		const members = filesByFolder.get(folderPath);
		if (members === undefined || members.length === 0) {
			continue;
		}
		const dates = members.map((m) => m.metadataDate);

		const shared = uniformTimestamp(dates);
		if (shared !== null) {
			warnings.push({
				kind: 'FOLDER_UNIFORM_METADATA',
				folderPath,
				folderDate,
				sharedTimestamp: shared,
				fileCount: members.length,
			});
			continue;
		}

		let earliest = dates[0];
		let latest = dates[0];
		for (const date of dates) {
			if (earliest === undefined || compareDay(date, earliest) < 0) {
				earliest = date;
			}
			if (latest === undefined || compareDay(date, latest) > 0) {
				latest = date;
			}
		}
		if (earliest !== undefined && latest !== undefined && compareDay(folderDate, latest) > 0) {
			warnings.push({
				kind: 'FOLDER_AFTER_FILES',
				folderPath,
				folderDate,
				earliestFile: earliest,
				latestFile: latest,
				fileCount: members.length,
			});
		}
	}
	return warnings;
}
