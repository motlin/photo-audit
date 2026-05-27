import {basename, dirname, join, relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ExifTool} from 'exiftool-vendored';
import {mkdir} from 'node:fs/promises';
import {applyLinks} from './applyLink.ts';
import {applyUndo, parseUndoLog} from './applyUndo.ts';
import {auditFile, datedAncestorFolder} from './audit.ts';
import type {Finding} from './classify.ts';
import {formatDate} from './dateParts.ts';
import {type ProposedRename} from './fix.ts';
import {formatCameraSuffix, type CameraInfo} from './metadata.ts';
import {computeOutputDirectory} from './outputPath.ts';
import {type PlanEntry, readPlanFile, writePlanFile} from './plan.ts';
import {probeHardLinkSupport} from './probeHardLink.ts';
import {planFolderWarnings, type DatedFolder, type FolderFileEntry, type FolderWarning} from './folderWarnings.ts';
import {parseDateFromString} from './parseDate.ts';
import {proposeFilename} from './proposeName.ts';
import {walkMedia} from './walk.ts';

const USAGE = `Usage: just audit "<directory>" [--limit N] [--show-all] [--zone IANA]
                                  [--fix | --plan FILE | --apply FILE | --undo]
                                  [--help]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename. Folder dates are informational only
(they can confirm a file but never flag it as wrong).

  --limit N      stop after auditing N files (useful for a quick sample)
  --show-all     also print MISSING_DATE and NO_METADATA_DATE findings
  --zone IANA    timezone for resolving UTC-only video dates
                 (default: this machine's timezone)
  --fix          add a correctly-dated hard-linked alias next to every
                 WRONG_DATE / MISSING_DATE file whose metadata is high-
                 confidence. Originals are preserved; the new alias points
                 at the same inode. Every link is logged to
                 <directory>/photo-audit-renames.log for --undo.
  --plan FILE    scan and write a JSON-Lines plan of proposed links to FILE.
                 No files are modified. Review/edit the file (delete lines
                 to skip), then apply with --apply.
  --apply FILE   read a plan from FILE and apply it. Undo log is still
                 written under <directory> (or under --output if given).
  --strip-camera-id
                 when proposing names, drop camera-firmware stems like
                 IMG_063842, DSC_1234, PXL_20240315_..., so the new name is
                 just the date prefix + extension. Human-named stems are
                 always preserved.
  --output ROOT  put new hard-linked aliases under a separate hierarchy at
                 ROOT: <ROOT>/<YYYY0> Decade/<YYYY>/<YYYY-MM>/<YYYY-MM-DD
                 [suffix]>/. The suffix prefers a user-curated folder title
                 (date-stripped), falls back to the GPS place name. ROOT
                 must be on the same filesystem as <directory> for hard
                 links to work. Undo log lands at <ROOT>/photo-audit-renames.log.
  --undo         read <directory>/photo-audit-renames.log and remove every
                 aliased path still hard-linked to its original. Skips
                 entries where the alias was replaced or the original is
                 missing.
  --help         print this message and exit
`;

const UNDO_LOG_NAME = 'photo-audit-renames.log';

function printLocation(location: string | null): void {
	if (location !== null) {
		console.log(`  location  : ${location}`);
	}
}

function printWrongDate(
	finding: Extract<Finding, {kind: 'WRONG_DATE'}>,
	root: string,
	location: string | null,
	cameraInfo: CameraInfo,
	stripCameraId: boolean,
): void {
	const name = basename(finding.path);
	console.log(`\nWRONG DATE  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}`);
	for (const conflict of finding.conflicts) {
		console.log(`  ${conflict.source.padEnd(10)}: ${formatDate(conflict.found)}  <- disagrees`);
	}
	printLocation(location);
	const cameraSuffix = formatCameraSuffix(cameraInfo);
	console.log(`  rename to : ${proposeFilename(name, finding.metadataDate, {stripCameraId, cameraSuffix})}`);
}

