import BetterSqlite3 from 'better-sqlite3';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {iterAttachments, openChatDb} from '../../src/imessage/chatDb.ts';

async function touch(path: string): Promise<void> {
	await mkdir(dirname(path), {recursive: true});
	await writeFile(path, '');
}

const COCOA_EPOCH_UNIX_OFFSET_SECONDS = 978307200n;

function unixSecondsToCocoaSeconds(unix: bigint): bigint {
	return unix - COCOA_EPOCH_UNIX_OFFSET_SECONDS;
}

function unixSecondsToCocoaNanos(unix: bigint): bigint {
	return (unix - COCOA_EPOCH_UNIX_OFFSET_SECONDS) * 1_000_000_000n;
}

interface Seed {
	attachmentRowId: number;
	filename: string | null;
	transferName: string | null;
	mimeType: string | null;
	createdDateCocoaSeconds: bigint | null;
	isSticker: number;
	messages: Array<{
		messageRowId: number;
		dateCocoaNanos: bigint;
		isFromMe: number;
		handleRowId: number | null;
		chatRowId: number | null;
	}>;
}

interface ChatSeed {
	chatRowId: number;
	chatIdentifier: string;
	displayName: string | null;
}

interface HandleSeed {
	handleRowId: number;
	id: string;
}

function createSchema(db: BetterSqlite3.Database): void {
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

function seedChats(db: BetterSqlite3.Database, chats: ChatSeed[]): void {
	const stmt = db.prepare('INSERT INTO chat (ROWID, chat_identifier, display_name) VALUES (?, ?, ?)');
	for (const chat of chats) {
		stmt.run(chat.chatRowId, chat.chatIdentifier, chat.displayName);
	}
}

function seedHandles(db: BetterSqlite3.Database, handles: HandleSeed[]): void {
	const stmt = db.prepare('INSERT INTO handle (ROWID, id) VALUES (?, ?)');
	for (const handle of handles) {
		stmt.run(handle.handleRowId, handle.id);
	}
}

function seedAttachments(db: BetterSqlite3.Database, seeds: Seed[]): void {
	const insertAttachment = db.prepare(
		'INSERT INTO attachment (ROWID, filename, transfer_name, mime_type, created_date, is_sticker) VALUES (?, ?, ?, ?, ?, ?)',
	);
	const insertMessage = db.prepare('INSERT INTO message (ROWID, date, is_from_me, handle_id) VALUES (?, ?, ?, ?)');
	const insertMaj = db.prepare('INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)');
	const insertCmj = db.prepare('INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)');

	for (const seed of seeds) {
		insertAttachment.run(
			seed.attachmentRowId,
			seed.filename,
			seed.transferName,
			seed.mimeType,
			seed.createdDateCocoaSeconds,
			seed.isSticker,
		);
		for (const msg of seed.messages) {
			insertMessage.run(msg.messageRowId, msg.dateCocoaNanos, msg.isFromMe, msg.handleRowId);
			insertMaj.run(msg.messageRowId, seed.attachmentRowId);
			if (msg.chatRowId !== null) {
				insertCmj.run(msg.chatRowId, msg.messageRowId);
			}
		}
	}
}

describe('openChatDb / iterAttachments', () => {
	let dir = '';
	let dbPath = '';
	let db: BetterSqlite3.Database;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-chatdb-'));
		dbPath = join(dir, 'chat.db');
		db = new BetterSqlite3(dbPath);
		createSchema(db);
	});

	afterEach(async () => {
		db.close();
		await rm(dir, {recursive: true, force: true});
	});

	it('yields image and video attachments joined with chat and handle context', async () => {
		const imageCocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const videoCocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_500n);
		const imageMsgNanos = unixSecondsToCocoaNanos(1_700_000_100n);
		const videoMsgNanos = unixSecondsToCocoaNanos(1_700_000_600n);

		const imgPath = join(dir, 'IMG.heic');
		const movPath = join(dir, 'MOV.mov');
		await touch(imgPath);
		await touch(movPath);

		seedChats(db, [
			{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Family Trip'},
			{chatRowId: 11, chatIdentifier: '+15551234567', displayName: null},
		]);
		seedHandles(db, [
			{handleRowId: 20, id: '+15550001111'},
			{handleRowId: 21, id: '+15551234567'},
		]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: imgPath,
				transferName: 'IMG.heic',
				mimeType: 'image/heic',
				createdDateCocoaSeconds: imageCocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: imageMsgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 2,
				filename: movPath,
				transferName: 'MOV.mov',
				mimeType: 'video/quicktime',
				createdDateCocoaSeconds: videoCocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 101,
						dateCocoaNanos: videoMsgNanos,
						isFromMe: 1,
						handleRowId: 21,
						chatRowId: 11,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			expect(rows).toEqual([
				{
					absPath: imgPath,
					transferName: 'IMG.heic',
					mimeType: 'image/heic',
					createdDate: new Date(1_700_000_000_000),
					messageDate: new Date(1_700_000_100_000),
					isFromMe: false,
					chatIdentifier: 'chat101',
					chatDisplayName: 'Family Trip',
					handleId: '+15550001111',
				},
				{
					absPath: movPath,
					transferName: 'MOV.mov',
					mimeType: 'video/quicktime',
					createdDate: new Date(1_700_000_500_000),
					messageDate: new Date(1_700_000_600_000),
					isFromMe: true,
					chatIdentifier: '+15551234567',
					chatDisplayName: null,
					handleId: '+15551234567',
				},
			]);
		} finally {
			reopened.close();
		}
	});

	it('filters out stickers, non-image/video MIME, StickerCache paths, and null filenames', async () => {
		const cocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const msgNanos = unixSecondsToCocoaNanos(1_700_000_100n);

		const keeperPath = join(dir, 'keeper.jpg');
		await touch(keeperPath);

		seedChats(db, [{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Group'}]);
		seedHandles(db, [{handleRowId: 20, id: '+15550001111'}]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: keeperPath,
				transferName: 'keeper.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 2,
				filename: '~/Library/Messages/Attachments/00/01/BBB/sticker.png',
				transferName: 'sticker.png',
				mimeType: 'image/png',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 1,
				messages: [
					{
						messageRowId: 101,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 3,
				filename: '~/Library/Messages/Attachments/00/02/CCC/plugin.bin',
				transferName: 'plugin.bin',
				mimeType: 'application/x-apple-msg-attachment',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 102,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 4,
				filename: '~/Library/Messages/StickerCache/foo/cached.png',
				transferName: 'cached.png',
				mimeType: 'image/png',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 103,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 5,
				filename: null,
				transferName: 'no-file.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 104,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			expect(rows).toHaveLength(1);
			expect(rows[0]?.transferName).toBe('keeper.jpg');
		} finally {
			reopened.close();
		}
	});

	it('filters out rows whose on-disk file is missing and keeps present-on-disk rows', async () => {
		const cocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const msgNanos = unixSecondsToCocoaNanos(1_700_000_100n);

		const presentPath = join(dir, 'present.jpg');
		await touch(presentPath);

		seedChats(db, [{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Group'}]);
		seedHandles(db, [{handleRowId: 20, id: '+15550001111'}]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: '/nonexistent/disk/path.jpg',
				transferName: 'gone.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 2,
				filename: presentPath,
				transferName: 'present.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 101,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			expect(rows).toHaveLength(1);
			expect(rows[0]?.absPath).toBe(presentPath);
			expect(rows[0]?.transferName).toBe('present.jpg');
		} finally {
			reopened.close();
		}
	});

	it('filters out rows whose resolved path contains ASCII control characters', async () => {
		const cocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const msgNanos = unixSecondsToCocoaNanos(1_700_000_100n);

		const cleanPath = join(dir, 'clean.jpg');
		await touch(cleanPath);

		// Real chat.db rows have been seen with a literal `\r` byte between two
		// screenshot names; macOS accepts control characters in filenames, so we
		// create one on disk to prove the filter rejects it even when the file
		// exists.
		const controlCharPath = join(dir, 'Screenshot A.png\rScreenshot B.png');
		await touch(controlCharPath);

		seedChats(db, [{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Group'}]);
		seedHandles(db, [{handleRowId: 20, id: '+15550001111'}]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: controlCharPath,
				transferName: 'screenshots.png',
				mimeType: 'image/png',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 2,
				filename: cleanPath,
				transferName: 'clean.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 101,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			expect(rows).toHaveLength(1);
			expect(rows[0]?.absPath).toBe(cleanPath);
			expect(rows[0]?.transferName).toBe('clean.jpg');
		} finally {
			reopened.close();
		}
	});

	it('uses MIN(message.date) when an attachment is sent in multiple messages', async () => {
		const cocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const earlierMsgNanos = unixSecondsToCocoaNanos(1_700_000_100n);
		const laterMsgNanos = unixSecondsToCocoaNanos(1_700_000_900n);

		const photoPath = join(dir, 'photo.jpg');
		await touch(photoPath);

		seedChats(db, [{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Group'}]);
		seedHandles(db, [{handleRowId: 20, id: '+15550001111'}]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: photoPath,
				transferName: 'photo.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: laterMsgNanos,
						isFromMe: 1,
						handleRowId: 20,
						chatRowId: 10,
					},
					{
						messageRowId: 101,
						dateCocoaNanos: earlierMsgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			expect(rows).toHaveLength(1);
			expect(rows[0]?.messageDate).toEqual(new Date(1_700_000_100_000));
		} finally {
			reopened.close();
		}
	});

	it('yields chatDisplayName for group chats and null for DMs', async () => {
		const cocoaSeconds = unixSecondsToCocoaSeconds(1_700_000_000n);
		const msgNanos = unixSecondsToCocoaNanos(1_700_000_100n);

		const groupPath = join(dir, 'group.jpg');
		const dmPath = join(dir, 'dm.jpg');
		await touch(groupPath);
		await touch(dmPath);

		seedChats(db, [
			{chatRowId: 10, chatIdentifier: 'chat101', displayName: 'Family Trip'},
			{chatRowId: 11, chatIdentifier: '+15551234567', displayName: null},
		]);
		seedHandles(db, [
			{handleRowId: 20, id: '+15550001111'},
			{handleRowId: 21, id: '+15551234567'},
		]);
		seedAttachments(db, [
			{
				attachmentRowId: 1,
				filename: groupPath,
				transferName: 'group.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 100,
						dateCocoaNanos: msgNanos,
						isFromMe: 0,
						handleRowId: 20,
						chatRowId: 10,
					},
				],
			},
			{
				attachmentRowId: 2,
				filename: dmPath,
				transferName: 'dm.jpg',
				mimeType: 'image/jpeg',
				createdDateCocoaSeconds: cocoaSeconds,
				isSticker: 0,
				messages: [
					{
						messageRowId: 101,
						dateCocoaNanos: msgNanos,
						isFromMe: 1,
						handleRowId: 21,
						chatRowId: 11,
					},
				],
			},
		]);
		db.close();

		const reopened = openChatDb(dbPath);
		try {
			const rows = [...iterAttachments(reopened)];
			const group = rows.find((r) => r.transferName === 'group.jpg');
			const dm = rows.find((r) => r.transferName === 'dm.jpg');
			expect(group?.chatDisplayName).toBe('Family Trip');
			expect(group?.isFromMe).toBe(false);
			expect(dm?.chatDisplayName).toBeNull();
			expect(dm?.isFromMe).toBe(true);
		} finally {
			reopened.close();
		}
	});
});
