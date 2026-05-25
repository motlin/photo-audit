import {basename, dirname} from 'node:path';
import type {ExifTool} from 'exiftool-vendored';
import {classify, type Finding} from './classify.ts';
import type {DateParts} from './dateParts.ts';
import {extractMetadataDate} from './metadata.ts';
import {parseDateFromString} from './parseDate.ts';

/**
 * Date of the nearest ancestor folder that has one, searching from the file's
 * immediate parent upward and stopping at `root`.
 */
export function folderDateFor(filePath: string, root: string): DateParts | null {
	let dir = dirname(filePath);
	for (;;) {
		const parsed = parseDateFromString(basename(dir));
		if (parsed !== null) {
			return parsed;
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

/**
 * Audit a single file: compare its metadata date against name and folder.
 *
 * `homeZone` is the IANA timezone used to resolve defaulted-UTC video dates
 * into a calendar date (see {@link extractMetadataDate}).
 */
export async function auditFile(exiftool: ExifTool, path: string, root: string, homeZone: string): Promise<Finding> {
	const tags = await exiftool.read(path);
	const metadata = extractMetadataDate(tags, homeZone);
	return classify({
		path,
		metadataDate: metadata?.date ?? null,
		metadataConfidence: metadata?.confidence ?? 'high',
		filenameDate: parseDateFromString(basename(path)),
		folderDate: folderDateFor(path, root),
	});
}
