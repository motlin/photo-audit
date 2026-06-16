import {basename, dirname, join, relative, resolve} from 'node:path';
import {homedir} from 'node:os';
import {parseArgs} from 'node:util';
import {closeSync, openSync, readSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ExifTool} from 'exiftool-vendored';
import {mkdir} from 'node:fs/promises';
import {applyLinks} from './applyLink.ts';
import {applyUndo, parseUndoLog, removeEmptyAncestors} from './applyUndo.ts';
import {datedAncestorFolder} from './audit.ts';
import type {Finding} from './classify.ts';
import {formatDate} from './dateParts.ts';
import {type ProposedRename} from './fix.ts';
import {iterAttachments, openChatDb} from './imessage/chatDb.ts';
import {
	type ChatOverridesMap,
	type ContactsMap,
	type LoadedContacts,
	getChatOverride,
	getSelfName,
	loadContacts,
	normalizeHandle,
	resolveContact,
} from './imessage/contacts.ts';
import {proposeImessageFilename} from './imessage/proposeImessageFilename.ts';
import {contextFor, type MediaItem} from './mediaSource.ts';
import {formatCameraSuffix, formatImessageCameraSuffix, type CameraInfo} from './metadata.ts';
import {computeOutputDirectory} from './outputPath.ts';
import {type PlanEntry, readPlanFile, writePlanFile} from './plan.ts';
import {probeHardLinkSupport} from './probeHardLink.ts';
import {resolveCollisions} from './resolveCollisions.ts';
import {planFolderWarnings, type DatedFolder, type FolderFileEntry, type FolderWarning} from './folderWarnings.ts';
import {parseDateFromString} from './parseDate.ts';
import {proposeFilename} from './proposeName.ts';
import {walkMedia} from './walk.ts';

const USAGE = `Usage: just audit "<directory>" [--limit N] [--show-all] [--zone IANA]
                                  [--imessage [--db PATH]]
                                  [--fix | --plan FILE | --apply FILE | --undo]
                                  [--help]

Audits every photo/video under <directory>, comparing the date in each file's
metadata against the date in its filename. Folder dates are informational only
(they can confirm a file but never flag it as wrong).

  --limit N      stop after auditing N files (useful for a quick sample)
  --show-all     also print MISSING_DATE and NO_METADATA_DATE findings
  --zone IANA    timezone for resolving UTC-only video dates
                 (default: this machine's timezone)
  --imessage     audit iMessage attachments via chat.db instead of walking
                 <directory>. The positional directory is optional in this
                 mode. UUID-hashed parent folders are ignored; chat display
                 names (group title) or sender handles drive day-folder
                 suffixes. Requires --output when combined with --fix.
  --db PATH      override the chat.db location (default
                 ~/Library/Messages/chat.db). Opened read-only.
  --contacts PATH
                 JSON file mapping iMessage handles to friendly names, used
                 to label senders in --imessage proposed filenames. Default
                 ~/.config/photo-audit/contacts.json. Missing file is OK;
                 unmapped handles fall back to the raw handle string.
  --no-dedupe-imessage
                 keep near-duplicate iMessage attachments that would otherwise
                 be deduped by chat + capture date + camera (default on).
  --fix          add a correctly-dated hard-linked alias next to every
                 WRONG_DATE / MISSING_DATE file whose metadata is high-
                 confidence. Originals are preserved; the new alias points
                 at the same inode. Every link is logged to
                 <directory>/photo-audit-renames.log for --undo.
  --plan FILE    scan and write a JSON-Lines plan of proposed links to FILE.
                 No files are modified. Review/edit the file (delete lines
                 to skip), then apply with --apply.
  --apply FILE   read a plan from FILE and apply it. Undo log is still
                 written under <directory> (or under --output if given).
  --strip-camera-id
                 when proposing names, drop camera-firmware stems like
                 IMG_063842, DSC_1234, PXL_20240315_..., so the new name is
                 just the date prefix + extension. Human-named stems are
                 always preserved.
  --link-all     organize a trusted, already-dated export: hard-link EVERY
                 dated file (not just date-problem ones), including files whose
                 metadata already agrees with their folder. Names are the clean
                 iMessage style (<date> <time> (camera), IMG stem stripped) and
                 the day folder keeps the source folder's event-name suffix.
                 Pair with --output on the same volume as the source.
  --dedupe-collisions
                 when applying, resolve two files that propose the same name by
                 content: drop verified byte-duplicates (SHA-256) keeping one,
                 and disambiguate genuinely-distinct files (same timestamp,
                 different photo) by restoring their IMG stem — instead of
                 silently skipping every colliding file.
  --output ROOT  put new hard-linked aliases under a separate hierarchy at
                 ROOT: <ROOT>/<YYYY0> Decade/<YYYY>/<YYYY-MM>/<YYYY-MM-DD
                 [suffix]>/. The suffix prefers a user-curated folder title
                 (date-stripped), falls back to the GPS place name. ROOT
                 must be on the same filesystem as <directory> for hard
                 links to work. Undo log lands at <ROOT>/photo-audit-renames.log.
  --undo         read <directory>/photo-audit-renames.log and remove every
                 aliased path still hard-linked to its original. Skips
                 entries where the alias was replaced or the original is
                 missing.
  --help         print this message and exit
`;

