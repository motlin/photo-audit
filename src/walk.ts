import {readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';

const MEDIA_EXTENSIONS = new Set([
	'jpg',
	'jpeg',
	'png',
	'heic',
	'heif',
	'gif',
	'tiff',
	'tif',
	'bmp',
	'webp',
	'dng',
	'cr2',
	'cr3',
	'nef',
	'arw',
	'orf',
	'raf',
	'rw2',
	'pef',
	'srw',
	'mov',
	'mp4',
	'm4v',
	'avi',
	'mpg',
	'mpeg',
	'3gp',
	'3g2',
	'mts',
	'm2ts',
	'wmv',
]);

function isMediaFile(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot < 0) {
		return false;
	}
	return MEDIA_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * True when `dir` is at or below `excludeRoot`. Used to keep the walk from
 * descending into the `--output` hierarchy when it sits inside the scanned
 * tree — otherwise a whole-volume run would re-discover the organized hard
 * links it just created and try to link them again.
 */
function isWithin(dir: string, excludeRoot: string): boolean {
	const rel = relative(excludeRoot, dir);
	return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

/**
 * Recursively yield absolute paths of media files under `root`.
 *
 * Skips hidden entries — that excludes macOS AppleDouble (`._*`) sidecars and
 * package directories (`.photoslibrary`, `.lrdata`) that are not loose photos.
 * When `excludeRoot` is given, the subtree at or below it is skipped entirely
 * (so the output hierarchy is never re-walked into the plan). Pass absolute,
 * resolved paths so the prefix comparison is reliable.
 */
export async function* walkMedia(root: string, excludeRoot?: string): AsyncGenerator<string> {
	if (excludeRoot !== undefined && isWithin(root, excludeRoot)) {
		return;
	}
	let entries;
	try {
		entries = await readdir(root, {withFileTypes: true});
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith('.')) {
			continue;
		}
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			yield* walkMedia(full, excludeRoot);
		} else if (entry.isFile() && isMediaFile(entry.name)) {
			yield full;
		}
	}
}
