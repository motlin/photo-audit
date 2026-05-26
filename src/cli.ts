import {basename, dirname, join, relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ExifTool} from 'exiftool-vendored';
import {applyLinks} from './applyLink.ts';
import {applyUndo, parseUndoLog} from './applyUndo.ts';
import {auditFile, datedAncestorFolder} from './audit.ts';
import type {Finding} from './classify.ts';
import {formatDate} from './dateParts.ts';
import {type ProposedRename} from './fix.ts';
import {planFolderWarnings, type DatedFolder, type FolderFileEntry, type FolderWarning} from './folderWarnings.ts';
import {parseDateFromString} from './parseDate.ts';
import {proposeFilename} from './proposeName.ts';
import {walkMedia} from './walk.ts';

const USAGE = `Usage: just audit "<directory>" [--limit N] [--show-all] [--zone IANA] [--fix | --undo] [--help]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename. Folder dates are informational only
(they can confirm a file but never flag it as wrong).

  --limit N      stop after auditing N files (useful for a quick sample)
  --show-all     also print MISSING_DATE and NO_METADATA_DATE findings
  --zone IANA    timezone for resolving UTC-only video dates
                 (default: this machine's timezone)
  --fix          add a correctly-dated hard-linked alias next to every
                 WRONG_DATE file whose metadata is high-confidence. Original
                 paths are preserved; the new alias points at the same inode.
                 Every link is logged to photo-audit-renames.log for --undo.
  --undo         read photo-audit-renames.log under <directory> and remove
                 every aliased path that is still hard-linked to its original.
                 Skips entries where the alias was replaced or the original
                 is missing.
  --help         print this message and exit
`;

const UNDO_LOG_NAME = 'photo-audit-renames.log';

function printLocation(location: string | null): void {
	if (location !== null) {
		console.log(`  location  : ${location}`);
	}
}

function printWrongDate(finding: Extract<Finding, {kind: 'WRONG_DATE'}>, root: string, location: string | null): void {
	const name = basename(finding.path);
	console.log(`\nWRONG DATE  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}`);
	for (const conflict of finding.conflicts) {
		console.log(`  ${conflict.source.padEnd(10)}: ${formatDate(conflict.found)}  <- disagrees`);
	}
	printLocation(location);
	console.log(`  rename to : ${proposeFilename(name, finding.metadataDate)}`);
}

function printMissingDate(
	finding: Extract<Finding, {kind: 'MISSING_DATE'}>,
	root: string,
	location: string | null,
): void {
	console.log(`\nMISSING DATE  ${relative(root, finding.path)}`);
	console.log(`  computed  : ${formatDate(finding.metadataDate)}`);
	printLocation(location);
	console.log(`  rename to : ${proposeFilename(basename(finding.path), finding.metadataDate)}`);
}

function printMetadataSuspect(
	finding: Extract<Finding, {kind: 'METADATA_SUSPECT'}>,
	root: string,
	location: string | null,
): void {
	console.log(`\nMETADATA SUSPECT  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}  <- date-only / low-confidence`);
	console.log(`  filename  : ${finding.filenameDate === null ? '-' : formatDate(finding.filenameDate)}`);
	console.log(`  folder    : ${finding.folderDate === null ? '-' : formatDate(finding.folderDate)}`);
	printLocation(location);
}

function printEditDerived(
	finding: Extract<Finding, {kind: 'EDIT_DERIVED'}>,
	root: string,
	location: string | null,
): void {
	console.log(`\nEDIT DERIVED  ${relative(root, finding.path)}`);
	console.log(`  no capture date available`);
	console.log(`  software  : ${finding.software}`);
	console.log(`  edited    : ${formatDate(finding.firstEdit)} -> ${formatDate(finding.lastEdit)}`);
	printLocation(location);
}

