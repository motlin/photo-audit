import {readdir} from 'node:fs/promises';
import {join} from 'node:path';

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
 * Recursively yield absolute paths of media files under `root`.
 *
 * Skips hidden entries — that excludes macOS AppleDouble (`._*`) sidecars and
 * package directories (`.photoslibrary`, `.lrdata`) that are not loose photos.
 */
export async function* walkMedia(root: string): AsyncGenerator<string> {
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
			yield* walkMedia(full);
		} else if (entry.isFile() && isMediaFile(entry.name)) {
			yield full;
		}
	}
}