const UNDO_LOG_NAME = 'photo-audit-renames.log';

function printLocation(location: string | null): void {
	if (location !== null) {
		console.log(`  location  : ${location}`);
	}
}

function printWrongDate(
	finding: Extract<Finding, {kind: 'WRONG_DATE'}>,
	root: string,
	location: string | null,
	cameraInfo: CameraInfo,
	stripCameraId: boolean,
): void {
	const name = basename(finding.path);
	console.log(`\nWRONG DATE  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}`);
	for (const conflict of finding.conflicts) {
		console.log(`  ${conflict.source.padEnd(10)}: ${formatDate(conflict.found)}  <- disagrees`);
	}
	printLocation(location);
	const cameraSuffix = formatCameraSuffix(cameraInfo);
	console.log(`  rename to : ${proposeFilename(name, finding.metadataDate, {stripCameraId, cameraSuffix})}`);
}

function printMissingDate(
	finding: Extract<Finding, {kind: 'MISSING_DATE'}>,
	root: string,
	location: string | null,
	cameraInfo: CameraInfo,
	stripCameraId: boolean,
): void {
	console.log(`\nMISSING DATE  ${relative(root, finding.path)}`);
	console.log(`  computed  : ${formatDate(finding.metadataDate)}`);
	printLocation(location);
	const cameraSuffix = formatCameraSuffix(cameraInfo);
	console.log(
		`  rename to : ${proposeFilename(basename(finding.path), finding.metadataDate, {stripCameraId, cameraSuffix})}`,
	);
}

function printMetadataSuspect(
	finding: Extract<Finding, {kind: 'METADATA_SUSPECT'}>,
	root: string,
	location: string | null,
): void {
	console.log(`\nMETADATA SUSPECT  ${relative(root, finding.path)}`);
	console.log(`  metadata  : ${formatDate(finding.metadataDate)}  <- date-only / low-confidence`);
	console.log(`  filename  : ${finding.filenameDate === null ? '-' : formatDate(finding.filenameDate)}`);
	console.log(`  folder    : ${finding.folderDate === null ? '-' : formatDate(finding.folderDate)}`);
	printLocation(location);
}

function printEditDerived(
	finding: Extract<Finding, {kind: 'EDIT_DERIVED'}>,
	root: string,
	location: string | null,
): void {
	console.log(`\nEDIT DERIVED  ${relative(root, finding.path)}`);
	console.log(`  no capture date available`);
	console.log(`  software  : ${finding.software}`);
	console.log(`  edited    : ${formatDate(finding.firstEdit)} -> ${formatDate(finding.lastEdit)}`);
	printLocation(location);
}

