import {access, link, mkdtemp, rm, unlink} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Return true when a hard link from `sourceFile` can be created inside
 * `destinationDir`. Catches both filesystems that do not support hard links
 * (ENOTSUP, e.g. ExFAT) and cross-filesystem attempts (EXDEV).
 */
export async function probeHardLinkSupport(sourceFile: string, destinationDir: string): Promise<boolean> {
	try {
		await access(sourceFile);
	} catch {
		return false;
	}
	let probeDir: string;
	try {
		probeDir = await mkdtemp(join(destinationDir, '.photo-audit-probe-'));
	} catch {
		return false;
	}
	const target = join(probeDir, 'target');
	try {
		await link(sourceFile, target);
		await unlink(target);
		return true;
	} catch {
		return false;
	} finally {
		await rm(probeDir, {recursive: true, force: true});
	}
}
