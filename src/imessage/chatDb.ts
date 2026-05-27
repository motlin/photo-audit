// Read iMessage attachments from `chat.db`.
//
// Opens the database read-only with `immutable=1` via a file URI, so the
// Messages.app WAL lock cannot interfere. Yields one row per attachment with
// the chat context (group title or sender handle) and the earliest message
// date the attachment was sent in (some attachments are re-sent in multiple
// messages).
//
// The "absPath" column resolves a leading `~/` in `attachment.filename` via
// `os.homedir()`. Rows whose resolved path no longer exists on disk are
// filtered out by the generator — macOS can GC `TemporaryItems` attachments
// out from under chat.db rows, and exiftool would otherwise throw ENOENT and
// abort the whole scan.

import BetterSqlite3 from 'better-sqlite3';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import type {DateParts} from '../dateParts.ts';
import {cocoaNanosToDate, cocoaSecondsToDate} from './cocoaEpoch.ts';

export type Database = BetterSqlite3.Database;

export interface AttachmentRow {
	absPath: string;
	transferName: string | null;
	mimeType: string;
	createdDate: Date | null;
	messageDate: Date | null;
	isFromMe: boolean;
	chatIdentifier: string | null;
	chatDisplayName: string | null;
	handleId: string | null;
}

interface RawRow {
	filename: string;
	transfer_name: string | null;
	mime_type: string;
	created_date: bigint | number | null;
	message_date: bigint | number | null;
	is_from_me: bigint | number;
	chat_identifier: string | null;
	chat_display_name: string | null;
	handle_id: string | null;
}

const ATTACHMENT_QUERY = `
	SELECT
		a.filename AS filename,
		a.transfer_name AS transfer_name,
		a.mime_type AS mime_type,
		a.created_date AS created_date,
		MIN(m.date) AS message_date,
		MAX(m.is_from_me) AS is_from_me,
		c.chat_identifier AS chat_identifier,
		c.display_name AS chat_display_name,
		h.id AS handle_id
	FROM attachment a
	JOIN message_attachment_join maj ON maj.attachment_id = a.ROWID
	JOIN message m ON m.ROWID = maj.message_id
	LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
	LEFT JOIN chat c ON c.ROWID = cmj.chat_id
	LEFT JOIN handle h ON h.ROWID = m.handle_id
	WHERE (a.mime_type LIKE 'image/%' OR a.mime_type LIKE 'video/%')
		AND COALESCE(a.is_sticker, 0) = 0
		AND a.filename IS NOT NULL
		AND a.filename NOT LIKE '%/StickerCache/%'
	GROUP BY a.ROWID
`;

export function openChatDb(path: string): Database {
	// `better-sqlite3` does not enable `SQLITE_OPEN_URI`, so the `file:?immutable=1`
	// URI form is treated as a literal filename and fails. Open the file directly
	// with `readonly: true` instead. To bypass the WAL lock that Messages.app holds
	// during normal operation, issue `PRAGMA query_only = 1` and disable the WAL
	// after opening — read-only opens already use a private snapshot of WAL files.
	const db = new BetterSqlite3(path, {readonly: true, fileMustExist: true});
	db.pragma('query_only = 1');
	return db;
}

function resolveHome(filename: string): string {
	if (filename.startsWith('~/')) {
		return `${homedir()}/${filename.slice(2)}`;
	}
	return filename;
}

function toBool(value: bigint | number): boolean {
	if (typeof value === 'bigint') {
		return value !== 0n;
	}
	return value !== 0;
}

/**
 * Convert a JS `Date` to local-wall-clock `DateParts` in the given IANA zone.
 *
 * Mirrors {@link toLocalDateParts} in `src/metadata.ts`: `ExifDateTime`s carry
 * their own zone metadata, but a plain `Date` (what we get from `chat.db`)
 * does not, so we project it through `Intl.DateTimeFormat` to recover the
 * calendar parts in `zone`. Returns `null` when the input is `null`.
 */
export function dateToPartsInZone(value: Date | null, zone: string): DateParts | null {
	if (value === null) {
		return null;
	}
	const formatter = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
	const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
	for (const part of formatter.formatToParts(value)) {
		if (part.type !== 'literal') {
			parts[part.type] = part.value;
		}
	}
	const year = Number(parts.year);
	const month = Number(parts.month);
	const day = Number(parts.day);
	// `hour12: false` can produce "24" for midnight in some Intl implementations;
	// normalize to 0 so DateParts stays canonical.
	const hour = Number(parts.hour) % 24;
	const minute = Number(parts.minute);
	const second = Number(parts.second);
	return {year, month, day, time: {hour, minute, second}};
}

export function* iterAttachments(db: Database): Generator<AttachmentRow> {
	const stmt = db.prepare<[], RawRow>(ATTACHMENT_QUERY);
	for (const row of stmt.iterate()) {
		const absPath = resolveHome(row.filename);
		if (!existsSync(absPath)) {
			continue;
		}
		yield {
			absPath,
			transferName: row.transfer_name,
			mimeType: row.mime_type,
			createdDate: cocoaSecondsToDate(row.created_date),
			messageDate: cocoaNanosToDate(row.message_date),
			isFromMe: toBool(row.is_from_me),
			chatIdentifier: row.chat_identifier,
			chatDisplayName: row.chat_display_name,
			handleId: row.handle_id,
		};
	}
}