function printFolderWarning(warning: FolderWarning, root: string): void {
	if (warning.kind === 'FOLDER_UNIFORM_METADATA') {
		console.log(`\nFOLDER UNIFORM METADATA  ${relative(root, warning.folderPath)}`);
		console.log(`  folder    : ${formatDate(warning.folderDate)}`);
		console.log(`  all ${warning.fileCount} files share metadata: ${formatDate(warning.sharedTimestamp)}`);
		console.log(`  metadata is likely a file-mtime fallback rather than a real capture date`);
	} else {
		console.log(`\nFOLDER AFTER FILES  ${relative(root, warning.folderPath)}`);
		console.log(`  folder    : ${formatDate(warning.folderDate)}  <- after every file`);
		console.log(
			`  files     : ${formatDate(warning.earliestFile)} .. ${formatDate(warning.latestFile)}  (${warning.fileCount} files)`,
		);
	}
}

type Fixable = Extract<Finding, {kind: 'WRONG_DATE' | 'MISSING_DATE' | 'CONSISTENT'}>;
interface FixableEntry {
	finding: Fixable;
	cameraInfo: CameraInfo;
	location: string | null;
	sourceFolderName: string | null;
	imessage?: {
		senderName: string | null;
		recipient: string | null;
		chatIdentifier: string | null;
		dedupeKey: string | null;
	};
}

interface NeedsNamingEntry {
	chatIdentifier: string;
	handleCount: number;
	attachmentCount: number;
	earliestMessageDate: Date | null;
	latestMessageDate: Date | null;
	resolvedParticipants: string[];
}

type ResolvedImessageEntry =
	| {kind: 'resolved'; senderName: string | null; recipient: string | null}
	| {kind: 'skip-unnamed-group'};

/**
 * Resolve the (senderName, recipient) pair for a single iMessage attachment.
 *
 * Recipient rules:
 *   - chat.display_name non-empty                 -> use it as-is
 *   - contacts.chats[chatIdentifier] override     -> use it
 *   - chat has 1 handle                           -> DM, resolve the handle
 *   - chat has 2 or 3 handles                     -> join resolved names with
 *                                                    ', '; include self when
 *                                                    !isFromMe; exclude sender
 *   - chat has >3 handles                         -> SKIP this attachment
 */
function resolveImessageEntry(
	imessage: {
		isFromMe: boolean;
		handleId: string | null;
		chatDisplayName: string | null;
		chatIdentifier: string | null;
		chatHandles: string[];
	},
	contacts: ContactsMap,
	chats: ChatOverridesMap,
): ResolvedImessageEntry {
	const selfName = getSelfName(contacts);
	const senderName = imessage.isFromMe ? selfName : resolveContact(imessage.handleId, contacts);
	const groupTitle =
		imessage.chatDisplayName !== null && imessage.chatDisplayName !== '' ? imessage.chatDisplayName : null;
	if (groupTitle !== null) {
		return {kind: 'resolved', senderName, recipient: groupTitle};
	}
	const chatOverride = getChatOverride(imessage.chatIdentifier, chats);
	if (chatOverride !== null) {
		return {kind: 'resolved', senderName, recipient: chatOverride};
	}
	const handles = imessage.chatHandles;
	if (handles.length === 0 && imessage.handleId !== null && !imessage.isFromMe) {
		return {kind: 'resolved', senderName, recipient: selfName};
	}
	if (handles.length === 1) {
		const lone = handles[0] ?? null;
		const recipient = imessage.isFromMe ? resolveContact(lone, contacts) : selfName;
		return {kind: 'resolved', senderName, recipient};
	}
	if (handles.length === 2 || handles.length === 3) {
		const normalizedSender = imessage.isFromMe ? null : normalizeHandle(imessage.handleId ?? '');
		const others = handles.filter((handle) => normalizeHandle(handle) !== normalizedSender);
		const resolvedOthers = others.map((handle) => resolveContact(handle, contacts) ?? handle);
		const parts: string[] = [...resolvedOthers];
		if (!imessage.isFromMe && selfName !== null) {
			parts.push(selfName);
		}
		const recipient = parts.length === 0 ? null : parts.join(', ');
		return {kind: 'resolved', senderName, recipient};
	}
	return {kind: 'skip-unnamed-group'};
}

function formatReportDate(date: Date | null): string {
	if (date === null) {
		return '-';
	}
	return date.toISOString().slice(0, 10);
}

