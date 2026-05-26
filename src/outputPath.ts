import {join} from 'node:path';
import type {DateParts} from './dateParts.ts';
import {parseDateFromString} from './parseDate.ts';

/**
 * Folder basenames that are dumping grounds rather than meaningful titles.
 * When a photo's parent folder matches one of these, the day-folder suffix
 * falls back to the geolocated place rather than the folder name.
 */
const DUMP_FOLDER_NAMES = new Set([
	'image capture',
	'imazing',
	'mobile photos',
	'screenshots',
	'dcim',
	'duplicates',
	'photos',
	'pictures',
]);

const DUMP_FOLDER_PATTERNS = [/^iphone(\s+\d+)?\s+backup$/i, /^ipad(\s+\d+)?\s+backup$/i];

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

/**
 * Extract a human-meaningful title from a folder name by stripping any leading
 * date and trimming. Returns null when nothing meaningful is left or the name
 * is a known dumping-ground folder.
 */
function folderTitle(folderName: string | null): string | null {
	if (folderName === null) {
		return null;
	}
	const trimmed = folderName.trim();
	if (trimmed === '') {
		return null;
	}
	const lower = trimmed.toLowerCase();
	if (DUMP_FOLDER_NAMES.has(lower) || DUMP_FOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
		return null;
	}
	if (parseDateFromString(trimmed) !== null) {
		const withoutDate = trimmed
			.replace(/^\d{4}(-\d{2}){0,2}\s*/, '')
			.replace(/^\d{8}\s*/, '')
			.trim();
		return withoutDate === '' ? null : withoutDate;
	}
	return trimmed;
}

/**
 * Pick the day-folder suffix using the user-curated source folder title when
 * present, otherwise the GPS-derived place name. Returns null when neither is
 * available.
 */
export function pickDaySuffix(sourceFolderName: string | null, place: string | null): string | null {
	const title = folderTitle(sourceFolderName);
	if (title !== null) {
		return title;
	}
	if (place !== null && place.trim() !== '') {
		return place.trim();
	}
	return null;
}

export interface OutputPathContext {
	outputRoot: string;
	metadataDate: DateParts;
	sourceFolderName: string | null;
	place: string | null;
}

/**
 * Compute the destination directory for a file's new hard-linked alias under
 * `outputRoot`. Layout:
 *
 *   <outputRoot>/<YYYY0> Decade/<YYYY>/<YYYY-MM>/<YYYY-MM-DD [suffix]>
 *
 * Throws when the metadata date lacks a `day` (month-precision sources cannot
 * land in a per-day folder).
 */
export function computeOutputDirectory(ctx: OutputPathContext): string {
	const {year, month, day} = ctx.metadataDate;
	if (day === null) {
		throw new Error('computeOutputDirectory requires a day-precision metadata date');
	}
	const decade = `${Math.floor(year / 10) * 10} Decade`;
	const yearStr = pad(year, 4);
	const yearMonth = `${yearStr}-${pad(month)}`;
	const dayStr = `${yearMonth}-${pad(day)}`;
	const suffix = pickDaySuffix(ctx.sourceFolderName, ctx.place);
	const dayFolder = suffix === null ? dayStr : `${dayStr} ${suffix}`;
	return join(ctx.outputRoot, decade, yearStr, yearMonth, dayFolder);
}