function printFolderWarning(warning: FolderWarning, root: string): void {
	if (warning.kind === 'FOLDER_UNIFORM_METADATA') {
		console.log(`\nFOLDER UNIFORM METADATA  ${relative(root, warning.folderPath)}`);
		console.log(`  folder    : ${formatDate(warning.folderDate)}`);
		console.log(`  all ${warning.fileCount} files share metadata: ${formatDate(warning.sharedTimestamp)}`);
		console.log(`  metadata is likely a file-mtime fallback rather than a real capture date`);
	} else {
		console.log(`\nFOLDER AFTER FILES  ${relative(root, warning.folderPath)}`);
		console.log(`  folder    : ${formatDate(warning.folderDate)}  <- after every file`);
		console.log(
			`  files     : ${formatDate(warning.earliestFile)} .. ${formatDate(warning.latestFile)}  (${warning.fileCount} files)`,
		);
	}
}

/**
 * Add a correctly-dated hard-linked alias for each WRONG_DATE finding whose
 * metadata is high-confidence. The original path stays in place; the new path
 * is a second name for the same inode. Skipped cases are printed with a
 * labelled reason so the user can see what was held back and why.
 */
async function applyFixes(
	wrongDateFindings: readonly Extract<Finding, {kind: 'WRONG_DATE'}>[],
	root: string,
): Promise<void> {
	const linkCandidates: ProposedRename[] = [];
	for (const finding of wrongDateFindings) {
		if (finding.metadataConfidence !== 'high') {
			console.log(`SKIPPED (metadata is date-only): ${relative(root, finding.path)}`);
			continue;
		}
		const dir = dirname(finding.path);
		const proposed = proposeFilename(basename(finding.path), finding.metadataDate);
		linkCandidates.push({from: finding.path, to: join(dir, proposed)});
	}

	const undoLogPath = join(root, UNDO_LOG_NAME);
	const outcomes = await applyLinks(linkCandidates, undoLogPath, () => new Date().toISOString());
	for (const outcome of outcomes) {
		if (outcome.kind === 'linked') {
			console.log(`LINKED ${outcome.from} -> ${outcome.to}`);
		} else if (outcome.kind === 'skipped-collision') {
			console.log(`SKIPPED (proposed-name collision): ${outcome.from} -> ${outcome.to}`);
		} else {
			console.log(`SKIPPED (target exists): ${outcome.from} -> ${outcome.to}`);
		}
	}
}

async function runUndo(root: string): Promise<void> {
	const undoLogPath = join(root, UNDO_LOG_NAME);
	const entries = await parseUndoLog(undoLogPath);
	if (entries.length === 0) {
		console.log(`No undo log found at ${undoLogPath} (nothing to undo).`);
		return;
	}
	console.log(`Undoing ${entries.length} entries from ${undoLogPath}`);
	const outcomes = await applyUndo(entries);
	const counts = {unlinked: 0, 'skipped-missing-target': 0, 'skipped-missing-original': 0, 'skipped-link-severed': 0};
	for (const outcome of outcomes) {
		counts[outcome.kind] += 1;
		if (outcome.kind === 'unlinked') {
			console.log(`UNLINKED ${outcome.to}`);
		} else if (outcome.kind === 'skipped-missing-target') {
			console.log(`SKIPPED (alias already gone): ${outcome.to}`);
		} else if (outcome.kind === 'skipped-missing-original') {
			console.log(`SKIPPED (original missing, cannot verify): ${outcome.from} -> ${outcome.to}`);
		} else {
			console.log(`SKIPPED (link severed, alias was replaced): ${outcome.from} -> ${outcome.to}`);
		}
	}
	console.log(`\n${'='.repeat(48)}`);
	console.log(`Undo summary`);
	console.log(`  unlinked                ${counts.unlinked}`);
	console.log(`  skipped (already gone)  ${counts['skipped-missing-target']}`);
	console.log(`  skipped (orig missing)  ${counts['skipped-missing-original']}`);
	console.log(`  skipped (link severed)  ${counts['skipped-link-severed']}`);
}

