// Loads and resolves iMessage handles (phone numbers / emails) to friendly
// display names. Contacts come from a JSON file shaped `{"<handle>":
// "<display>", ...}`. Handles in the JSON are expected to be stored in their
// normalized form (E.164 for phones, lowercase for emails); callers pass raw
// handles which are normalized before lookup.

import {readFileSync} from 'node:fs';

export type ContactsMap = Map<string, string>;
export type ChatOverridesMap = Map<string, string>;

export interface LoadedContacts {
	handles: ContactsMap;
	chats: ChatOverridesMap;
	self: string | null;
}

export function loadContacts(path: string): LoadedContacts {
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return {handles: new Map(), chats: new Map(), self: null};
		}
		throw error;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to parse contacts JSON at ${path}: ${message}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`Contacts JSON at ${path} must be an object mapping handle -> display name`);
	}
	const handles: ContactsMap = new Map();
	const chats: ChatOverridesMap = new Map();
	let self: string | null = null;
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		// `chats` is a reserved key holding chat-id -> display-name overrides,
		// not a handle mapping; parse it into the overrides map rather than
		// treating it as a handle entry.
		if (key === 'chats') {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				throw new Error(`Contacts JSON at ${path} has non-object value for 'chats'`);
			}
			for (const [chatKey, chatValue] of Object.entries(value as Record<string, unknown>)) {
				if (typeof chatValue !== 'string') {
					throw new Error(`Contacts JSON at ${path} has non-string value for chats[${chatKey}]`);
				}
				chats.set(chatKey, chatValue);
			}
			continue;
		}
		if (typeof value !== 'string') {
			throw new Error(`Contacts JSON at ${path} has non-string value for handle ${key}`);
		}
		if (key === 'self') {
			self = value;
		}
		handles.set(key, value);
	}
	return {handles, chats, self};
}

export function normalizeHandle(handle: string): string {
	if (handle.includes('@')) {
		return handle.toLowerCase();
	}
	const digits = handle.replace(/\D/g, '');
	if (handle.startsWith('+') || digits.length >= 7) {
		if (digits.length === 10) {
			return `+1${digits}`;
		}
		return `+${digits}`;
	}
	return handle;
}

export function resolveContact(handle: string | null, contacts: ContactsMap): string | null {
	if (handle === null || handle === '') {
		return null;
	}
	const normalized = normalizeHandle(handle);
	const hit = contacts.get(normalized);
	if (hit !== undefined) {
		return hit;
	}
	return handle;
}

/**
 * Look up the current user's display name in the contacts map using the
 * special `self` key. Returns null when the key is absent. This is the name
 * used as the "from" side of outgoing iMessage attachments and the "to" side
 * of incoming DMs.
 */
export function getSelfName(contacts: ContactsMap): string | null {
	return contacts.get('self') ?? null;
}

/**
 * Look up an override for a specific chat by its `chat_identifier`. Returns
 * null when the override map is empty or the chat is not present. Used to
 * label unnamed group chats that have too many participants to auto-derive.
 */
export function getChatOverride(chatId: string | null, chats: ChatOverridesMap): string | null {
	if (chatId === null) {
		return null;
	}
	return chats.get(chatId) ?? null;
}