function printMissingDate(
	finding: Extract<Finding, {kind: 'MISSING_DATE'}>,
	root: string,
	location: string | null,
	cameraInfo: CameraInfo,
	stripCameraId: boolean,
): void {
	console.log(`\nMISSING DATE  ${relative(root, finding.path)}`);
	console.log(`  computed  : ${formatDate(finding.metadataDate)}`);
	printLocation(location);
	const cameraSuffix = formatCameraSuffix(cameraInfo);
	console.log(
		`  rename to : ${proposeFilename(basename(finding.path), finding.metadataDate, {stripCameraId, cameraSuffix})}`,
	);
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

type Fixable = Extract<Finding, {kind: 'WRONG_DATE' | 'MISSING_DATE'}>;
interface FixableEntry {
	finding: Fixable;
	cameraInfo: CameraInfo;
	location: string | null;
}

interface PlanOptions {
	stripCameraId: boolean;
	outputRoot: string | null;
}

/**
 * Build the list of hard-link plan entries for fixable findings, dropping
 * those whose metadata is date-only and printing a skip reason for each one
 * held back. When `outputRoot` is set, targets are placed under a new
 * decade/year/month/day hierarchy instead of next to the originals.
 */
function planLinksFromFindings(entries: readonly FixableEntry[], root: string, options: PlanOptions): PlanEntry[] {
	const plan: PlanEntry[] = [];
	for (const {finding, cameraInfo, location} of entries) {
		if (finding.metadataConfidence !== 'high') {
			console.log(`SKIPPED (metadata is date-only): ${relative(root, finding.path)}`);
			continue;
		}
		const proposed = proposeFilename(basename(finding.path), finding.metadataDate, {
			stripCameraId: options.stripCameraId,
			cameraSuffix: formatCameraSuffix(cameraInfo),
		});
		const targetDir =
			options.outputRoot === null
				? dirname(finding.path)
				: computeOutputDirectory({
						outputRoot: options.outputRoot,
						metadataDate: finding.metadataDate,
						sourceFolderName: basename(dirname(finding.path)),
						place: location,
					});
		plan.push({from: finding.path, to: join(targetDir, proposed), kind: finding.kind});
	}
	return plan;
}

/**
 * Apply a list of plan entries by creating hard links and logging each one to
 * the undo log at `undoLogPath`. Creates any missing parent directories of
 * `to` paths.
 */
async function applyPlan(plan: readonly PlanEntry[], undoLogPath: string): Promise<void> {
	for (const {to} of plan) {
		await mkdir(dirname(to), {recursive: true});
	}
	const candidates: ProposedRename[] = plan.map(({from, to}) => ({from, to}));
	const outcomes = await applyLinks(candidates, undoLogPath, () => new Date().toISOString());
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
			plan: {type: 'string'},
			apply: {type: 'string'},
			'strip-camera-id': {type: 'boolean', default: false},
			output: {type: 'string'},
			help: {type: 'boolean', short: 'h', default: false},
		},
	});

	if (values.help) {
		console.log(USAGE);
		return;
	}

	const exclusiveModes = [values.fix, values.undo, values.plan !== undefined, values.apply !== undefined].filter(
		Boolean,
	).length;
	if (exclusiveModes > 1) {
		console.error('Error: --fix, --undo, --plan, and --apply are mutually exclusive.');
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

	const outputRoot = values.output === undefined ? null : resolve(values.output);
	const undoLogPath = join(outputRoot ?? root, UNDO_LOG_NAME);

	if (values.undo) {
		await runUndo(outputRoot ?? root);
		return;
	}

	if (values.apply !== undefined) {
		const plan = await readPlanFile(values.apply);
		if (plan.length === 0) {
			console.log(`Plan ${values.apply} is empty (nothing to apply).`);
			return;
		}
		await mkdir(outputRoot ?? root, {recursive: true});
		const probeSource = plan[0]?.from;
		if (probeSource !== undefined && !(await probeHardLinkSupport(probeSource, outputRoot ?? root))) {
			console.error(
				`Error: cannot create hard links from ${probeSource} into ${outputRoot ?? root}. Either the destination filesystem does not support hard links (ExFAT/FAT/SMB) or source and destination are on different filesystems (cross-device link not permitted). --fix and --apply require source and destination on the same APFS or HFS+ volume.`,
			);
			process.exitCode = 1;
			return;
		}
		console.log(`Applying ${plan.length} entries from ${values.apply}`);
		await applyPlan(plan, undoLogPath);
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

	const fixableEntries: FixableEntry[] = [];
	const folderEntries: FolderFileEntry[] = [];
	const datedFolders = new Map<string, DatedFolder>();
	const exiftool = new ExifTool({geolocation: true});
	let scanned = 0;
	try {
		for await (const path of walkMedia(root)) {
			if (scanned >= limit) {
				break;
			}
			const {finding, location, cameraInfo} = await auditFile(exiftool, path, root, homeZone);
			counts[finding.kind] += 1;
			scanned += 1;

			if (finding.kind === 'WRONG_DATE') {
				printWrongDate(finding, root, location, cameraInfo, values['strip-camera-id']);
				fixableEntries.push({finding, cameraInfo, location});
			} else if (finding.kind === 'METADATA_SUSPECT') {
				printMetadataSuspect(finding, root, location);
			} else if (finding.kind === 'EDIT_DERIVED') {
				printEditDerived(finding, root, location);
			} else if (finding.kind === 'MISSING_DATE') {
				fixableEntries.push({finding, cameraInfo, location});
				if (values['show-all']) {
					printMissingDate(finding, root, location, cameraInfo, values['strip-camera-id']);
				}
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

	if (fixableEntries.length > 0 && (values.fix || values.plan !== undefined)) {
		console.log(`\n${'-'.repeat(48)}`);
		const plan = planLinksFromFindings(fixableEntries, root, {
			stripCameraId: values['strip-camera-id'],
			outputRoot,
		});
		if (values.plan !== undefined) {
			await writePlanFile(values.plan, plan);
			console.log(`Wrote ${plan.length} plan entries to ${values.plan}`);
		} else {
			await mkdir(outputRoot ?? root, {recursive: true});
			const probeSource = plan[0]?.from;
			if (probeSource !== undefined && !(await probeHardLinkSupport(probeSource, outputRoot ?? root))) {
				console.error(
					`Error: cannot create hard links from ${probeSource} into ${outputRoot ?? root}. Either the destination filesystem does not support hard links (ExFAT/FAT/SMB) or source and destination are on different filesystems (cross-device link not permitted). --fix requires source and destination on the same APFS or HFS+ volume.`,
				);
				process.exitCode = 1;
				return;
			}
			console.log('Applying --fix file links');
			await applyPlan(plan, undoLogPath);
		}
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
