import {type DateParts, formatDate} from '../dateParts.ts';

/**
 * A date (and optional time, with optional `.SSS` sub-second suffix) at the
 * very start of a name, with trailing separators. Mirrors the leading-date
 * regex in `proposeName.ts`.
 */
const LEADING_DATE = /^(?:\d{4}-\d{2}-\d{2}|\d{8})(?:[ _T-]+\d{2}[-:.]?\d{2}[-:.]?\d{2}(?:\.\d{3})?|_\d{6})?[ _-]*/;

/**
 * Stems that camera firmware assigns (no human meaning): IMG_2024, DSC_1234,
 * DSCF0001, PXL_20240315_182434523, MVI_0042, P1000123, PICT0001, etc.
 * Kept in sync with `CAMERA_ID_STEM` in `proposeName.ts`.
 */
const CAMERA_ID_STEM =
	/^(IMG|IMAGE|DSC|DSCF|DSCN|PXL|MVI|PICT|VID|VIDEO|CAM|DCIM|P|MOV|GOPR|GP|GH|DJI)(?:[_-]?\d+)+[_-]?[\dA-Fa-f]*$/i;

/**
 * iMessage UUID-style stems like `906__7DDACC18-1480-46CB-91EA-51B325B6E7DA`
 * (numeric id, two underscores, hyphenated hex UUID).
 */
const IMESSAGE_UUID_STEM = /^[0-9]+__[0-9A-Fa-f-]{20,}$/;

/**
 * Plain hex UUID stems (no numeric prefix).
 */
const PLAIN_UUID_STEM = /^[0-9A-Fa-f-]{20,}$/;

/**
 * iMessage strips slashes from pasted URLs, leaving stems like
 * `httpswww.dolcevita.comproductsfernly-boots-dune-suede`. We trim the
 * scheme + optional www. prefix and keep the rest as a (mangled but
 * human-readable) marker.
 */
const URL_PREFIX = /^https?(www\.)?/;

/**
 * Screenshot stems written by macOS, e.g.
 * `Screenshot 2025-01-13 at 4.43.28 PM` (with a regular space or the narrow
 * no-break space U+202F that macOS inserts between the seconds and AM/PM).
 */
const SCREENSHOT_STEM = /^Screenshot \d{4}-\d{2}-\d{2} at \d{1,2}\.\d{2}\.\d{2}[  ][AP]M$/;

/**
 * Literal stems that carry no information once we have a date prefix and
 * sender context.
 */
const LITERAL_DROP_STEMS = new Set(['FullSizeRender', 'image', 'video', 'photo', 'Attachment']);

export interface ProposeImessageFilenameInput {
	originalName: string;
	date: DateParts;
	senderName: string | null;
	chatTitle: string | null;
	cameraSuffix: string | null;
}

function transformStem(stem: string): string {
	if (stem === '') {
		return '';
	}
	if (IMESSAGE_UUID_STEM.test(stem)) {
		return '';
	}
	if (PLAIN_UUID_STEM.test(stem)) {
		return '';
	}
	if (CAMERA_ID_STEM.test(stem)) {
		return '';
	}
	if (LITERAL_DROP_STEMS.has(stem)) {
		return '';
	}
	if (SCREENSHOT_STEM.test(stem)) {
		return 'Screenshot';
	}
	if (URL_PREFIX.test(stem)) {
		return stem.replace(URL_PREFIX, '');
	}
	return stem;
}

/**
 * Propose a filename for a media attachment pulled out of an iMessage chat.
 *
 * Output shape (slots with null/empty content are omitted):
 *
 *     <YYYY-MM-DD HH.MM.SS[.mmm]> (<senderName>) (<chatTitle>) (<cameraSuffix>) <preserved-stem?><ext>
 *
 * iMessage attachments arrive with opaque names (UUIDs, camera-firmware ids,
 * `FullSizeRender.heic`, slash-stripped URLs, etc.). This function rewrites
 * those to something a human can scan, while keeping human-typed stems and
 * macOS screenshots intact (just shortened).
 */
export function proposeImessageFilename(input: ProposeImessageFilenameInput): string {
	const {originalName, date, senderName, chatTitle, cameraSuffix} = input;

	const dot = originalName.lastIndexOf('.');
	const rawStem = dot > 0 ? originalName.slice(0, dot) : originalName;
	const extension = dot > 0 ? originalName.slice(dot) : '';

	const withoutLeadingDate = rawStem.replace(LEADING_DATE, '').trim();
	const transformedStem = transformStem(withoutLeadingDate);

	const parts: string[] = [formatDate(date)];
	if (senderName !== null && senderName !== '') {
		parts.push(`(${senderName})`);
	}
	if (chatTitle !== null && chatTitle !== '') {
		parts.push(`(${chatTitle})`);
	}
	if (cameraSuffix !== null && cameraSuffix !== '') {
		parts.push(`(${cameraSuffix})`);
	}
	if (transformedStem !== '') {
		parts.push(transformedStem);
	}

	const assembled = parts.join(' ');
	const sanitized = assembled.replace(/\//g, '');
	return `${sanitized}${extension}`;
}
