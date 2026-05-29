// Loads and resolves iMessage handles (phone numbers / emails) to friendly
// display names. Contacts come from a JSON file shaped `{"<handle>":
// "<display>", ...}`. Handles in the JSON are expected to be stored in their
// normalized form (E.164 for phones, lowercase for emails); callers pass raw
// handles which are normalized before lookup.

import {readFileSync} from 'node:fs';

export type ContactsMap = Map<string, string>;

export function loadContacts(path: string): ContactsMap {
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return new Map();
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
	const map: ContactsMap = new Map();
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		// `chats` is a reserved key holding chat-id -> display-name overrides,
		// not a handle mapping; skip it rather than rejecting the whole file.
		if (key === 'chats') {
			continue;
		}
		if (typeof value !== 'string') {
			throw new Error(`Contacts JSON at ${path} has non-string value for handle ${key}`);
		}
		map.set(key, value);
	}
	return map;
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
