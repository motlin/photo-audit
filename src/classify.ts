import {datesAgree, type DateParts} from './dateParts.ts';
import type {MetadataConfidence} from './metadata.ts';

export interface AuditInput {
	path: string;
	/** Capture date from file metadata, or null if the file has none. */
	metadataDate: DateParts | null;
	/**
	 * How much to trust the metadata wall-clock. Optional; defaults to 'high'
	 * for callers that have no opinion (e.g. existing tests).
	 */
	metadataConfidence?: MetadataConfidence;
	/** Date parsed from the filename, or null. */
	filenameDate: DateParts | null;
	/** Date parsed from the nearest dated ancestor folder, or null. */
	folderDate: DateParts | null;
}

export type DateSource = 'filename' | 'folder';

export interface Conflict {
	source: DateSource;
	found: DateParts;
}

/**
 * Outcome of auditing one file's dates. Metadata is treated as ground truth;
 * filename and folder dates are the claims being checked against it.
 *
 * `METADATA_SUSPECT` is the exception: the metadata looks like a date-only
 * sentinel (midnight wall-clock) and the filename or folder carries a precise
 * timestamp that would make a better source of truth. We surface the conflict
 * for the user to judge but never propose an automatic rename.
 */
export type Finding =
	| {kind: 'CONSISTENT'; path: string; metadataDate: DateParts}
	| {kind: 'WRONG_DATE'; path: string; metadataDate: DateParts; conflicts: Conflict[]}
	| {
			kind: 'METADATA_SUSPECT';
			path: string;
			metadataDate: DateParts;
			filenameDate: DateParts | null;
			folderDate: DateParts | null;
	  }
	| {kind: 'MISSING_DATE'; path: string; metadataDate: DateParts}
	| {kind: 'NO_METADATA_DATE'; path: string};

export function classify(input: AuditInput): Finding {
	const {path, metadataDate, filenameDate, folderDate} = input;
	const metadataConfidence: MetadataConfidence = input.metadataConfidence ?? 'high';

	if (metadataDate === null) {
		return {kind: 'NO_METADATA_DATE', path};
	}

	const claims: Conflict[] = [];
	if (filenameDate !== null) {
		claims.push({source: 'filename', found: filenameDate});
	}
	if (folderDate !== null) {
		claims.push({source: 'folder', found: folderDate});
	}

	const conflicts = claims.filter((claim) => !datesAgree(claim.found, metadataDate));
	if (conflicts.length > 0) {
		const hasPreciseRival = conflicts.some((conflict) => conflict.found.time !== null);
		if (metadataConfidence === 'date-only' && hasPreciseRival) {
			return {kind: 'METADATA_SUSPECT', path, metadataDate, filenameDate, folderDate};
		}
		return {kind: 'WRONG_DATE', path, metadataDate, conflicts};
	}
	if (claims.length === 0) {
		return {kind: 'MISSING_DATE', path, metadataDate};
	}
	return {kind: 'CONSISTENT', path, metadataDate};
}
