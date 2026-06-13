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
		// Strip a leading date, then an optional " - <date>" range component
		// (iMazing names folders "<date> - <date> - <event>"), then any leading
		// separator dash, leaving just the event title. A bare date or a plain
		// date range collapses to nothing.
		const datePattern = /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4}|\d{8})/;
		const withoutDate = trimmed
			.replace(datePattern, '')
			.replace(/^\s*-\s*(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4}|\d{8})/, '')
			.replace(/^\s*-?\s*/, '')
			.trim();
		return withoutDate === '' ? null : withoutDate;
	}
	return trimmed;
}

/**
 * Drop the source folder as a suffix source when its name carries a date whose
 * year differs from the file's own year. Such a folder is a grab-bag or
 * misfile (e.g. iMazing's "2000-01-01 - New Year's Day" holding recent photos),
 * and its event title does not belong on the file's real date. Same-year
 * differences are kept: multi-day event folders legitimately hold later-day
 * photos, and those should keep the event suffix.
 */
function suffixFolderName(sourceFolderName: string | null, metadataYear: number): string | null {
	if (sourceFolderName === null) {
		return null;
	}
	const folderDate = parseDateFromString(sourceFolderName.trim());
	if (folderDate !== null && folderDate.year !== metadataYear) {
		return null;
	}
	return sourceFolderName;
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
	includeDayFolder?: boolean;
}

/**
 * Compute the destination directory for a file's new hard-linked alias under
 * `outputRoot`. Layout:
 *
 *   <outputRoot>/<YYYY0> Decade/<YYYY>/<YYYY-MM>/<YYYY-MM-DD [suffix]>
 *
 * When `includeDayFolder` is false, the day-folder segment (and its suffix) is
 * omitted, stopping at `<outputRoot>/<YYYY0> Decade/<YYYY>/<YYYY-MM>`. This is
 * used for iMessage entries whose filenames already encode the full date+time,
 * chat title, and sender — a per-day folder there is redundant and produces
 * one folder per day of texting.
 *
 * Throws when the metadata date lacks a `day` (month-precision sources cannot
 * land in a per-day folder) and `includeDayFolder` is true.
 */
export function computeOutputDirectory(ctx: OutputPathContext): string {
	const includeDayFolder = ctx.includeDayFolder ?? true;
	const {year, month, day} = ctx.metadataDate;
	const decade = `${Math.floor(year / 10) * 10} Decade`;
	const yearStr = pad(year, 4);
	const yearMonth = `${yearStr}-${pad(month)}`;
	if (!includeDayFolder) {
		return join(ctx.outputRoot, decade, yearStr, yearMonth);
	}
	if (day === null) {
		throw new Error('computeOutputDirectory requires a day-precision metadata date');
	}
	const dayStr = `${yearMonth}-${pad(day)}`;
	const suffix = pickDaySuffix(suffixFolderName(ctx.sourceFolderName, year), ctx.place);
	const dayFolder = suffix === null ? dayStr : `${dayStr} ${suffix}`;
	return join(ctx.outputRoot, decade, yearStr, yearMonth, dayFolder);
}
