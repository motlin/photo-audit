import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	getChatOverride,
	getSelfName,
	loadContacts,
	normalizeHandle,
	resolveContact,
} from '../../src/imessage/contacts.ts';

describe('loadContacts', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'photo-audit-contacts-'));
	});

	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it('returns empty maps when the file does not exist', () => {
		const missing = join(dir, 'missing.json');
		const result = loadContacts(missing);
		expect(result.handles).toBeInstanceOf(Map);
		expect(result.handles.size).toBe(0);
		expect(result.chats).toBeInstanceOf(Map);
		expect(result.chats.size).toBe(0);
		expect(result.self).toBeNull();
	});

	it('returns handles populated from valid JSON', () => {
		const path = join(dir, 'contacts.json');
		writeFileSync(path, JSON.stringify({'+18452168005': 'Vika', 'craig@example.com': 'Craig'}));
		const result = loadContacts(path);
		expect(result.handles.get('+18452168005')).toBe('Vika');
		expect(result.handles.get('craig@example.com')).toBe('Craig');
		expect(result.handles.size).toBe(2);
		expect(result.chats.size).toBe(0);
		expect(result.self).toBeNull();
	});

	it('parses the chats object into a separate map without polluting the handles map', () => {
		const path = join(dir, 'contacts.json');
		writeFileSync(
			path,
			JSON.stringify({
				self: 'Craig',
				'+18452168005': 'Vika',
				chats: {chat123: 'Family Group', chat456: 'Book Club'},
			}),
		);
		const result = loadContacts(path);
		expect(result.self).toBe('Craig');
		expect(result.handles.get('+18452168005')).toBe('Vika');
		expect(result.handles.get('self')).toBe('Craig');
		expect(result.handles.has('chat123')).toBe(false);
		expect(result.handles.has('chats')).toBe(false);
		expect(result.chats.get('chat123')).toBe('Family Group');
		expect(result.chats.get('chat456')).toBe('Book Club');
		expect(result.chats.size).toBe(2);
	});

	it('throws an error naming the file when JSON is malformed', () => {
		const path = join(dir, 'broken.json');
		writeFileSync(path, '{not valid json');
		expect(() => loadContacts(path)).toThrow(path);
	});

	it('ignores the reserved "chats" key holding chat-id overrides', () => {
		const path = join(dir, 'contacts.json');
		writeFileSync(
			path,
			JSON.stringify({
				'+18452168005': 'Vika',
				chats: {chat100734652767048314: 'Motlins'},
			}),
		);
		const result = loadContacts(path);
		expect(result.handles.get('+18452168005')).toBe('Vika');
		expect(result.handles.has('chats')).toBe(false);
		expect(result.handles.size).toBe(1);
		expect(result.chats.get('chat100734652767048314')).toBe('Motlins');
	});

	it('throws when chats is not an object', () => {
		const path = join(dir, 'badchats.json');
		writeFileSync(path, JSON.stringify({chats: 'oops'}));
		expect(() => loadContacts(path)).toThrow(/chats/);
	});
});

describe('getChatOverride', () => {
	const chats = new Map<string, string>([
		['chat123', 'Family Group'],
		['+15551234567', 'DM Alias'],
	]);

	it('returns null for a null chat id', () => {
		expect(getChatOverride(null, chats)).toBeNull();
	});

	it('returns null when the chat id is not present', () => {
		expect(getChatOverride('chatXYZ', chats)).toBeNull();
	});

	it('returns the override when the chat id is present', () => {
		expect(getChatOverride('chat123', chats)).toBe('Family Group');
	});

	it('returns null when the chats map is empty', () => {
		expect(getChatOverride('chat123', new Map())).toBeNull();
	});
});

describe('normalizeHandle', () => {
	it('preserves an already E.164-shaped US number', () => {
		expect(normalizeHandle('+18452168005')).toBe('+18452168005');
	});

	it('normalizes a (xxx) xxx-xxxx formatted number to E.164', () => {
		expect(normalizeHandle('(845) 216-8005')).toBe('+18452168005');
	});

	it('prepends +1 to a 10-digit US number', () => {
		expect(normalizeHandle('8452168005')).toBe('+18452168005');
	});

	it('prepends + to an 11-digit number that already starts with 1', () => {
		expect(normalizeHandle('18452168005')).toBe('+18452168005');
	});

	it('lowercases an email address', () => {
		expect(normalizeHandle('Vika@Example.com')).toBe('vika@example.com');
	});
});

describe('resolveContact', () => {
	const contacts = new Map<string, string>([
		['+18452168005', 'Vika'],
		['craig@example.com', 'Craig'],
	]);

	it('returns null for a null handle', () => {
		expect(resolveContact(null, contacts)).toBeNull();
	});

	it('returns null for an empty handle', () => {
		expect(resolveContact('', contacts)).toBeNull();
	});

	it('resolves a phone in E.164 form', () => {
		expect(resolveContact('+18452168005', contacts)).toBe('Vika');
	});

	it('resolves a phone written with punctuation', () => {
		expect(resolveContact('(845) 216-8005', contacts)).toBe('Vika');
	});

	it('resolves a 10-digit phone', () => {
		expect(resolveContact('8452168005', contacts)).toBe('Vika');
	});

	it('returns the original (un-normalized) input when the handle is unknown', () => {
		expect(resolveContact('(555) 123-4567', contacts)).toBe('(555) 123-4567');
	});

	it('resolves an email case-insensitively', () => {
		expect(resolveContact('Craig@Example.COM', contacts)).toBe('Craig');
	});
});

describe('getSelfName', () => {
	it('returns the value mapped to the self key', () => {
		const contacts = new Map<string, string>([['self', 'Craig']]);
		expect(getSelfName(contacts)).toBe('Craig');
	});

	it('returns null when no self entry exists', () => {
		const contacts = new Map<string, string>([['+18452168005', 'Vika']]);
		expect(getSelfName(contacts)).toBeNull();
	});

	it('returns null for an empty contacts map', () => {
		expect(getSelfName(new Map())).toBeNull();
	});
});
