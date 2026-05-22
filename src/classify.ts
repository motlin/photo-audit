import { datesAgree, type DateParts } from "./dateParts.ts";

export interface AuditInput {
	path: string;
	/** Capture date from file metadata, or null if the file has none. */
	metadataDate: DateParts | null;
	/** Date parsed from the filename, or null. */
	filenameDate: DateParts | null;
	/** Date parsed from the nearest dated ancestor folder, or null. */
	folderDate: DateParts | null;
}

export type DateSource = "filename" | "folder";

export interface Conflict {
	source: DateSource;
	found: DateParts;
}

/**
 * Outcome of auditing one file's dates. Metadata is treated as ground truth;
 * filename and folder dates are the claims being checked against it.
 */
export type Finding =
	| { kind: "CONSISTENT"; path: string; metadataDate: DateParts }
	| { kind: "WRONG_DATE"; path: string; metadataDate: DateParts; conflicts: Conflict[] }
	| { kind: "MISSING_DATE"; path: string; metadataDate: DateParts }
	| { kind: "NO_METADATA_DATE"; path: string };

export function classify(input: AuditInput): Finding {
	const { path, metadataDate, filenameDate, folderDate } = input;

	if (metadataDate === null) {
		return { kind: "NO_METADATA_DATE", path };
	}

	const claims: Conflict[] = [];
	if (filenameDate !== null) {
		claims.push({ source: "filename", found: filenameDate });
	}
	if (folderDate !== null) {
		claims.push({ source: "folder", found: folderDate });
	}

	const conflicts = claims.filter((claim) => !datesAgree(claim.found, metadataDate));
	if (conflicts.length > 0) {
		return { kind: "WRONG_DATE", path, metadataDate, conflicts };
	}
	if (claims.length === 0) {
		return { kind: "MISSING_DATE", path, metadataDate };
	}
	return { kind: "CONSISTENT", path, metadataDate };
}