function printNeedsNamingReport(entries: ReadonlyMap<string, NeedsNamingEntry>): void {
	if (entries.size === 0) {
		return;
	}
	process.stderr.write(
		`\n${entries.size} unnamed group chats (>3 participants) were skipped — set a display_name in iMessage OR add a chats override in contacts.json, then re-run:\n`,
	);
	for (const entry of entries.values()) {
		const participants = entry.resolvedParticipants.length === 0 ? '-' : entry.resolvedParticipants.join(', ');
		process.stderr.write(
			`  ${entry.chatIdentifier}  attachments=${entry.attachmentCount}  handles=${entry.handleCount}  ${formatReportDate(entry.earliestMessageDate)}..${formatReportDate(entry.latestMessageDate)}  participants: ${participants}\n`,
		);
	}
}

interface PlanOptions {
	stripCameraId: boolean;
	outputRoot: string | null;
	/**
	 * Link-all mode: filesystem entries (including CONSISTENT files) get clean
	 * iMessage-style names (date + `(camera)` + stripped IMG stem) while keeping
	 * the day-folder + event-suffix layout. Used to organize a trusted export.
	 */
	linkAll: boolean;
}

interface DedupeResult {
	entries: FixableEntry[];
	droppedCount: number;
	savedBytes: number;
}

function dedupeImessageEntries(entries: readonly FixableEntry[], enabled: boolean): DedupeResult {
	if (!enabled) {
		return {entries: [...entries], droppedCount: 0, savedBytes: 0};
	}
	const kept = new Map<string, {entry: FixableEntry; size: number}>();
	const dropped = new Set<FixableEntry>();
	let droppedCount = 0;
	let savedBytes = 0;

	for (const entry of entries) {
		const imessage = entry.imessage;
		if (imessage === undefined || imessage.chatIdentifier === null || imessage.dedupeKey === null) {
			continue;
		}
		const key = `${imessage.chatIdentifier}\u0000${imessage.dedupeKey}`;
		const size = statSync(entry.finding.path).size;
		const existing = kept.get(key);
		if (existing === undefined) {
			kept.set(key, {entry, size});
			continue;
		}
		if (size > existing.size) {
			dropped.add(existing.entry);
			droppedCount += 1;
			savedBytes += existing.size;
			kept.set(key, {entry, size});
		} else {
			dropped.add(entry);
			droppedCount += 1;
			savedBytes += size;
		}
	}

	return {entries: entries.filter((entry) => !dropped.has(entry)), droppedCount, savedBytes};
}

/**
 * Build the list of hard-link plan entries for fixable findings, dropping
 * those whose metadata is date-only and printing a skip reason for each one
 * held back. When `outputRoot` is set, targets are placed under a new
 * decade/year/month/day hierarchy instead of next to the originals.
 */
function planLinksFromFindings(entries: readonly FixableEntry[], root: string, options: PlanOptions): PlanEntry[] {
	const plan: PlanEntry[] = [];
	for (const {finding, cameraInfo, location, sourceFolderName, imessage} of entries) {
		// CONSISTENT findings carry no metadataConfidence; the `in` guard keeps the
		// access type-safe now that CONSISTENT can reach this loop in link-all mode.
		if ('metadataConfidence' in finding && finding.metadataConfidence === 'date-only') {
			console.log(`SKIPPED (metadata is date-only): ${relative(root, finding.path)}`);
			continue;
		}
		let proposed: string;
		if (imessage !== undefined) {
			proposed = proposeImessageFilename({
				originalName: basename(finding.path),
				date: finding.metadataDate,
				senderName: imessage.senderName,
				recipient: imessage.recipient,
				cameraSuffix: formatImessageCameraSuffix(cameraInfo),
			});
		} else if (options.linkAll) {
			// proposeImessageFilename doubles as the shared clean-name composer:
			// with no sender/recipient it emits `<date+time> (camera).<ext>` and
			// strips the IMG_###### stem. The day-folder + event suffix still comes
			// from computeOutputDirectory below.
			proposed = proposeImessageFilename({
				originalName: basename(finding.path),
				date: finding.metadataDate,
				senderName: null,
				recipient: null,
				cameraSuffix: formatImessageCameraSuffix(cameraInfo),
			});
		} else {
			proposed = proposeFilename(basename(finding.path), finding.metadataDate, {
				stripCameraId: options.stripCameraId,
				cameraSuffix: formatCameraSuffix(cameraInfo),
			});
		}
		const targetDir =
			options.outputRoot === null
				? dirname(finding.path)
				: computeOutputDirectory({
						outputRoot: options.outputRoot,
						metadataDate: finding.metadataDate,
						sourceFolderName,
						place: location,
						includeDayFolder: imessage === undefined,
					});
		plan.push({from: finding.path, to: join(targetDir, proposed), kind: finding.kind});
	}
	return plan;
}

