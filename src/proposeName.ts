import {formatDate, type DateParts} from './dateParts.ts';

/**
 * A date (and optional time, with optional `.SSS` sub-second suffix) at the
 * very start of a name, with trailing separators.
 */
const LEADING_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{8})(?:[ _T-]+\d{2}[-:.]?\d{2}[-:.]?\d{2}(?:\.\d{3})?|_\d{6})?[ _-]*/;

/**
 * Propose a filename that puts `date` at the front in `YYYY-MM-DD HHMMSS` form
 * (or `YYYY-MM-DD` when metadata carries no time).
 *
 * The time is included so files shot on the same day stay distinct. Any date
 * already leading the name is stripped first, so a wrong date is replaced
 * rather than stacked, and the extension and rest of the name are preserved.
 * This is report-only today; the future `--fix` mode will apply it.
 */
export function proposeFilename(originalName: string, date: DateParts): string {
	const dot = originalName.lastIndexOf('.');
	const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
	const extension = dot > 0 ? originalName.slice(dot) : '';

	const remainder = stem.replace(LEADING_DATE, '').trim();
	const datePrefix = formatDate(date);

	return remainder.length > 0 ? `${datePrefix} ${remainder}${extension}` : `${datePrefix}${extension}`;
}
