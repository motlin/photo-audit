import type { DateParts } from "./dateParts.ts";

const MIN_YEAR = 1990;
const MAX_YEAR = 2099;

/** ISO calendar date, optionally followed by a time (`153044`, `17-18-14`, `17:18:14`). */
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:[ _T-]+(\d{2})[-:]?(\d{2})[-:]?(\d{2}))?/g;

/** Compact `YYYYMMDD` run, optionally followed by `HHMMSS` (Android/camera naming). */
const COMPACT = /(?<!\d)(\d{4})(\d{2})(\d{2})(?:[ _T.-]?(\d{2})(\d{2})(\d{2}))?(?!\d)/g;

/** Month-precision `YYYY-MM` (e.g. a "2022-06 Nadia Shoot" folder). */
const YEAR_MONTH = /(?<!\d)(\d{4})-(\d{2})(?!-?\d)/g;

function isValid(date: DateParts): boolean {
	if (date.year < MIN_YEAR || date.year > MAX_YEAR) {
		return false;
	}
	if (date.month < 1 || date.month > 12) {
		return false;
	}
	if (date.day !== null && (date.day < 1 || date.day > 31)) {
		return false;
	}
	if (date.time !== null) {
		const { hour, minute, second } = date.time;
		if (hour > 23 || minute > 59 || second > 59) {
			return false;
		}
	}
	return true;
}

function buildWithOptionalTime(match: RegExpMatchArray, day: number | null): DateParts {
	const [, year, month, , hour, minute, second] = match;
	const time =
		hour !== undefined && minute !== undefined && second !== undefined
			? { hour: Number(hour), minute: Number(minute), second: Number(second) }
			: null;
	return { year: Number(year), month: Number(month), day, time };
}

function firstValid(
	input: string,
	pattern: RegExp,
	build: (match: RegExpMatchArray) => DateParts,
): DateParts | null {
	for (const match of input.matchAll(pattern)) {
		const date = build(match);
		if (isValid(date)) {
			return date;
		}
	}
	return null;
}

/**
 * Extract the first plausible date from a filename or folder name.
 *
 * Tries full ISO dates, then compact `YYYYMMDD` runs, then month-precision
 * `YYYY-MM`. Returns null when nothing date-like is found, deliberately
 * ignoring year ranges ("2005-2013") and bare years.
 */
export function parseDateFromString(input: string): DateParts | null {
	return (
		firstValid(input, ISO_DATE, (m) => buildWithOptionalTime(m, Number(m[3]))) ??
		firstValid(input, COMPACT, (m) => buildWithOptionalTime(m, Number(m[3]))) ??
		firstValid(input, YEAR_MONTH, (m) => ({
			year: Number(m[1]),
			month: Number(m[2]),
			day: null,
			time: null,
		}))
	);
}
