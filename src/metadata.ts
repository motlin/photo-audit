import {ExifDate, ExifDateTime, type Tags} from 'exiftool-vendored';
import type {DateParts} from './dateParts.ts';

/**
 * Tag names that, when set, indicate the timestamp is from an editing session
 * rather than the original capture. These are checked alongside the
 * Software/CreatorTool string to detect Photoshop/Lightroom-style edits.
 */
const EDIT_DATE_TAGS = ['ModifyDate', 'MetadataDate'] as const satisfies readonly (keyof Tags)[];

/**
 * Substrings (case-insensitive) used to recognize editing software in the
 * Software/CreatorTool/ProcessingSoftware tags. Camera firmware strings (like
 * "Canon EOS R5 firmware 1.6.0") do not contain any of these, so a plain
 * camera-firmware ModifyDate is not mistaken for an edit.
 */
const EDIT_SOFTWARE_HINTS = ['photoshop', 'lightroom', 'gimp', 'affinity', 'topaz'] as const;

/**
 * Metadata tags holding a capture date, in priority order.
 *
 * `CreationDate` (QuickTime Keys) is timezone-aware and preferred for video.
 * `CreateDate` is listed after it because for QuickTime it is stored in UTC;
 * see {@link toLocalDateParts} for how that UTC value is handled.
 */
const DATE_TAGS = [
	'SubSecDateTimeOriginal',
	'DateTimeOriginal',
	'CreationDate',
	'CreateDate',
	'MediaCreateDate',
] as const satisfies readonly (keyof Tags)[];

/**
 * True when exiftool-vendored *defaulted* a date to UTC because it could not
 * find a real timezone (its `defaultVideosToUTC` behavior for video files).
 *
 * In that case the wall-clock is a UTC value, not a local one, and must be
 * converted. An explicitly-UTC date (`inferredZone === false`, e.g. an EXIF
 * value written as "...Z") is taken at face value, and a date whose zone was
 * recovered from another tag has a non-UTC zone, so neither matches here.
 */
function isDefaultedUtc(value: ExifDateTime): boolean {
	return value.zone === 'UTC' && value.inferredZone === true;
}

function partsFromExifDateTime(value: ExifDateTime): DateParts {
	return {
		year: value.year,
		month: value.month,
		day: value.day,
		time: {hour: value.hour, minute: value.minute, second: value.second},
	};
}

/**
 * Convert a metadata date value to the calendar date the photo belongs to,
 * expressed as local wall-clock parts.
 *
 * A defaulted-UTC value is converted into `homeZone`; every other value
 * already carries the intended local wall-clock and is used unchanged.
 */
export function toLocalDateParts(value: unknown, homeZone: string): DateParts | null {
	if (value instanceof ExifDate) {
		if (value.month === undefined || value.day === undefined) {
			return null;
		}
		return {year: value.year, month: value.month, day: value.day, time: null};
	}
	if (value instanceof ExifDateTime) {
		if (isDefaultedUtc(value)) {
			const local = value.setZone(homeZone);
			if (local !== undefined) {
				return partsFromExifDateTime(local);
			}
		}
		return partsFromExifDateTime(value);
	}
	return null;
}

/**
 * How much we trust the wall-clock portion of a metadata date.
 *
 * `date-only` means the source had no real time component — either an `ExifDate`
 * value, or an `ExifDateTime` stamped at exactly 00:00:00 (a "date-only"
 * sentinel that some software writes when only the calendar day is known).
 * `high` means a real wall-clock time was recorded.
 */
export type MetadataConfidence = 'high' | 'date-only';

export interface MetadataDate {
	date: DateParts;
	/** Which metadata tag the date came from. */
	tag: string;
	confidence: MetadataConfidence;
}

/**
 * True when this `ExifDateTime` looks like a date-only sentinel rather than a
 * captured wall-clock time: midnight to the second.
 */
