import {formatDate, type DateParts} from './dateParts.ts';

/**
 * A date (and optional time, with optional `.SSS` sub-second suffix) at the
 * very start of a name, with trailing separators.
 */
const LEADING_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{8})(?:[ _T-]+\d{2}[-:.]?\d{2}[-:.]?\d{2}(?:\.\d{3})?|_\d{6})?[ _-]*/;

/**
 * Stems that camera firmware assigns (no human meaning): IMG_2024, DSC_1234,
 * DSCF0001, PXL_20240315_182434523, MVI_0042, P1000123, PICT0001, etc.
 */
const CAMERA_ID_STEM =
	/^(IMG|IMAGE|DSC|DSCF|DSCN|PXL|MVI|PICT|VID|VIDEO|CAM|DCIM|P|MOV|GOPR|GP|GH|DJI)(?:[_-]?\d+)+[_-]?[\dA-Fa-f]*$/i;

export interface ProposeFilenameOptions {
	/**
	 * When true, the original stem is dropped if it matches a known camera-
	 * generated pattern (IMG_xxx, DSC_xxx, PXL_yyymmdd_..., etc.). Human-named
	 * stems are left in place either way.
	 */
	stripCameraId?: boolean;
}

/**
 * Propose a filename that puts `date` at the front in `YYYY-MM-DD HHMMSS` form
 * (or `YYYY-MM-DD` when metadata carries no time).
 *
 * The time is included so files shot on the same day stay distinct. Any date
 * already leading the name is stripped first, so a wrong date is replaced
 * rather than stacked, and the extension is preserved.
 */
export function proposeFilename(originalName: string, date: DateParts, options: ProposeFilenameOptions = {}): string {
	const dot = originalName.lastIndexOf('.');
	const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
	const extension = dot > 0 ? originalName.slice(dot) : '';

	let remainder = stem.replace(LEADING_DATE, '').trim();
	if (options.stripCameraId === true && CAMERA_ID_STEM.test(remainder)) {
		remainder = '';
	}
	const datePrefix = formatDate(date);

	return remainder.length > 0 ? `${datePrefix} ${remainder}${extension}` : `${datePrefix}${extension}`;
}
