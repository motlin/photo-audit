import {basename, dirname} from 'node:path';
import type {ExifTool} from 'exiftool-vendored';
import {classify, type Finding} from './classify.ts';
import type {DateParts} from './dateParts.ts';
import {formatPlaceFromTags} from './geocode.ts';
import {extractDateOrEdit} from './metadata.ts';
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
	return {finding, location: formatPlaceFromTags(tags)};
}