/**
 * Apply a list of plan entries by creating hard links and logging each one to
 * the undo log at `undoLogPath`. Creates any missing parent directories of
 * `to` paths.
 */
function sha256Sync(path: string): string {
	const fd = openSync(path, 'r');
	try {
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1 << 20);
		let bytesRead = readSync(fd, buffer, 0, buffer.length, null);
		while (bytesRead > 0) {
			hash.update(buffer.subarray(0, bytesRead));
			bytesRead = readSync(fd, buffer, 0, buffer.length, null);
		}
		return hash.digest('hex');
	} finally {
		closeSync(fd);
	}
}

async function applyPlan(plan: readonly PlanEntry[], undoLogPath: string, dedupeCollisions: boolean): Promise<void> {
	let candidates: ProposedRename[] = plan.map(({from, to}) => ({from, to}));
	if (dedupeCollisions) {
		// Resolve same-name collisions by content: drop verified byte-duplicates,
		// disambiguate genuinely distinct files (same timestamp, different photo)
		// by restoring their source stem instead of silently dropping them.
		const {resolved, droppedDuplicates} = resolveCollisions(candidates, (p) => statSync(p).size, sha256Sync);
		if (droppedDuplicates.length > 0) {
			process.stderr.write(`Dropped ${droppedDuplicates.length} true byte-duplicate(s), verified by SHA-256.\n`);
		}
		candidates = resolved;
	}
	for (const {to} of candidates) {
		await mkdir(dirname(to), {recursive: true});
	}
	const outcomes = await applyLinks(candidates, undoLogPath, () => new Date().toISOString());
	for (const outcome of outcomes) {
		if (outcome.kind === 'linked') {
			console.log(`LINKED ${outcome.from} -> ${outcome.to}`);
		} else if (outcome.kind === 'skipped-collision') {
			console.log(`SKIPPED (proposed-name collision): ${outcome.from} -> ${outcome.to}`);
		} else {
			console.log(`SKIPPED (target exists): ${outcome.from} -> ${outcome.to}`);
		}
	}
}

async function runUndo(root: string): Promise<void> {
	const undoLogPath = join(root, UNDO_LOG_NAME);
	const entries = await parseUndoLog(undoLogPath);
	if (entries.length === 0) {
		console.log(`No undo log found at ${undoLogPath} (nothing to undo).`);
		return;
	}
	console.log(`Undoing ${entries.length} entries from ${undoLogPath}`);
	const outcomes = await applyUndo(entries);
	const counts = {unlinked: 0, 'skipped-missing-target': 0, 'skipped-missing-original': 0, 'skipped-link-severed': 0};
	for (const outcome of outcomes) {
		counts[outcome.kind] += 1;
		if (outcome.kind === 'unlinked') {
			console.log(`UNLINKED ${outcome.to}`);
			await removeEmptyAncestors(outcome.to, root);
		} else if (outcome.kind === 'skipped-missing-target') {
			console.log(`SKIPPED (alias already gone): ${outcome.to}`);
		} else if (outcome.kind === 'skipped-missing-original') {
			console.log(`SKIPPED (original missing, cannot verify): ${outcome.from} -> ${outcome.to}`);
		} else {
			console.log(`SKIPPED (link severed, alias was replaced): ${outcome.from} -> ${outcome.to}`);
		}
	}
	console.log(`\n${'='.repeat(48)}`);
	console.log(`Undo summary`);
	console.log(`  unlinked                ${counts.unlinked}`);
	console.log(`  skipped (already gone)  ${counts['skipped-missing-target']}`);
	console.log(`  skipped (orig missing)  ${counts['skipped-missing-original']}`);
	console.log(`  skipped (link severed)  ${counts['skipped-link-severed']}`);
}

