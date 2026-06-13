import BetterSqlite3 from 'better-sqlite3';
import {ExifTool} from 'exiftool-vendored';
import {spawn} from 'node:child_process';
import {appendFile, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';

const CLI_ENTRY = resolve(import.meta.dirname, '..', 'src', 'cli.ts');
const TSX_BIN = resolve(import.meta.dirname, '..', 'node_modules', '.bin', 'tsx');

// Smallest plausible JPEG. Same fixture as other iMessage tests; exiftool can
// write tags into it before the test appends bytes to simulate re-encodes.
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

interface PlanEntry {
	from: string;
	to: string;
	kind: string;
}

interface AttachmentSeed {
	attachmentId: number;
	messageId: number;
	chatId: number;
	chatIdentifier: string;
	chatDisplayName: string;
	path: string;
}

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
		CREATE TABLE chat_handle_join (
			chat_id INTEGER,
			handle_id INTEGER
		);
	`);
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

async function readPlan(path: string): Promise<PlanEntry[]> {
	const planText = await readFile(path, 'utf8');
	return planText
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => JSON.parse(line) as PlanEntry);
}

function insertChatDbRows(db: BetterSqlite3.Database, attachments: readonly AttachmentSeed[]): void {
	db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(100, 'alice@example.com');
	const seenChats = new Set<number>();
	for (const attachment of attachments) {
		if (!seenChats.has(attachment.chatId)) {
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				attachment.chatId,
				attachment.chatIdentifier,
				attachment.chatDisplayName,
			);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(attachment.chatId, 100);
			seenChats.add(attachment.chatId);
		}
		db.prepare(
			'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
		).run(attachment.attachmentId, attachment.path, 'candidate.jpg', 'image/jpeg', 0, 0);
		db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
			attachment.messageId,
			0,
			0,
			100,
		);
		db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(
			attachment.messageId,
			attachment.attachmentId,
		);
		db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(
			attachment.chatId,
			attachment.messageId,
		);
	}
}

describe('cli --imessage --dedupe-imessage', () => {
	let dir = '';
	let exiftool: ExifTool;

	beforeAll(() => {
		exiftool = new ExifTool({geolocation: true});
	});

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-imessage-dedupe-'));
	});

	afterEach(async () => {
		await rm(dir, {recursive: true, force: true});
	});

	afterAll(async () => {
		await exiftool.end();
	});

	async function writeDuplicateCandidate(name: string, extraBytes: number): Promise<string> {
		const path = join(dir, name);
		await writeFile(path, minimalJpegBuffer());
		await exiftool.write(
			path,
			{
				DateTimeOriginal: '2000:01:01 00:00:01',
				Make: 'Example Camera Co',
				Model: 'ExampleCam 1',
			},
			{writeArgs: ['-overwrite_original_in_place']},
		);
		await appendFile(path, Buffer.alloc(extraBytes));
		return path;
	}

	async function writePlanFor(
		attachments: readonly AttachmentSeed[],
		extraArgs: readonly string[] = [],
	): Promise<{
		entries: PlanEntry[];
		result: SpawnResult;
	}> {
		const dbPath = join(dir, 'chat.db');
		const db = new BetterSqlite3(dbPath);
		try {
			createChatDbSchema(db);
			insertChatDbRows(db, attachments);
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
			...extraArgs,
		]);

		return {entries: await readPlan(planPath), result};
	}

	it('keeps only the largest same-chat attachment with the same EXIF date and camera', async () => {
		const smallPath = await writeDuplicateCandidate('small.jpg', 10);
		const mediumPath = await writeDuplicateCandidate('medium.jpg', 100);
		const largestPath = await writeDuplicateCandidate('largest.jpg', 1_000);

		const {entries, result} = await writePlanFor([
			{
				attachmentId: 100,
				messageId: 1000,
				chatId: 10,
				chatIdentifier: 'chat-alpha',
				chatDisplayName: 'Alpha Chat',
				path: smallPath,
			},
			{
				attachmentId: 200,
				messageId: 2000,
				chatId: 10,
				chatIdentifier: 'chat-alpha',
				chatDisplayName: 'Alpha Chat',
				path: mediumPath,
			},
			{
				attachmentId: 300,
				messageId: 3000,
				chatId: 10,
				chatIdentifier: 'chat-alpha',
				chatDisplayName: 'Alpha Chat',
				path: largestPath,
			},
		]);

		expect(result.code).toBe(0);
		expect(entries.map((entry) => entry.from)).toEqual([largestPath]);
		expect(result.stderr).toContain('Deduped 2 attachments');
		expect(result.stderr).toContain('bytes saved');
	});

	it('does not dedupe matching attachments across different chats', async () => {
		const alphaPath = await writeDuplicateCandidate('alpha.jpg', 10);
		const betaPath = await writeDuplicateCandidate('beta.jpg', 100);

		const {entries, result} = await writePlanFor([
			{
				attachmentId: 100,
				messageId: 1000,
				chatId: 10,
				chatIdentifier: 'chat-alpha',
				chatDisplayName: 'Alpha Chat',
				path: alphaPath,
			},
			{
				attachmentId: 200,
				messageId: 2000,
				chatId: 20,
				chatIdentifier: 'chat-beta',
				chatDisplayName: 'Beta Chat',
				path: betaPath,
			},
		]);

		expect(result.code).toBe(0);
		expect(entries.map((entry) => entry.from)).toEqual([alphaPath, betaPath]);
		expect(result.stderr).not.toContain('Deduped');
	});

	it('keeps same-chat duplicates when --no-dedupe-imessage is set', async () => {
		const smallPath = await writeDuplicateCandidate('small.jpg', 10);
		const mediumPath = await writeDuplicateCandidate('medium.jpg', 100);
		const largestPath = await writeDuplicateCandidate('largest.jpg', 1_000);

		const {entries, result} = await writePlanFor(
			[
				{
					attachmentId: 100,
					messageId: 1000,
					chatId: 10,
					chatIdentifier: 'chat-alpha',
					chatDisplayName: 'Alpha Chat',
					path: smallPath,
				},
				{
					attachmentId: 200,
					messageId: 2000,
					chatId: 10,
					chatIdentifier: 'chat-alpha',
					chatDisplayName: 'Alpha Chat',
					path: mediumPath,
				},
				{
					attachmentId: 300,
					messageId: 3000,
					chatId: 10,
					chatIdentifier: 'chat-alpha',
					chatDisplayName: 'Alpha Chat',
					path: largestPath,
				},
			],
			['--no-dedupe-imessage'],
		);

		expect(result.code).toBe(0);
		expect(entries.map((entry) => entry.from)).toEqual([smallPath, mediumPath, largestPath]);
		expect(result.stderr).not.toContain('Deduped');
	});
});
