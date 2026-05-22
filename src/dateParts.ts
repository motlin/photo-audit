/**
 * A date extracted from a filename, folder name, or file metadata.
 *
 * `day` is null for month-precision sources like a "2022-06 Nadia Shoot" folder.
 * `time` is null when only a calendar date was available.
 */
export interface DateParts {
	year: number;
	month: number;
	day: number | null;
	time: { hour: number; minute: number; second: number } | null;
}

export type DatePrecision = "month" | "day";

export function precisionOf(date: DateParts): DatePrecision {
	return date.day === null ? "month" : "day";
}

/** Compare two dates at the coarsest precision they share. */
export function datesAgree(a: DateParts, b: DateParts): boolean {
	if (a.year !== b.year || a.month !== b.month) {
		return false;
	}
	if (a.day === null || b.day === null) {
		return true;
	}
	return a.day === b.day;
}

export function formatDate(date: DateParts): string {
	const pad = (n: number, width = 2) => String(n).padStart(width, "0");
	const ymd =
		date.day === null
			? `${pad(date.year, 4)}-${pad(date.month)}`
			: `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
	if (date.time === null) {
		return ymd;
	}
	const { hour, minute, second } = date.time;
	return `${ymd} ${pad(hour)}${pad(minute)}${pad(second)}`;
}
