import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ExifTool } from "exiftool-vendored";
import { auditFile } from "./audit.ts";
import { formatDate } from "./dateParts.ts";
import type { Finding } from "./classify.ts";
import { walkMedia } from "./walk.ts";

const USAGE = `Usage: npm run audit -- <directory> [--limit N] [--show-all]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename and ancestor folders.

  --limit N    stop after auditing N files (useful for a quick sample)
  --show-all   also print MISSING_DATE and NO_METADATA_DATE findings
`;

function printWrongDate(finding: Extract<Finding, { kind: "WRONG_DATE" }>, root: string): void {
	console.log(`\nWRONG DATE  ${relative(root, finding.path)}`);
	console.log(`  metadata : ${formatDate(finding.metadataDate)}`);
	for (const conflict of finding.conflicts) {
		console.log(`  ${conflict.source.padEnd(9)}: ${formatDate(conflict.found)}  <- disagrees`);
	}
}

async function main(): Promise<void> {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			limit: { type: "string" },
			"show-all": { type: "boolean", default: false },
		},
	});

	const target = positionals[0];
	if (target === undefined) {
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}
	const root = resolve(target);
	const limit = values.limit === undefined ? Infinity : Number(values.limit);

	const counts: Record<Finding["kind"], number> = {
		CONSISTENT: 0,
		WRONG_DATE: 0,
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
			const finding = await auditFile(exiftool, path, root);
			counts[finding.kind] += 1;
			scanned += 1;

			if (finding.kind === "WRONG_DATE") {
				printWrongDate(finding, root);
			} else if (values["show-all"] && finding.kind !== "CONSISTENT") {
				console.log(`${finding.kind}  ${relative(root, finding.path)}`);
			}

			if (scanned % 200 === 0) {
				process.stderr.write(`  ...scanned ${scanned} files\r`);
			}
		}
	} finally {
		await exiftool.end();
	}

	console.log(`\n${"=".repeat(48)}`);
	console.log(`Scanned ${scanned} files under ${root}`);
	console.log(`  WRONG_DATE       ${counts.WRONG_DATE}`);
	console.log(`  MISSING_DATE     ${counts.MISSING_DATE}`);
	console.log(`  NO_METADATA_DATE ${counts.NO_METADATA_DATE}`);
	console.log(`  CONSISTENT       ${counts.CONSISTENT}`);
}

await main();
