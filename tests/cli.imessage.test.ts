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
		CREATE TABLE chat_handle_join (
			chat_id INTEGER,
			handle_id INTEGER
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

	it('applies a plan with --apply --output and no positional or --imessage', async () => {
		// Source file lives outside --output so apply creates a fresh hard link
		// at the destination derived from the plan.
		const sourcePath = join(dir, 'source.jpg');
		await writeFile(sourcePath, minimalJpegBuffer());

		const outputRoot = join(dir, 'imessage-out');
		const targetPath = join(outputRoot, '2020 Decade', '2024', '2024-06', '2024-06-15', '2024-06-15.jpg');
		const planPath = join(dir, 'tiny.jsonl');
		await writeFile(
			planPath,
			`${JSON.stringify({from: sourcePath, to: targetPath, kind: 'MISSING_DATE'})}\n`,
			'utf8',
		);

		const result = await runCli(['--apply', planPath, '--output', outputRoot]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain(`LINKED ${sourcePath} -> ${targetPath}`);

		const undoLog = await readFile(join(outputRoot, 'photo-audit-renames.log'), 'utf8');
		expect(undoLog).toContain(targetPath);
	});

	it('rejects --apply without --output', async () => {
		const planPath = join(dir, 'empty.jsonl');
		await writeFile(planPath, '', 'utf8');
		const result = await runCli(['--apply', planPath]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain('--apply requires --output');
	});

	it('rejects --undo without --output', async () => {
		const result = await runCli(['--undo']);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain('--undo requires --output');
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
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(10, 20);
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
		// `2024-06-15 14:30:45 UTC` -> 10:30:45 in America/New_York. iMessage
		// entries skip the day folder entirely (filenames already encode the
		// full date+time, chat title, and sender), so the hierarchy is
		// <output>/2020 Decade/2024/2024-06/<file>.
		expect(entry.to).toContain(join(outputRoot, '2020 Decade', '2024', '2024-06') + '/');
		expect(entry.to).not.toContain('2024-06-15 Family Trip');
		expect(entry.to.endsWith('.jpg')).toBe(true);
	});

	it('uses iMessage filename rules with --contacts: outgoing-in-group, mapped-incoming, unmapped-incoming', async () => {
		const outgoingPath = join(dir, 'outgoing.jpg');
		const mappedIncomingPath = join(dir, 'mapped.jpg');
		const unmappedIncomingPath = join(dir, 'unmapped.jpg');
		await writeFile(outgoingPath, minimalJpegBuffer());
		await writeFile(mappedIncomingPath, minimalJpegBuffer());
		await writeFile(unmappedIncomingPath, minimalJpegBuffer());

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
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(21, '+15559998888');

			// Three attachments / messages: outgoing in group, mapped incoming, unmapped incoming.
			const baseUnix = 1_718_460_645n; // 2024-06-15 14:30:45 UTC
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(1, outgoingPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(2, mappedIncomingPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 60n), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(3, unmappedIncomingPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 120n), 0);

			// Outgoing message: is_from_me = 1, handle_id = NULL.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				100,
				unixSecondsToCocoaNanos(baseUnix),
				1,
				null,
			);
			// Mapped incoming: handle 20 (+15550001111 -> "Alice").
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				101,
				unixSecondsToCocoaNanos(baseUnix + 60n),
				0,
				20,
			);
			// Unmapped incoming: handle 21 (+15559998888 -> no contact entry).
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				102,
				unixSecondsToCocoaNanos(baseUnix + 120n),
				0,
				21,
			);

			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(100, 1);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(101, 2);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(102, 3);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 100);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 101);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 102);
			// Group chat with two participants (Alice and the unmapped handle).
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(10, 20);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(10, 21);
		} finally {
			db.close();
		}

		const contactsPath = join(dir, 'contacts.json');
		await writeFile(contactsPath, JSON.stringify({self: 'Craig', '+15550001111': 'Alice'}), 'utf8');

		const planPath = join(dir, 'plan.jsonl');
		const outputRoot = join(dir, 'output');

		const result = await runCli([
			'--imessage',
			'--db',
			dbPath,
			'--contacts',
			contactsPath,
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
		expect(lines).toHaveLength(3);
		const entries = lines.map((line) => JSON.parse(line) as {from: string; to: string; kind: string});
		const byFrom = new Map(entries.map((entry) => [entry.from, entry]));

		// Outgoing in group: sender is the current user (from `self`), recipient is the group title.
		// 1_718_460_645 unix seconds = 2024-06-15 14:10:45 UTC -> 10:10:45 EDT.
		// The original stem "outgoing" is human-typed, so it is preserved.
		const outgoingEntry = byFrom.get(outgoingPath);
		expect(outgoingEntry).toBeDefined();
		const outgoingName = outgoingEntry!.to.split('/').pop() ?? '';
		expect(outgoingName).toBe('2024-06-15 10.10.45 (Craig → Family Trip) outgoing.jpg');

		// Incoming with mapped contact: friendly name shown, recipient is the group title.
		const mappedEntry = byFrom.get(mappedIncomingPath);
		expect(mappedEntry).toBeDefined();
		const mappedName = mappedEntry!.to.split('/').pop() ?? '';
		expect(mappedName).toBe('2024-06-15 10.11.45 (Alice → Family Trip) mapped.jpg');

		// Incoming with unmapped handle: raw handle shown, recipient is the group title.
		const unmappedEntry = byFrom.get(unmappedIncomingPath);
		expect(unmappedEntry).toBeDefined();
		const unmappedName = unmappedEntry!.to.split('/').pop() ?? '';
		expect(unmappedName).toBe('2024-06-15 10.12.45 (+15559998888 → Family Trip) unmapped.jpg');
	});

	it('uses arrow form for incoming DMs and outgoing DMs', async () => {
		const incomingDmPath = join(dir, 'incoming.jpg');
		const outgoingDmPath = join(dir, 'outgoing.jpg');
		const orphanIncomingPath = join(dir, 'orphan.jpg');
		await writeFile(incomingDmPath, minimalJpegBuffer());
		await writeFile(outgoingDmPath, minimalJpegBuffer());
		await writeFile(orphanIncomingPath, minimalJpegBuffer());

		const dbPath = join(dir, 'chat.db');
		const db = new BetterSqlite3(dbPath);
		try {
			createChatDbSchema(db);
			// Two DM chats — one with the mapped partner Alice and another with
			// the same partner used for the outgoing case. display_name NULL
			// marks both as DMs (no group title).
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				10,
				'+15550001111',
				null,
			);
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				11,
				'+15550001111',
				null,
			);
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(20, '+15550001111');

			const baseUnix = 1_718_460_645n;
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(1, incomingDmPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(2, outgoingDmPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 60n), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(3, orphanIncomingPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 120n), 0);

			// Incoming DM from Alice.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				100,
				unixSecondsToCocoaNanos(baseUnix),
				0,
				20,
			);
			// Outgoing DM to Alice (handle_id null on outgoing messages).
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				101,
				unixSecondsToCocoaNanos(baseUnix + 60n),
				1,
				null,
			);
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				102,
				unixSecondsToCocoaNanos(baseUnix + 120n),
				0,
				20,
			);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(100, 1);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(101, 2);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(102, 3);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 100);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(11, 101);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(10, 20);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(11, 20);
		} finally {
			db.close();
		}

		const contactsPath = join(dir, 'contacts.json');
		await writeFile(contactsPath, JSON.stringify({self: 'Craig', '+15550001111': 'Alice'}), 'utf8');

		const planPath = join(dir, 'plan.jsonl');
		const outputRoot = join(dir, 'output');

		const result = await runCli([
			'--imessage',
			'--db',
			dbPath,
			'--contacts',
			contactsPath,
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
		expect(lines).toHaveLength(3);
		const entries = lines.map((line) => JSON.parse(line) as {from: string; to: string; kind: string});
		const byFrom = new Map(entries.map((entry) => [entry.from, entry]));

		const incoming = byFrom.get(incomingDmPath);
		expect(incoming).toBeDefined();
		const incomingName = incoming!.to.split('/').pop() ?? '';
		expect(incomingName).toBe('2024-06-15 10.10.45 (Alice → Craig) incoming.jpg');

		const outgoing = byFrom.get(outgoingDmPath);
		expect(outgoing).toBeDefined();
		const outgoingName = outgoing!.to.split('/').pop() ?? '';
		expect(outgoingName).toBe('2024-06-15 10.11.45 (Craig → Alice) outgoing.jpg');

		const orphanIncoming = byFrom.get(orphanIncomingPath);
		expect(orphanIncoming).toBeDefined();
		const orphanIncomingName = orphanIncoming!.to.split('/').pop() ?? '';
		expect(orphanIncomingName).toBe('2024-06-15 10.12.45 (Alice → Craig) orphan.jpg');
	});

	it('skips unnamed groups with >3 handles and reports them; uses contacts.chats overrides when present', async () => {
		const dmPath = join(dir, 'dm.jpg');
		const smallGroupPath = join(dir, 'smallgroup.jpg');
		const overrideGroupPath = join(dir, 'override.jpg');
		const largeGroupPath = join(dir, 'large.jpg');
		await writeFile(dmPath, minimalJpegBuffer());
		await writeFile(smallGroupPath, minimalJpegBuffer());
		await writeFile(overrideGroupPath, minimalJpegBuffer());
		await writeFile(largeGroupPath, minimalJpegBuffer());

		const dbPath = join(dir, 'chat.db');
		const db = new BetterSqlite3(dbPath);
		try {
			createChatDbSchema(db);
			// Chat 10: 1-handle DM with Alice (no display_name).
			// Chat 11: unnamed 3-handle group (auto-derive recipient).
			// Chat 12: unnamed 4-handle group BUT with a chats override.
			// Chat 13: unnamed 4-handle group with NO override -> must be skipped + reported.
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				10,
				'+15550001111',
				null,
			);
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				11,
				'chat-three',
				null,
			);
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				12,
				'chat-override',
				null,
			);
			db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)').run(
				13,
				'chat-big',
				null,
			);
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(20, '+15550001111'); // Alice
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(21, '+15552220001');
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(22, '+15552220002');
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(23, '+15552220003');
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(24, '+15552220004');
			db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)').run(25, '+15552220005');

			const baseUnix = 1_718_460_645n;
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(1, dmPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(2, smallGroupPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 60n), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(3, overrideGroupPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 120n), 0);
			db.prepare(
				'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
			).run(4, largeGroupPath, 'IMG.jpg', 'image/jpeg', unixSecondsToCocoaSeconds(baseUnix + 180n), 0);

			// DM incoming from Alice.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				100,
				unixSecondsToCocoaNanos(baseUnix),
				0,
				20,
			);
			// Small group incoming from handle 21.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				101,
				unixSecondsToCocoaNanos(baseUnix + 60n),
				0,
				21,
			);
			// Override group outgoing.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				102,
				unixSecondsToCocoaNanos(baseUnix + 120n),
				1,
				null,
			);
			// Large unnamed group incoming.
			db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)').run(
				103,
				unixSecondsToCocoaNanos(baseUnix + 180n),
				0,
				22,
			);

			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(100, 1);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(101, 2);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(102, 3);
			db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)').run(103, 4);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(10, 100);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(11, 101);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(12, 102);
			db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)').run(13, 103);

			// Chat 10: 1 handle.
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(10, 20);
			// Chat 11: 3 handles (one of them is the sender).
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(11, 20);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(11, 21);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(11, 22);
			// Chat 12: 4 handles, but has override.
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(12, 20);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(12, 21);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(12, 22);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(12, 23);
			// Chat 13: 4 handles, no override -> must be skipped.
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(13, 21);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(13, 22);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(13, 23);
			db.prepare('INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)').run(13, 24);
		} finally {
			db.close();
		}

		const contactsPath = join(dir, 'contacts.json');
		await writeFile(
			contactsPath,
			JSON.stringify({
				self: 'Craig',
				'+15550001111': 'Alice',
				'+15552220001': 'Bob',
				'+15552220002': 'Carol',
				chats: {'chat-override': 'Override Group'},
			}),
			'utf8',
		);

		const planPath = join(dir, 'plan.jsonl');
		const outputRoot = join(dir, 'output');

		const result = await runCli([
			'--imessage',
			'--db',
			dbPath,
			'--contacts',
			contactsPath,
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
		// Three entries: DM, small group, override group. The big unnamed group is skipped.
		expect(lines).toHaveLength(3);
		const entries = lines.map((line) => JSON.parse(line) as {from: string; to: string; kind: string});
		const byFrom = new Map(entries.map((entry) => [entry.from, entry]));

		// DM uses Alice -> Craig.
		const dmEntry = byFrom.get(dmPath);
		expect(dmEntry).toBeDefined();
		expect(dmEntry!.to.split('/').pop()).toBe('2024-06-15 10.10.45 (Alice → Craig) dm.jpg');

		// Small group: 3 handles, sender is Bob (handle 21). Recipient should
		// join the remaining participants and self (Craig). Sender Bob is
		// excluded.
		const smallEntry = byFrom.get(smallGroupPath);
		expect(smallEntry).toBeDefined();
		const smallName = smallEntry!.to.split('/').pop() ?? '';
		expect(smallName).toBe('2024-06-15 10.11.45 (Bob → Alice, Carol, Craig) smallgroup.jpg');

		// Override group: 4 handles but chats override applies.
		const overrideEntry = byFrom.get(overrideGroupPath);
		expect(overrideEntry).toBeDefined();
		expect(overrideEntry!.to.split('/').pop()).toBe('2024-06-15 10.12.45 (Craig → Override Group) override.jpg');

		// Big unnamed group: not in plan, but stderr should mention it.
		expect(byFrom.has(largeGroupPath)).toBe(false);
		expect(result.stderr).toContain('1 unnamed group chats');
		expect(result.stderr).toContain('chat-big');
		expect(result.stderr).toContain('handles=4');
		expect(result.stderr).toContain('attachments=1');
	});
});
