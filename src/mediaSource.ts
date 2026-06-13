// Media source abstraction: the CLI loop dispatches on this discriminated union
// so the filesystem walker and the iMessage chat.db source can share the same
// audit pipeline.
//
// `contextFor` runs the right audit (`auditFile` for filesystem, `auditImessageFile`
// for iMessage) and packages everything the CLI loop needs to print a finding
// and place its hard-link target into the output hierarchy: the source folder
// name (used as the day-folder suffix), GPS-derived place (filesystem only),
// and folder date (filesystem only). iMessage items have no meaningful parent
// folder — the UUID-hashed `Attachments/00/00/<UUID>/` directories carry no
// calendar context — so `folderDate` and `place` are always null and the chat
// display name (or sender handle) takes the suffix slot.

import {basename, dirname} from 'node:path';
import type {ExifTool} from 'exiftool-vendored';
import {auditFile, auditImessageFile, datedAncestorFolder} from './audit.ts';
import type {Finding} from './classify.ts';
import type {DateParts} from './dateParts.ts';
import type {AttachmentRow} from './imessage/chatDb.ts';
import type {CameraInfo} from './metadata.ts';
import {parseDateFromString} from './parseDate.ts';

export type MediaItem = {kind: 'fs'; path: string} | {kind: 'imessage'; path: string; chat: AttachmentRow};

export interface ImessageContext {
	isFromMe: boolean;
	handleId: string | null;
	chatDisplayName: string | null;
	chatIdentifier: string | null;
	chatHandles: string[];
}

export interface MediaItemContext {
	sourceFolderName: string | null;
	place: string | null;
	folderDate: DateParts | null;
	finding: Finding;
	cameraInfo: CameraInfo;
	location: string | null;
	imessage: ImessageContext | null;
	imessageDedupeKey: string | null;
}

/**
 * Audit one media item and bundle it with the context needed for output-path
 * placement. For filesystem items the suffix comes from the immediate parent
 * directory's basename and `place`/`folderDate` come from the audit result and
 * the nearest dated ancestor folder. For iMessage items the suffix comes from
 * the chat display name (group title) or sender handle and the folder-context
 * fields are always null.
 */
export async function contextFor(
	exiftool: ExifTool,
	item: MediaItem,
	root: string,
	homeZone: string,
): Promise<MediaItemContext> {
	if (item.kind === 'imessage') {
		const result = await auditImessageFile(exiftool, item.chat, homeZone);
		return {
			sourceFolderName: item.chat.chatDisplayName ?? item.chat.handleId,
			place: null,
			folderDate: null,
			finding: result.finding,
			cameraInfo: result.cameraInfo,
			location: result.location,
			imessageDedupeKey: result.dedupeKey,
			imessage: {
				isFromMe: item.chat.isFromMe,
				handleId: item.chat.handleId,
				chatDisplayName: item.chat.chatDisplayName,
				chatIdentifier: item.chat.chatIdentifier,
				chatHandles: item.chat.chatHandles,
			},
		};
	}
	const result = await auditFile(exiftool, item.path, root, homeZone);
	const parent = dirname(item.path);
	const datedFolder = datedAncestorFolder(item.path, root);
	const folderDate = datedFolder === null ? null : parseDateFromString(basename(datedFolder));
	return {
		sourceFolderName: basename(parent),
		place: result.location,
		folderDate,
		finding: result.finding,
		cameraInfo: result.cameraInfo,
		location: result.location,
		imessage: null,
		imessageDedupeKey: null,
	};
}
