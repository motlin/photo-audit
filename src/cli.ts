import {appendFile, access, rename} from 'node:fs/promises';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ExifTool} from 'exiftool-vendored';
import {auditFile, datedAncestorFolder} from './audit.ts';
import type {Finding} from './classify.ts';
import {datesAgree, formatDate, type DateParts} from './dateParts.ts';
import {collisionsIn, folderConsensus, formatUndoLogEntry, type ProposedRename} from './fix.ts';
import {parseDateFromString} from './parseDate.ts';
import {proposeFilename, proposeFolderName} from './proposeName.ts';
import {walkMedia} from './walk.ts';

const USAGE = `Usage: just audit "<directory>" [--limit N] [--show-all] [--zone IANA] [--fix] [--help]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename and ancestor folders.

  --limit N      stop after auditing N files (useful for a quick sample)
  --show-all     also print MISSING_DATE and NO_METADATA_DATE findings
  --zone IANA    timezone for resolving UTC-only video dates
                 (default: this machine's timezone)
  --fix          rename files whose filename date disagrees with high-confidence
                 metadata (default: dry-run/report-only)
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
	if (finding.conflicts.some((conflict) => conflict.source === 'filename')) {
		console.log(`  rename to : ${proposeFilename(name, finding.metadataDate)}`);
	}
	if (finding.conflicts.some((conflict) => conflict.source === 'folder')) {
		console.log(`  folder    : disagrees (grouped folder-rename report follows)`);
	}
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

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

interface FolderRenameProposal {
	folderPath: string;
	folderDate: DateParts;
	consensusDate: DateParts;
	agreeing: number;
	total: number;
	proposedName: string;
}

interface FolderRefusal {
	folderPath: string;
	folderDate: DateParts;
	files: {path: string; metadataDate: DateParts}[];
}

/**
 * Group folder-conflict WRONG_DATE findings by their nearest dated ancestor
 * folder, then split into proposals (the folder's files agree on a single
 * different date) and refusals (the files disagree below threshold).
 */
function planFolderRenames(
	findings: readonly Extract<Finding, {kind: 'WRONG_DATE'}>[],
	root: string,
): {proposals: FolderRenameProposal[]; refusals: FolderRefusal[]} {
	const groups = new Map<string, Extract<Finding, {kind: 'WRONG_DATE'}>[]>();
	for (const finding of findings) {
		const hasFolderConflict = finding.conflicts.some((conflict) => conflict.source === 'folder');
		if (!hasFolderConflict) {
			continue;
		}
		const folderPath = datedAncestorFolder(finding.path, root);
		if (folderPath === null) {
			continue;
		}
		const bucket = groups.get(folderPath);
		if (bucket === undefined) {
			groups.set(folderPath, [finding]);
		} else {
			bucket.push(finding);
		}
	}

	const proposals: FolderRenameProposal[] = [];
	const refusals: FolderRefusal[] = [];
	for (const [folderPath, members] of groups) {
		const folderDate = parseDateFromString(basename(folderPath));
		if (folderDate === null) {
			continue;
		}
		const consensus = folderConsensus(members.map((finding) => finding.metadataDate));
		if (consensus === null || datesAgree(consensus.date, folderDate)) {
			refusals.push({
				folderPath,
				folderDate,
				files: members.map((finding) => ({path: finding.path, metadataDate: finding.metadataDate})),
			});
			continue;
		}
		proposals.push({
			folderPath,
			folderDate,
			consensusDate: consensus.date,
			agreeing: consensus.agreeing,
			total: consensus.total,
			proposedName: proposeFolderName(basename(folderPath), consensus.date),
		});
	}
	return {proposals, refusals};
}

function printFolderRenames(
	{proposals, refusals}: {proposals: FolderRenameProposal[]; refusals: FolderRefusal[]},
	root: string,
): void {
	for (const proposal of proposals) {
		console.log(`\nFOLDER RENAME  ${relative(root, proposal.folderPath)}`);
		console.log(`  current   : ${formatDate(proposal.folderDate)}`);
		console.log(
			`  consensus : ${formatDate(proposal.consensusDate)}  (${proposal.agreeing}/${proposal.total} files)`,
		);
		console.log(`  rename to : ${proposal.proposedName}`);
	}
	for (const refusal of refusals) {
		console.log(`\nFOLDER DISAGREEMENT  ${relative(root, refusal.folderPath)}`);
		console.log(`  current   : ${formatDate(refusal.folderDate)}`);
		console.log(`  files disagree below 80% threshold; per-file report:`);
		for (const file of refusal.files) {
			console.log(`    ${relative(root, file.path)}  -> ${formatDate(file.metadataDate)}`);
		}
	}
}

/**
 * Apply folder renames to disk. Logs every rename to the shared undo log and
 * skips any folder whose target already exists.
 */
async function applyFolderRenames(proposals: readonly FolderRenameProposal[], root: string): Promise<void> {
	const undoLogPath = join(root, UNDO_LOG_NAME);
	for (const proposal of proposals) {
		const to = join(dirname(proposal.folderPath), proposal.proposedName);
		if (await pathExists(to)) {
			console.log(`SKIPPED FOLDER (target exists): ${proposal.folderPath} -> ${to}`);
			continue;
		}
		await rename(proposal.folderPath, to);
		const entry = formatUndoLogEntry({timestamp: new Date().toISOString(), from: proposal.folderPath, to});
		await appendFile(undoLogPath, entry);
		console.log(`RENAMED FOLDER ${proposal.folderPath} -> ${to}`);
	}
}

/**
 * Apply file renames for WRONG_DATE findings that name a precise filename
 * conflict against high-confidence metadata. Every other case is skipped with
 * a labelled reason so the user can see what was held back and why.
 */
async function applyFixes(
	wrongDateFindings: readonly Extract<Finding, {kind: 'WRONG_DATE'}>[],
	root: string,
): Promise<void> {
	const renameCandidates: ProposedRename[] = [];
	for (const finding of wrongDateFindings) {
		const filenameConflict = finding.conflicts.some((conflict) => conflict.source === 'filename');
		if (!filenameConflict) {
			continue;
		}
		if (finding.metadataConfidence !== 'high') {
			console.log(`SKIPPED (metadata is date-only): ${relative(root, finding.path)}`);
			continue;
		}
		const dir = dirname(finding.path);
		const proposed = proposeFilename(basename(finding.path), finding.metadataDate);
		renameCandidates.push({from: finding.path, to: join(dir, proposed)});
	}

	const collisions = collisionsIn(renameCandidates);
	const undoLogPath = join(root, UNDO_LOG_NAME);

	for (const {from, to} of renameCandidates) {
		if (collisions.has(to)) {
			console.log(`SKIPPED (proposed-name collision): ${from} -> ${to}`);
			continue;
		}
		if (await pathExists(to)) {
			console.log(`SKIPPED (target exists): ${from} -> ${to}`);
			continue;
		}
		await rename(from, to);
		const entry = formatUndoLogEntry({timestamp: new Date().toISOString(), from, to});
		await appendFile(undoLogPath, entry);
		console.log(`RENAMED ${from} -> ${to}`);
	}
}

async function main(): Promise<void> {
	const {values, positionals} = parseArgs({
		allowPositionals: true,
		options: {
			limit: {type: 'string'},
			'show-all': {type: 'boolean', default: false},
			zone: {type: 'string'},
			fix: {type: 'boolean', default: false},
			help: {type: 'boolean', short: 'h', default: false},
		},
	});

	if (values.help) {
		console.log(USAGE);
		return;
	}

	const target = positionals[0];
	if (target === undefined) {
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}
	const root = resolve(target);
	const limit = values.limit === undefined ? Infinity : Number(values.limit);
	const homeZone = values.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const counts: Record<Finding['kind'], number> = {
		CONSISTENT: 0,
		WRONG_DATE: 0,
		METADATA_SUSPECT: 0,
		MISSING_DATE: 0,
		NO_METADATA_DATE: 0,
	};

	const wrongDateFindings: Extract<Finding, {kind: 'WRONG_DATE'}>[] = [];
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
			} else if (finding.kind === 'MISSING_DATE' && values['show-all']) {
				printMissingDate(finding, root, location);
			} else if (finding.kind === 'NO_METADATA_DATE' && values['show-all']) {
				console.log(`\nNO METADATA DATE  ${relative(root, finding.path)}`);
			}

			if (scanned % 200 === 0) {
				process.stderr.write(`  ...scanned ${scanned} files\r`);
			}
		}
	} finally {
		await exiftool.end();
	}

	const folderPlan = planFolderRenames(wrongDateFindings, root);
	if (folderPlan.proposals.length > 0 || folderPlan.refusals.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Folder rename proposals');
		printFolderRenames(folderPlan, root);
	}

	if (values.fix && wrongDateFindings.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Applying --fix file renames');
		await applyFixes(wrongDateFindings, root);
	}
	if (values.fix && folderPlan.proposals.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Applying --fix folder renames');
		await applyFolderRenames(folderPlan.proposals, root);
	}

	console.log(`\n${'='.repeat(48)}`);
	console.log(`Scanned ${scanned} files under ${root}`);
	console.log(`Home timezone for UTC-only video dates: ${homeZone}`);
	console.log(`  WRONG_DATE       ${counts.WRONG_DATE}`);
	console.log(`  METADATA_SUSPECT ${counts.METADATA_SUSPECT}`);
	console.log(`  MISSING_DATE     ${counts.MISSING_DATE}`);
	console.log(`  NO_METADATA_DATE ${counts.NO_METADATA_DATE}`);
	console.log(`  CONSISTENT       ${counts.CONSISTENT}`);
}

await main();