function isMidnightExifDateTime(value: ExifDateTime): boolean {
	return value.hour === 0 && value.minute === 0 && value.second === 0;
}

function confidenceOf(value: unknown): MetadataConfidence {
	if (value instanceof ExifDate) {
		return 'date-only';
	}
	if (value instanceof ExifDateTime && isMidnightExifDateTime(value)) {
		return 'date-only';
	}
	return 'high';
}

/**
 * True when this candidate's wall-clock is a real local time rather than a
 * defaulted-UTC value that had to be shifted into the home zone. An explicit
 * EXIF "...Z" (zone known, `inferredZone === false`) counts as a real zone.
 */
function hasRealZone(value: unknown): boolean {
	if (value instanceof ExifDateTime) {
		return !isDefaultedUtc(value);
	}
	return true;
}

/**
 * True when the candidate carries a real captured wall-clock time, not a
 * midnight or date-only sentinel.
 */
function hasRealTime(value: unknown): boolean {
	return confidenceOf(value) === 'high';
}

/**
 * Pull the most trustworthy capture date out of a file's metadata tags,
 * normalized to local wall-clock parts in `homeZone`.
 *
 * Every {@link DATE_TAGS} entry is scored on two axes:
 *   1. real wall-clock time (non-midnight) beats date-only/midnight sentinels
 *   2. an explicit or recovered timezone beats a defaulted-UTC value
 *
 * The {@link DATE_TAGS} order acts as a tie-breaker. This lets a real
 * `CreateDate` override a midnight `DateTimeOriginal`, while still preferring
 * `SubSecDateTimeOriginal` over `DateTimeOriginal` when they are equivalent.
 */
