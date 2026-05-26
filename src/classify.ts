import {datesAgree, type DateParts} from './dateParts.ts';
import type {EditDerivedDate, MetadataConfidence} from './metadata.ts';

export interface AuditInput {
	path: string;
	/** Capture date from file metadata, or null if the file has none. */
	metadataDate: DateParts | null;
	/**
	 * How much to trust the metadata wall-clock. Optional; defaults to 'high'
	 * for callers that have no opinion (e.g. existing tests).
	 */
	metadataConfidence?: MetadataConfidence;
	/**
	 * Set when the file has no capture-date tag but does have edit-session
	 * timestamps stamped by recognized editing software (Photoshop, Lightroom,
	 * GIMP, Affinity, Topaz). When present, this short-circuits the audit
	 * since neither value is a real capture moment.
	 */
	editDerived?: EditDerivedDate;
	/** Date parsed from the filename, or null. */
	filenameDate: DateParts | null;
	/** Date parsed from the nearest dated ancestor folder, or null. */
	folderDate: DateParts | null;
}

export type DateSource = 'filename';

export interface Conflict {
	source: DateSource;
	found: DateParts;
}

/**
 * Outcome of auditing one file's dates. Metadata is treated as ground truth and
 * the filename date is the claim being checked against it. The folder date is
 * informational only: a matching folder date can rescue a file from
 * MISSING_DATE, but a folder mismatch is never a per-file finding because
 * dated event folders ("2015-07-15 Levi's Birth/") are starting-day labels and
 * legitimately contain files from later days.
 *
 * `METADATA_SUSPECT` is the exception: the metadata looks like a date-only
 * sentinel (midnight wall-clock) and the filename carries a precise timestamp
 * that would make a better source of truth. We surface the conflict for the
 * user to judge but never propose an automatic rename.
 */
export type Finding =
	| {kind: 'CONSISTENT'; path: string; metadataDate: DateParts}
	| {
			kind: 'WRONG_DATE';
			path: string;
			metadataDate: DateParts;
			metadataConfidence: MetadataConfidence;
			conflicts: Conflict[];
	  }
	| {
			kind: 'METADATA_SUSPECT';
			path: string;
			metadataDate: DateParts;
			filenameDate: DateParts | null;
			folderDate: DateParts | null;
	  }
	| {
			kind: 'EDIT_DERIVED';
			path: string;
			firstEdit: DateParts;
			lastEdit: DateParts;
			software: string;
	  }
	| {kind: 'MISSING_DATE'; path: string; metadataDate: DateParts; metadataConfidence: MetadataConfidence}
	| {kind: 'NO_METADATA_DATE'; path: string};

export function classify(input: AuditInput): Finding {
	const {path, metadataDate, editDerived, filenameDate, folderDate} = input;
	const metadataConfidence: MetadataConfidence = input.metadataConfidence ?? 'high';

	if (editDerived !== undefined) {
		return {
			kind: 'EDIT_DERIVED',
			path,
			firstEdit: editDerived.firstEdit,
			lastEdit: editDerived.lastEdit,
			software: editDerived.software,
		};
	}

	if (metadataDate === null) {
		return {kind: 'NO_METADATA_DATE', path};
	}

	const filenameConflict =
		filenameDate !== null && !datesAgree(filenameDate, metadataDate)
			? {source: 'filename' as const, found: filenameDate}
			: null;
	if (filenameConflict !== null) {
		if (metadataConfidence === 'date-only' && filenameConflict.found.time !== null) {
			return {kind: 'METADATA_SUSPECT', path, metadataDate, filenameDate, folderDate};
		}
		return {kind: 'WRONG_DATE', path, metadataDate, metadataConfidence, conflicts: [filenameConflict]};
	}

	const folderAgrees = folderDate !== null && datesAgree(folderDate, metadataDate);
	if (filenameDate !== null || folderAgrees) {
		return {kind: 'CONSISTENT', path, metadataDate};
	}
	return {kind: 'MISSING_DATE', path, metadataDate, metadataConfidence};
}
