import {link, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Return true when hard links can be created inside `directory`. Used as a
 * pre-flight check before --fix / --apply, so the tool can refuse cleanly
 * on filesystems like ExFAT that do not support hard links.
 */
export async function probeHardLinkSupport(directory: string): Promise<boolean> {
	let probeDir: string;
	try {
		probeDir = await mkdtemp(join(directory, '.photo-audit-probe-'));
	} catch {
		return false;
	}
	const source = join(probeDir, 'source');
	const target = join(probeDir, 'target');
	try {
		await writeFile(source, '');
		await link(source, target);
		return true;
	} catch {
		return false;
	} finally {
		await rm(probeDir, {recursive: true, force: true});
	}
}