export function extractMetadataDate(tags: Tags, homeZone: string): MetadataDate | null {
	type Candidate = {
		date: DateParts;
		tag: (typeof DATE_TAGS)[number];
		raw: unknown;
	};

	const candidates: Candidate[] = [];
	for (const tag of DATE_TAGS) {
		const raw = tags[tag];
		const date = toLocalDateParts(raw, homeZone);
		if (date !== null) {
			candidates.push({date, tag, raw});
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	// `candidates` is already in DATE_TAGS order, so the reduce keeps the
	// earlier-listed tag whenever the time-then-zone scores tie.
	const best = candidates.reduce((winner, current) => {
		if (hasRealTime(current.raw) !== hasRealTime(winner.raw)) {
			return hasRealTime(current.raw) ? current : winner;
		}
		if (hasRealZone(current.raw) !== hasRealZone(winner.raw)) {
			return hasRealZone(current.raw) ? current : winner;
		}
		return winner;
	});

	return {date: best.date, tag: best.tag, confidence: confidenceOf(best.raw)};
}

/**
 * Information about a file whose only date metadata comes from an editing
 * session (Photoshop / Lightroom / GIMP / Affinity / Topaz). The dates here
 * are NOT capture times — they are when the file was saved during editing.
 */
export interface EditDerivedDate {
	firstEdit: DateParts;
	lastEdit: DateParts;
	software: string;
}

/**
 * Combined result of {@link extractDateOrEdit}: either the file has a real
 * capture date, or it is edit-derived (no capture tags, only edit timestamps
 * stamped by recognized editing software).
 */
export type DateOrEdit = {kind: 'capture'; metadata: MetadataDate} | ({kind: 'edit-derived'} & EditDerivedDate);

/**
 * Pull a `When` ExifDateTime/ExifDate out of a single `ResourceEvent`-shaped
 * History entry. Returns null when the value cannot be parsed as a date.
 */
function historyWhen(entry: unknown): ExifDateTime | ExifDate | null {
	if (entry === null || typeof entry !== 'object') {
		return null;
	}
	const when = (entry as {When?: unknown}).When;
	if (when instanceof ExifDateTime || when instanceof ExifDate) {
		return when;
	}
	return null;
}

/**
 * Every `When` timestamp found in a `History` value, which may be a single
 * `ResourceEvent`, an array of them, or a string we can't parse.
 */
function historyWhens(history: unknown): (ExifDateTime | ExifDate)[] {
	if (Array.isArray(history)) {
		const result: (ExifDateTime | ExifDate)[] = [];
		for (const entry of history) {
			const when = historyWhen(entry);
			if (when !== null) {
				result.push(when);
			}
		}
		return result;
	}
	const when = historyWhen(history);
	return when === null ? [] : [when];
}

/**
 * String from any tag that names the program responsible for the file's
 * current contents, used both to recognize editing software and to attribute
 * the edit-derived label. The first non-empty value wins.
 */
function softwareString(tags: Tags): string | null {
	const candidates = [tags.Software, tags.CreatorTool, tags.ProcessingSoftware];
	for (const candidate of candidates) {
		if (typeof candidate === 'string' && candidate.length > 0) {
			return candidate;
		}
	}
	return null;
}

function isEditingSoftware(software: string): boolean {
	const lower = software.toLowerCase();
	return EDIT_SOFTWARE_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Earliest and latest local-wall-clock dates derived from edit-session tags:
 * `ModifyDate`, `MetadataDate`, and every `History[].When`. Returns null when
 * no usable edit date is present.
 */
function editDateRange(tags: Tags, homeZone: string): {firstEdit: DateParts; lastEdit: DateParts} | null {
	const dates: DateParts[] = [];
	for (const tag of EDIT_DATE_TAGS) {
		const parts = toLocalDateParts(tags[tag], homeZone);
		if (parts !== null) {
			dates.push(parts);
		}
	}
	for (const when of historyWhens(tags.History)) {
		const parts = toLocalDateParts(when, homeZone);
		if (parts !== null) {
			dates.push(parts);
		}
	}
	if (dates.length === 0) {
		return null;
	}
	const sorted = [...dates].sort(compareDateParts);
	return {firstEdit: sorted[0]!, lastEdit: sorted[sorted.length - 1]!};
}

/**
 * Order DateParts chronologically. Treats a missing day or time component as
 * 0 so date-only and timestamped values compare consistently.
 */
function compareDateParts(left: DateParts, right: DateParts): number {
	const cmp = (a: number, b: number): number | null => (a === b ? null : a - b);
	return (
		cmp(left.year, right.year) ??
		cmp(left.month, right.month) ??
		cmp(left.day ?? 0, right.day ?? 0) ??
		cmp(left.time?.hour ?? 0, right.time?.hour ?? 0) ??
		cmp(left.time?.minute ?? 0, right.time?.minute ?? 0) ??
		(left.time?.second ?? 0) - (right.time?.second ?? 0)
	);
}

/**
 * Decide whether a file has a real capture date or only edit-session
 * timestamps stamped by editing software.
 *
 * Returns:
 *  - `{kind: 'capture', metadata}` when at least one {@link DATE_TAGS} value
 *    is set; capture always wins, even if Photoshop later resaved the file.
 *  - `{kind: 'edit-derived', firstEdit, lastEdit, software}` when no capture
 *    tag is set, an edit timestamp IS set (ModifyDate / MetadataDate / a
 *    History `When`), and `Software`/`CreatorTool`/`ProcessingSoftware` names
 *    a recognized editor (Photoshop, Lightroom, GIMP, Affinity, Topaz).
 *  - `null` otherwise.
 */
export function extractDateOrEdit(tags: Tags, homeZone: string): DateOrEdit | null {
	const capture = extractMetadataDate(tags, homeZone);
	if (capture !== null) {
		return {kind: 'capture', metadata: capture};
	}
	const software = softwareString(tags);
	if (software === null || !isEditingSoftware(software)) {
		return null;
	}
	const range = editDateRange(tags, homeZone);
	if (range === null) {
		return null;
	}
	return {kind: 'edit-derived', firstEdit: range.firstEdit, lastEdit: range.lastEdit, software};
}
