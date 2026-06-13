import {ExifTool} from 'exiftool-vendored';
import {spawn} from 'node:child_process';
import {access, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const CLI_ENTRY = resolve(import.meta.dirname, '..', 'src', 'cli.ts');
const TSX_BIN = resolve(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');

// Smallest plausible JPEG; exiftool-vendored can read tags after writing them.
// Same fixture as tests/audit.imessage.test.ts and tests/cli.imessage.test.ts.
const MINIMAL_JPEG_HEX =
	'ffd8ffe000104a46494600010100000100010000' +
	'ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
	'ffc0000b08000100010101001102ffc4001f0000010501010101010100000000000000000102030405060708090a0b' +
	'ffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa' +
	'ffda0008010100003f00d2cfffd9';

interface SpawnResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

function runCli(args: readonly string[]): Promise<SpawnResult> {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(TSX_BIN, [CLI_ENTRY, ...args], {stdio: ['ignore', 'pipe', 'pipe']});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk: Buffer) => {
			stdout += chunk.toString('utf8');
		});
		child.stderr.on('data', (chunk: Buffer) => {
			stderr += chunk.toString('utf8');
		});
		child.once('error', rejectPromise);
		child.once('close', (code) => {
			resolvePromise({code, stdout, stderr});
		});
	});
}

interface PlanEntry {
	from: string;
	to: string;
	kind: string;
}

async function readPlan(path: string): Promise<PlanEntry[]> {
	const raw = await readFile(path, 'utf8');
	return raw
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line) as PlanEntry);
}

describe('--link-all (organize a trusted export)', () => {
	let dir = '';
	let sourceRoot = '';
	let outputRoot = '';
	let exiftool: ExifTool;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-organize-'));
		sourceRoot = join(dir, 'export');
		outputRoot = join(dir, 'organized');
		exiftool = new ExifTool({geolocation: true});
		// A trusted, already-dated iMazing-style export: an event folder whose
		// name carries the date and the event, holding a camera-id-named photo
		// whose EXIF capture date agrees with the folder.
		const eventDir = join(sourceRoot, '2020-12-25 - Christmas Day');
		await mkdir(eventDir, {recursive: true});
		const photo = join(eventDir, 'IMG_0001.jpg');
		await writeFile(photo, Buffer.from(MINIMAL_JPEG_HEX, 'hex'));
		await exiftool.write(
			photo,
			{
				DateTimeOriginal: '2020:12:25 12:40:18',
				Make: 'Apple',
				Model: 'iPhone 12 Pro',
				FocalLength: '4.2',
				FocalLengthIn35mmFormat: '26',
			},
			{writeArgs: ['-overwrite_original_in_place']},
		);
	});

	afterEach(async () => {
		await exiftool.end();
		await rm(dir, {recursive: true, force: true});
	});

	it('links a CONSISTENT export file into the decade/year/month/event tree with a clean iMessage-style name', async () => {
		const planPath = join(dir, 'plan.jsonl');
		const result = await runCli([sourceRoot, '--link-all', '--output', outputRoot, '--plan', planPath]);
		expect(result.code).toBe(0);

		const plan = await readPlan(planPath);
		expect(plan).toHaveLength(1);
		const entry = plan[0];
		expect(entry?.kind).toBe('CONSISTENT');
		expect(entry?.to).toBe(
			join(
				outputRoot,
				'2020 Decade',
				'2020',
				'2020-12',
				'2020-12-25 Christmas Day',
				'2020-12-25 12.40.18 (iPhone 12 Pro 1x).jpg',
			),
		);
		// IMG stem stripped, iMessage-style parens label (not the [Apple ...] form).
		expect(entry?.to).not.toContain('IMG_0001');
		expect(entry?.to).not.toContain('[Apple');
	});

	it('does not link a CONSISTENT file without --link-all (default audit behavior)', async () => {
		const planPath = join(dir, 'plan-default.jsonl');
		const result = await runCli([sourceRoot, '--output', outputRoot, '--plan', planPath]);
		expect(result.code).toBe(0);
		// With no fixable findings, the CLI writes no plan file at all.
		await expect(access(planPath)).rejects.toThrow();
	});
});
