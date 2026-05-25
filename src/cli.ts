import {basename, relative, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {ExifTool} from 'exiftool-vendored';
import {auditFile} from './audit.ts';
import type {Finding} from './classify.ts';
import {formatDate} from './dateParts.ts';
import {proposeFilename} from './proposeName.ts';
import {walkMedia} from './walk.ts';

const USAGE = `Usage: just audit "<directory>" [--limit N] [--show-all] [--zone IANA] [--help]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename and ancestor folders.

  --limit N      stop after auditing N files (useful for a quick sample)
  --show-all     also print MISSING_DATE and NO_METADATA_DATE findings
  --zone IANA    timezone for resolving UTC-only video dates
                 (default: this machine's timezone)
  --help         print this message and exit
`;

function printWrongDate(finding: Extract<Finding, {kind: 'WRONG_DATE'}>, root: string): void {
	const name = basename(finding.path);
	console.log(`\nWRONG DATE  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}`);
	for (const conflict of finding.conflicts) {
		console.log(`  ${conflict.source.padEnd(10)}: ${formatDate(conflict.found)}  <- disagrees`);
	}
	if (finding.conflicts.some((conflict) => conflict.source === 'filename')) {
		console.log(`  rename to : ${proposeFilename(name, finding.metadataDate)}`);
	}
	if (finding.conflicts.some((conflict) => conflict.source === 'folder')) {
		console.log(`  folder    : should be dated ${formatDate({...finding.metadataDate, time: null})}`);
	}
}

function printMissingDate(finding: Extract<Finding, {kind: 'MISSING_DATE'}>, root: string): void {
	console.log(`\nMISSING DATE  ${relative(root, finding.path)}`);
	console.log(`  computed  : ${formatDate(finding.metadataDate)}`);
	console.log(`  rename to : ${proposeFilename(basename(finding.path), finding.metadataDate)}`);
}

function printMetadataSuspect(finding: Extract<Finding, {kind: 'METADATA_SUSPECT'}>, root: string): void {
	console.log(`\nMETADATA SUSPECT  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}  <- date-only / low-confidence`);
	console.log(`  filename  : ${finding.filenameDate === null ? '-' : formatDate(finding.filenameDate)}`);
	console.log(`  folder    : ${finding.folderDate === null ? '-' : formatDate(finding.folderDate)}`);
}

async function main(): Promise<void> {
	const {values, positionals} = parseArgs({
		allowPositionals: true,
		options: {
			limit: {type: 'string'},
			'show-all': {type: 'boolean', default: false},
			zone: {type: 'string'},
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

	const exiftool = new ExifTool();
	let scanned = 0;
	try {
		for await (const path of walkMedia(root)) {
			if (scanned >= limit) {
				break;
			}
			const finding = await auditFile(exiftool, path, root, homeZone);
			counts[finding.kind] += 1;
			scanned += 1;

			if (finding.kind === 'WRONG_DATE') {
				printWrongDate(finding, root);
			} else if (finding.kind === 'METADATA_SUSPECT') {
				printMetadataSuspect(finding, root);
			} else if (finding.kind === 'MISSING_DATE' && values['show-all']) {
				printMissingDate(finding, root);
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
