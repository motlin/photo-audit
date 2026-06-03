import {ExifTool} from 'exiftool-vendored';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {auditImessageFile} from '../src/audit.ts';
import type {AttachmentRow} from '../src/imessage/chatDb.ts';

// Smallest plausible JPEG: SOI / APP0 (JFIF) / a tiny DQT / SOF0 / DHT / SOS /
// one compressed byte / EOI. exiftool-vendored happily reads tags from this
// after writing them with `-overwrite_original_in_place`.
const MINIMAL_JPEG_HEX =
	'ffd8ffe000104a46494600010100000100010000' +
	'ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432' +
	'ffc0000b08000100010101001102ffc4001f0000010501010101010100000000000000000102030405060708090a0b' +
	'ffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa' +
	'ffda0008010100003f00d2cfffd9';

function minimalJpegBuffer(): Buffer {
	return Buffer.from(MINIMAL_JPEG_HEX, 'hex');
}

describe('auditImessageFile', () => {
	let dir = '';
	let exiftool: ExifTool;
	const homeZone = 'America/New_York';

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'photo-audit-imessage-'));
		exiftool = new ExifTool({geolocation: true});
	});

	afterAll(async () => {
		await exiftool.end();
		await rm(dir, {recursive: true, force: true});
	});

	async function writeJpeg(name: string, tagsToWrite: Record<string, string> | null): Promise<string> {
		const path = join(dir, name);
		await writeFile(path, minimalJpegBuffer());
		if (tagsToWrite !== null) {
			await exiftool.write(path, tagsToWrite, {writeArgs: ['-overwrite_original_in_place']});
		}
		return path;
	}

	function attachmentRow(absPath: string, opts: Partial<AttachmentRow> = {}): AttachmentRow {
		return {
			absPath,
			transferName: 'IMG.jpg',
			mimeType: 'image/jpeg',
			createdDate: null,
			messageDate: null,
			isFromMe: false,
			chatIdentifier: 'chat101',
			chatDisplayName: 'Family Trip',
			handleId: null,
			chatHandles: [],
			...opts,
		};
	}

	it('uses chat-db messageDate when EXIF has no capture date', async () => {
		const path = await writeJpeg('no-exif.jpg', null);
		// 2024-06-15 14:30:45 UTC -> 10:30:45 in America/New_York
		const messageDate = new Date(Date.UTC(2024, 5, 15, 14, 30, 45));
		const attachment = attachmentRow(path, {messageDate});

		const result = await auditImessageFile(exiftool, attachment, homeZone);

		expect(result.finding.kind).toBe('MISSING_DATE');
		if (result.finding.kind !== 'MISSING_DATE') {
			throw new Error('unexpected finding kind');
		}
		expect(result.finding.metadataConfidence).toBe('chat-db');
		expect(result.finding.metadataDate).toEqual({
			year: 2024,
			month: 6,
			day: 15,
			time: {hour: 10, minute: 30, second: 45},
		});
	});

	it('prefers chat-db over a date-only midnight EXIF date', async () => {
		const path = await writeJpeg('date-only.jpg', {
			DateTimeOriginal: '2024:06:15 00:00:00',
		});
		const messageDate = new Date(Date.UTC(2024, 5, 15, 18, 0, 0));
		const attachment = attachmentRow(path, {messageDate});

		const result = await auditImessageFile(exiftool, attachment, homeZone);

		expect(result.finding.kind).toBe('MISSING_DATE');
		if (result.finding.kind !== 'MISSING_DATE') {
			throw new Error('unexpected finding kind');
		}
		expect(result.finding.metadataConfidence).toBe('chat-db');
		expect(result.finding.metadataDate).toEqual({
			year: 2024,
			month: 6,
			day: 15,
			time: {hour: 14, minute: 0, second: 0},
		});
	});

	it('keeps a high-confidence EXIF date even when chat-db has one', async () => {
		const path = await writeJpeg('high-conf.jpg', {
			DateTimeOriginal: '2024:06:15 12:34:56',
		});
		// chat.db is on a different day; EXIF must still win.
		const messageDate = new Date(Date.UTC(2025, 0, 1, 9, 0, 0));
		const attachment = attachmentRow(path, {messageDate});

		const result = await auditImessageFile(exiftool, attachment, homeZone);

		expect(result.finding.kind).toBe('MISSING_DATE');
		if (result.finding.kind !== 'MISSING_DATE') {
			throw new Error('unexpected finding kind');
		}
		expect(result.finding.metadataConfidence).toBe('high');
		expect(result.finding.metadataDate).toEqual({
			year: 2024,
			month: 6,
			day: 15,
			time: {hour: 12, minute: 34, second: 56},
		});
	});

	it('returns NO_METADATA_DATE when EXIF and chat-db both lack a date', async () => {
		const path = await writeJpeg('truly-empty.jpg', null);
		const attachment = attachmentRow(path);

		const result = await auditImessageFile(exiftool, attachment, homeZone);

		expect(result.finding.kind).toBe('NO_METADATA_DATE');
	});

	it('falls back to createdDate when messageDate is null', async () => {
		const path = await writeJpeg('created-only.jpg', null);
		const createdDate = new Date(Date.UTC(2024, 2, 4, 17, 15, 30));
		const attachment = attachmentRow(path, {createdDate});

		const result = await auditImessageFile(exiftool, attachment, homeZone);

		expect(result.finding.kind).toBe('MISSING_DATE');
		if (result.finding.kind !== 'MISSING_DATE') {
			throw new Error('unexpected finding kind');
		}
		expect(result.finding.metadataConfidence).toBe('chat-db');
		expect(result.finding.metadataDate).toEqual({
			year: 2024,
			month: 3,
			day: 4,
			time: {hour: 12, minute: 15, second: 30},
		});
	});
});
