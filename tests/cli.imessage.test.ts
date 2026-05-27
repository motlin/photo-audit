import BetterSqlite3 from 'better-sqlite3';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';

const CLI_ENTRY = resolve(import.meta.dirname, '..', 'src', 'cli.ts');
const TSX_BIN = resolve(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');

const COCOA_EPOCH_UNIX_OFFSET_SECONDS = 978307200n;

function unixSecondsToCocoaSeconds(unix: bigint): bigint {
	return unix - COCOA_EPOCH_UNIX_OFFSET_SECONDS;
}

function unixSecondsToCocoaNanos(unix: bigint): bigint {
	return (unix - COCOA_EPOCH_UNIX_OFFSET_SECONDS) * 1_000_000_000n;
}

// Smallest plausible JPEG. Same fixture as `tests/audit.imessage.test.ts`;
// exiftool-vendored is able to read tags from it after writing.
const MINIMAL_JPEG_HEX =
	'ffd8ffe000104a46494600010100000100010000' +
	'ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
	'ffc0000b08000100010101001102ffc4001f0000010501010101010100000000000000000102030405060708090a0b' +
	'ffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa' +
	'ffda0008010100003f00d2cfffd9';

function minimalJpegBuffer(): Buffer {
	return Buffer.from(MINIMAL_JPEG_HEX, 'hex');
}

function createChatDbSchema(db: BetterSqlite3.Database): void {
	db.exec(`
		CREATE TABLE attachment (
			ROWID INTEGER PRIMARY KEY,
			filename TEXT,
			transfer_name TEXT,
			mime_type TEXT,
			created_date INTEGER,
			is_sticker INTEGER
		);
		CREATE TABLE message (
			ROWID INTEGER PRIMARY KEY,
			date INTEGER,
			is_from_me INTEGER,
			handle_id INTEGER
		);
		CREATE TABLE chat (
			ROWID INTEGER PRIMARY KEY,
			chat_identifier TEXT,
			display_name TEXT
		);
		CREATE TABLE handle (
			ROWID INTEGER PRIMARY KEY,
			id TEXT
		);
		CREATE TABLE message_attachment_join (
			message_id INTEGER,
			attachment_id INTEGER
		);
		CREATE TABLE chat_message_join (
			chat_id INTEGER,
			message_id INTEGER
		);
	`);
}

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

describe('cli --imessage', () => {
	let dir = '';

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-cli-imessage-'));
	});

	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	it('rejects --imessage --fix without --output', async () => {
		const result = await runCli(['--imessage', '--fix', '--db', join(dir, 'nonexistent.db')]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain('--imessage --fix requires --output');
	});

	it('writes a plan file with entries derived from chat.db when given --plan', async () => {
		const attachmentPath = join(dir, 'IMG.jpg');
		await writeFile(attachmentPath, minimalJpegBuffer());

		const dbPath = join(dir, 'chat.db');
		const db = new BetterSqlite3(dbPath);
		try {
			createChatDbSchema(db);
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				10,
				'chat101',
				'Family Trip',
			);
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(20, '+15550001111');
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(1, attachmentPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(1_718_460_645n), 0);
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				100,
				unixSecondsToCocoaNanos(1_718_460_645n),
				0,
				20,
			);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(100, 1);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 100);
		} finally {
			db.close();
		}

		const planPath = join(dir, 'plan.jsonl');
		const outputRoot = join(dir, 'output');

		const result = await runCli([
			'--imessage',
			'--db',
			dbPath,
			'--plan',
			planPath,
			'--output',
			outputRoot,
			'--zone',
			'America/New_York',
		]);

		expect(result.code).toBe(0);

		const planText = await readFile(planPath, 'utf8');
		const lines = planText.split('\n').filter((line) => line.trim() !== '');
		expect(lines).toHaveLength(1);
		const entry = JSON.parse(lines[0] ?? '') as {from: string; to: string; kind: string};
		expect(entry.from).toBe(attachmentPath);
		expect(entry.kind).toBe('MISSING_DATE');
		// `2024-06-15 14:30:45 UTC` -> 10:30:45 in America/New_York. Day folder
		// suffix is the chat display name; output hierarchy is
		// <output>/2020 Decade/2024/2024-06/2024-06-15 Family Trip/<file>.
		expect(entry.to).toContain(join(outputRoot, '2020 Decade', '2024', '2024-06', '2024-06-15 Family Trip'));
		expect(entry.to.endsWith('.jpg')).toBe(true);
	});
});