async function main(): Promise<void> {
	const {values, positionals} = parseArgs({
		allowPositionals: true,
		allowNegative: true,
		options: {
			limit: {type: 'string'},
			'show-all': {type: 'boolean', default: false},
			zone: {type: 'string'},
			fix: {type: 'boolean', default: false},
			undo: {type: 'boolean', default: false},
			plan: {type: 'string'},
			apply: {type: 'string'},
			'strip-camera-id': {type: 'boolean', default: false},
			'link-all': {type: 'boolean', default: false},
			'dedupe-collisions': {type: 'boolean', default: false},
			output: {type: 'string'},
			imessage: {type: 'boolean', default: false},
			'dedupe-imessage': {type: 'boolean'},
			db: {type: 'string'},
			contacts: {type: 'string'},
			help: {type: 'boolean', short: 'h', default: false},
		},
	});

	if (values.help) {
		console.log(USAGE);
		return;
	}

	const exclusiveModes = [values.fix, values.undo, values.plan !== undefined, values.apply !== undefined].filter(
		Boolean,
	).length;
	if (exclusiveModes > 1) {
		console.error('Error: --fix, --undo, --plan, and --apply are mutually exclusive.');
		process.exitCode = 1;
		return;
	}

	const target = positionals[0];
	const isApplyOrUndo = values.undo || values.apply !== undefined;
	if (isApplyOrUndo && values.output === undefined) {
		console.error(
			`Error: ${values.undo ? '--undo' : '--apply'} requires --output to locate the undo log and (for --apply) the alias destination.`,
		);
		process.exitCode = 1;
		return;
	}
	if (!isApplyOrUndo && target === undefined && !values.imessage) {
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}
	if (!isApplyOrUndo && values.imessage && values.fix && values.output === undefined) {
		console.error(
			'Error: --imessage --fix requires --output. Refusing to add hard-linked aliases inside ~/Library/Messages/Attachments/.',
		);
		process.exitCode = 1;
		return;
	}
	const root = target === undefined ? resolve('.') : resolve(target);

	const outputRoot = values.output === undefined ? null : resolve(values.output);
	const undoLogPath = join(outputRoot ?? root, UNDO_LOG_NAME);
	const dbPath = values.db ?? join(homedir(), 'Library', 'Messages', 'chat.db');
	const contactsPath = values.contacts ?? join(homedir(), '.config', 'photo-audit', 'contacts.json');
	const dedupeImessage = values.imessage && values['dedupe-imessage'] !== false;
	const loadedContacts: LoadedContacts = values.imessage
		? loadContacts(contactsPath)
		: {handles: new Map(), chats: new Map(), self: null};
	const contacts: ContactsMap = loadedContacts.handles;
	const chatOverrides: ChatOverridesMap = loadedContacts.chats;

	if (values.undo) {
		await runUndo(outputRoot ?? root);
		return;
	}

	if (values.apply !== undefined) {
		const plan = await readPlanFile(values.apply);
		if (plan.length === 0) {
			console.log(`Plan ${values.apply} is empty (nothing to apply).`);
			return;
		}
		await mkdir(outputRoot ?? root, {recursive: true});
		const probeSource = plan[0]?.from;
		if (probeSource !== undefined && !(await probeHardLinkSupport(probeSource, outputRoot ?? root))) {
			console.error(
				`Error: cannot create hard links from ${probeSource} into ${outputRoot ?? root}. Either the destination filesystem does not support hard links (ExFAT/FAT/SMB) or source and destination are on different filesystems (cross-device link not permitted). --fix and --apply require source and destination on the same APFS or HFS+ volume.`,
			);
			process.exitCode = 1;
			return;
		}
		console.log(`Applying ${plan.length} entries from ${values.apply}`);
		await applyPlan(plan, undoLogPath, values['dedupe-collisions']);
		return;
	}
	const limit = values.limit === undefined ? Infinity : Number(values.limit);
	const homeZone = values.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

	const counts: Record<Finding['kind'], number> = {
		CONSISTENT: 0,
		WRONG_DATE: 0,
		METADATA_SUSPECT: 0,
		EDIT_DERIVED: 0,
		MISSING_DATE: 0,
		NO_METADATA_DATE: 0,
	};

	const fixableEntries: FixableEntry[] = [];
	const folderEntries: FolderFileEntry[] = [];
	const datedFolders = new Map<string, DatedFolder>();
	const needsNaming = new Map<string, NeedsNamingEntry>();
	const exiftool = new ExifTool({geolocation: true});
	let scanned = 0;

	function accumulateNeedsNaming(
		imessage: {
			chatIdentifier: string | null;
			chatHandles: string[];
		},
		messageDate: Date | null,
	): void {
		const chatId = imessage.chatIdentifier ?? '(unknown chat)';
		const existing = needsNaming.get(chatId);
		const resolvedParticipants = imessage.chatHandles.map((handle) => resolveContact(handle, contacts) ?? handle);
		resolvedParticipants.sort();
		if (existing === undefined) {
			needsNaming.set(chatId, {
				chatIdentifier: chatId,
				handleCount: imessage.chatHandles.length,
				attachmentCount: 1,
				earliestMessageDate: messageDate,
				latestMessageDate: messageDate,
				resolvedParticipants,
			});
			return;
		}
		existing.attachmentCount += 1;
		if (messageDate !== null) {
			if (existing.earliestMessageDate === null || messageDate < existing.earliestMessageDate) {
				existing.earliestMessageDate = messageDate;
			}
			if (existing.latestMessageDate === null || messageDate > existing.latestMessageDate) {
				existing.latestMessageDate = messageDate;
			}
		}
	}

	async function* mediaItems(): AsyncGenerator<MediaItem> {
		if (values.imessage) {
			const db = openChatDb(dbPath);
			try {
				for (const row of iterAttachments(db)) {
					yield {kind: 'imessage', path: row.absPath, chat: row};
				}
			} finally {
				db.close();
			}
			return;
		}
		for await (const path of walkMedia(root, outputRoot ?? undefined)) {
			yield {kind: 'fs', path};
		}
	}

	try {
		for await (const item of mediaItems()) {
			if (scanned >= limit) {
				break;
			}
			const ctx = await contextFor(exiftool, item, root, homeZone);
			const {finding, location, cameraInfo, sourceFolderName, imessage, imessageDedupeKey} = ctx;
			counts[finding.kind] += 1;
			scanned += 1;

			const resolved = imessage === null ? null : resolveImessageEntry(imessage, contacts, chatOverrides);
			if (resolved !== null && resolved.kind === 'skip-unnamed-group' && imessage !== null) {
				const messageDate = item.kind === 'imessage' ? item.chat.messageDate : null;
				accumulateNeedsNaming(imessage, messageDate);
				continue;
			}
			const imessageEntry =
				resolved !== null && resolved.kind === 'resolved'
					? {
							senderName: resolved.senderName,
							recipient: resolved.recipient,
							chatIdentifier: imessage?.chatIdentifier ?? null,
							dedupeKey: imessageDedupeKey,
						}
					: undefined;

			if (finding.kind === 'WRONG_DATE') {
				printWrongDate(finding, root, location, cameraInfo, values['strip-camera-id']);
				fixableEntries.push({
					finding,
					cameraInfo,
					location,
					sourceFolderName,
					...(imessageEntry !== undefined && {imessage: imessageEntry}),
				});
			} else if (finding.kind === 'METADATA_SUSPECT') {
				printMetadataSuspect(finding, root, location);
			} else if (finding.kind === 'EDIT_DERIVED') {
				printEditDerived(finding, root, location);
			} else if (finding.kind === 'MISSING_DATE') {
				fixableEntries.push({
					finding,
					cameraInfo,
					location,
					sourceFolderName,
					...(imessageEntry !== undefined && {imessage: imessageEntry}),
				});
				if (values['show-all']) {
					printMissingDate(finding, root, location, cameraInfo, values['strip-camera-id']);
				}
			} else if (finding.kind === 'CONSISTENT' && values['link-all']) {
				// Link-all mode organizes a trusted export: a CONSISTENT file (EXIF
				// date agrees with its folder) is still worth a clean alias. Only fs
				// items reach CONSISTENT, so there is never an imessage block here.
				fixableEntries.push({finding, cameraInfo, location, sourceFolderName});
			} else if (finding.kind === 'NO_METADATA_DATE' && values['show-all']) {
				console.log(`\nNO METADATA DATE  ${relative(root, finding.path)}`);
			}

			// Folder-warning pipeline only applies to the filesystem source; iMessage
			// attachments live under UUID-hashed parents that have no calendar meaning.
			if (
				item.kind === 'fs' &&
				(finding.kind === 'CONSISTENT' || finding.kind === 'WRONG_DATE' || finding.kind === 'MISSING_DATE')
			) {
				const folderPath = datedAncestorFolder(item.path, root);
				if (folderPath !== null) {
					if (!datedFolders.has(folderPath)) {
						const folderDate = parseDateFromString(basename(folderPath));
						if (folderDate !== null) {
							datedFolders.set(folderPath, {folderPath, folderDate});
						}
					}
					folderEntries.push({path: item.path, metadataDate: finding.metadataDate, folderPath});
				}
			}

			if (scanned % 200 === 0) {
				process.stderr.write(`  ...scanned ${scanned} files\r`);
			}
		}
	} finally {
		await exiftool.end();
	}

	const folderWarnings = planFolderWarnings(folderEntries, Array.from(datedFolders.values()));
	if (folderWarnings.length > 0) {
		console.log(`\n${'-'.repeat(48)}`);
		console.log('Folder-level warnings');
		for (const warning of folderWarnings) {
			printFolderWarning(warning, root);
		}
	}

	if (fixableEntries.length > 0 && (values.fix || values.plan !== undefined)) {
		console.log(`\n${'-'.repeat(48)}`);
		const deduped = dedupeImessageEntries(fixableEntries, dedupeImessage);
		if (deduped.droppedCount > 0) {
			process.stderr.write(`Deduped ${deduped.droppedCount} attachments (${deduped.savedBytes} bytes saved)\n`);
		}
		const plan = planLinksFromFindings(deduped.entries, root, {
			stripCameraId: values['strip-camera-id'],
			outputRoot,
			linkAll: values['link-all'],
		});
		if (values.plan !== undefined) {
			await writePlanFile(values.plan, plan);
			console.log(`Wrote ${plan.length} plan entries to ${values.plan}`);
		} else {
			await mkdir(outputRoot ?? root, {recursive: true});
			const probeSource = plan[0]?.from;
			if (probeSource !== undefined && !(await probeHardLinkSupport(probeSource, outputRoot ?? root))) {
				console.error(
					`Error: cannot create hard links from ${probeSource} into ${outputRoot ?? root}. Either the destination filesystem does not support hard links (ExFAT/FAT/SMB) or source and destination are on different filesystems (cross-device link not permitted). --fix requires source and destination on the same APFS or HFS+ volume.`,
				);
				process.exitCode = 1;
				return;
			}
			console.log('Applying --fix file links');
			await applyPlan(plan, undoLogPath, values['dedupe-collisions']);
		}
	}

	printNeedsNamingReport(needsNaming);

	console.log(`\n${'='.repeat(48)}`);
	console.log(`Scanned ${scanned} files under ${root}`);
	console.log(`Home timezone for UTC-only video dates: ${homeZone}`);
	console.log(`  WRONG_DATE       ${counts.WRONG_DATE}`);
	console.log(`  METADATA_SUSPECT ${counts.METADATA_SUSPECT}`);
	console.log(`  EDIT_DERIVED     ${counts.EDIT_DERIVED}`);
	console.log(`  MISSING_DATE     ${counts.MISSING_DATE}`);
	console.log(`  NO_METADATA_DATE ${counts.NO_METADATA_DATE}`);
	console.log(`  CONSISTENT       ${counts.CONSISTENT}`);
	console.log(`  folder warnings  ${folderWarnings.length}`);
}

await main();
