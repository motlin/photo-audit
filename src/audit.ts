import {basename, dirname} from 'node:path';
import type {ExifTool} from 'exiftool-vendored';
import {classify, type Finding} from './classify.ts';
import type {DateParts} from './dateParts.ts';
import {formatPlaceFromTags} from './geocode.ts';
import {type AttachmentRow, dateToPartsInZone} from './imessage/chatDb.ts';
import {
	extractCameraInfo,
	extractDateOrEdit,
	extractImessageDedupeKey,
	type CameraInfo,
	type MetadataConfidence,
} from './metadata.ts';
import {parseDateFromString} from './parseDate.ts';

/**
 * Date of the nearest ancestor folder that has one, searching from the file's
 * immediate parent upward and stopping at `root`.
 */
export function folderDateFor(filePath: string, root: string): DateParts | null {
	const dir = datedAncestorFolder(filePath, root);
	return dir === null ? null : parseDateFromString(basename(dir));
}

/**
 * Absolute path of the nearest ancestor folder whose basename parses as a
 * date, searching from the file's immediate parent upward and stopping at
 * `root`. Returns null when no ancestor folder is dated.
 */
export function datedAncestorFolder(filePath: string, root: string): string | null {
	let dir = dirname(filePath);
	for (;;) {
		if (parseDateFromString(basename(dir)) !== null) {
			return dir;
		}
		if (dir === root) {
			return null;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return null;
		}
		dir = parent;
	}
}

export interface AuditResult {
	finding: Finding;
	/**
	 * Human-readable place name derived from ExifTool's geolocation tags, when
	 * present. Null when the file has no GPS metadata or geolocation lookup did
	 * not produce a match.
	 */
	location: string | null;
	/** Camera Make and Model as extracted from the file's metadata. */
	cameraInfo: CameraInfo;
	/** Stable key used to dedupe iMessage near-duplicates. Null for filesystem entries. */
	dedupeKey: string | null;
}

/**
 * Audit a single file: compare its metadata date against name and folder.
 *
 * `homeZone` is the IANA timezone used to resolve defaulted-UTC video dates
 * into a calendar date (see {@link extractMetadataDate}). The returned
 * {@link AuditResult.location} is non-null only when ExifTool was launched
 * with `geolocation: true` and the file carried valid GPS coordinates.
 */
export async function auditFile(
	exiftool: ExifTool,
	path: string,
	root: string,
	homeZone: string,
): Promise<AuditResult> {
	const tags = await exiftool.read(path);
	const dateOrEdit = extractDateOrEdit(tags, homeZone);
	const finding = classify({
		path,
		metadataDate: dateOrEdit?.kind === 'capture' ? dateOrEdit.metadata.date : null,
		metadataConfidence: dateOrEdit?.kind === 'capture' ? dateOrEdit.metadata.confidence : 'high',
		...(dateOrEdit?.kind === 'edit-derived'
			? {
					editDerived: {
						firstEdit: dateOrEdit.firstEdit,
						lastEdit: dateOrEdit.lastEdit,
						software: dateOrEdit.software,
					},
				}
			: {}),
		filenameDate: parseDateFromString(basename(path)),
		folderDate: folderDateFor(path, root),
	});
	return {finding, location: formatPlaceFromTags(tags), cameraInfo: extractCameraInfo(tags), dedupeKey: null};
}

/**
 * Audit an iMessage attachment using its chat.db row as a date fallback.
 *
 * Resolution rules (see plan `2026-05-26-imessage-attachment-audit.md`):
 *
 * 1. No EXIF capture date (or only edit-derived stamps): synthesize the
 *    chat.db wall-clock as `chat-db` confidence. When no chat.db date exists
 *    either, fall through to `NO_METADATA_DATE`.
 * 2. EXIF capture exists but is `date-only` (midnight sentinel) AND chat.db
 *    has a real wall-clock: swap in the chat.db date with `chat-db`.
 * 3. Otherwise (high-confidence EXIF), classify with the EXIF date as-is.
 *
 * `filenameDate` and `folderDate` are always `null` for iMessage attachments
 * — the UUID-hashed parent folders carry no calendar meaning.
 */
export async function auditImessageFile(
	exiftool: ExifTool,
	attachment: AttachmentRow,
	homeZone: string,
): Promise<AuditResult> {
	const tags = await exiftool.read(attachment.absPath);
	const capture = extractDateOrEdit(tags, homeZone);
	const fallbackDate = attachment.messageDate ?? attachment.createdDate;
	const fallbackParts = dateToPartsInZone(fallbackDate, homeZone);

	let metadataDate: DateParts | null;
	let metadataConfidence: MetadataConfidence;

	if (capture === null || capture.kind === 'edit-derived') {
		// Edit-derived stamps are not real capture dates and the UUID parent
		// folder carries no calendar meaning, so chat.db is the only signal;
		// when it too is empty we report NO_METADATA_DATE (not EDIT_DERIVED).
		metadataDate = fallbackParts;
		metadataConfidence = fallbackParts === null ? 'high' : 'chat-db';
	} else if (capture.metadata.confidence === 'date-only' && fallbackParts !== null) {
		metadataDate = fallbackParts;
		metadataConfidence = 'chat-db';
	} else {
		metadataDate = capture.metadata.date;
		metadataConfidence = capture.metadata.confidence;
	}

	const finding = classify({
		path: attachment.absPath,
		metadataDate,
		metadataConfidence,
		filenameDate: null,
		folderDate: null,
	});
	return {
		finding,
		location: formatPlaceFromTags(tags),
		cameraInfo: extractCameraInfo(tags),
		dedupeKey: extractImessageDedupeKey(tags, attachment.mimeType, homeZone),
	};
}