async function main(): Promise<void> {
	const {values, positionals} = parseArgs({
		allowPositionals: true,
		options: {
			limit: {type: 'string'},
			'show-all': {type: 'boolean', default: false},
			zone: {type: 'string'},
			fix: {type: 'boolean', default: false},
			undo: {type: 'boolean', default: false},
			help: {type: 'boolean', short: 'h', default: false},
		},
	});

	if (values.help) {
		console.log(USAGE);
		return;
	}

	if (values.fix && values.undo) {
		console.error('Error: --fix and --undo are mutually exclusive.');
		process.exitCode = 1;
		return;
	}

	const target = positionals[0];
	if (target === undefined) {
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}
	const root = resolve(target);

	if (values.undo) {
		await runUndo(root);
		return;
	}
	const limit = values.limit === undefined ? Infinity : Number(values.limit);
	const homeZone = values.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const counts: Record<Finding['kind'], number> = {
		CONSISTENT: 0,
		WRONG_DATE: 0,
		METADATA_SUSPECT: 0,
		EDIT_DERIVED: 0,
		MISSING_DATE: 0,
		NO_METADATA_DATE: 0,
	};

	const wrongDateFindings: Extract<Finding, {kind: 'WRONG_DATE'}>[] = [];
	const folderEntries: FolderFileEntry[] = [];
	const datedFolders = new Map<string, DatedFolder>();
	const exiftool = new ExifTool({geolocation: true});
	let scanned = 0;
	try {
		for await (const path of walkMedia(root)) {
			if (scanned >= limit) {
				break;
			}
			const {finding, location} = await auditFile(exiftool, path, root, homeZone);
			counts[finding.kind] += 1;
			scanned += 1;

			if (finding.kind === 'WRONG_DATE') {
				printWrongDate(finding, root, location);
				wrongDateFindings.push(finding);
			} else if (finding.kind === 'METADATA_SUSPECT') {
				printMetadataSuspect(finding, root, location);
			} else if (finding.kind === 'EDIT_DERIVED') {
				printEditDerived(finding, root, location);
			} else if (finding.kind === 'MISSING_DATE' && values['show-all']) {
				printMissingDate(finding, root, location);
			} else if (finding.kind === 'NO_METADATA_DATE' && values['show-all']) {
				console.log(`\nNO METADATA DATE  ${relative(root, finding.path)}`);
			}

			if (finding.kind === 'CONSISTENT' || finding.kind === 'WRONG_DATE' || finding.kind === 'MISSING_DATE') {
				const folderPath = datedAncestorFolder(path, root);
				if (folderPath !== null) {
					if (!datedFolders.has(folderPath)) {
						const folderDate = parseDateFromString(basename(folderPath));
						if (folderDate !== null) {
							datedFolders.set(folderPath, {folderPath, folderDate});
						}
					}
					folderEntries.push({path, metadataDate: finding.metadataDate, folderPath});
				}
			}

			if (scanned % 200 === 0) {
				process.stderr.write(`  ...scanned ${scanned} files\r`);
			}
		}
	} finally {
		await exiftool.end();
	}

	const folderWarnings = planFolderWarnings(folderEntries, Array.from(datedFolders.values()));
	if (folderWarnings.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Folder-level warnings');
		for (const warning of folderWarnings) {
			printFolderWarning(warning, root);
		}
	}

	if (values.fix && wrongDateFindings.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Applying --fix file renames');
		await applyFixes(wrongDateFindings, root);
	}

	console.log(`\n${'='.repeat(48)}`);
	console.log(`Scanned ${scanned} files under ${root}`);
	console.log(`Home timezone for UTC-only video dates: ${homeZone}`);
	console.log(`  WRONG_DATE       ${counts.WRONG_DATE}`);
	console.log(`  METADATA_SUSPECT ${counts.METADATA_SUSPECT}`);
	console.log(`  EDIT_DERIVED     ${counts.EDIT_DERIVED}`);
	console.log(`  MISSING_DATE     ${counts.MISSING_DATE}`);
	console.log(`  NO_METADATA_DATE ${counts.NO_METADATA_DATE}`);
	console.log(`  CONSISTENT       ${counts.CONSISTENT}`);
	console.log(`  folder warnings  ${folderWarnings.length}`);
}

await main();
