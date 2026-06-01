import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {getSelfName, loadContacts, normalizeHandle, resolveContact} from '../../src/imessage/contacts.ts';

describe('loadContacts', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'photo-audit-contacts-'));
	});

	afterEach(() => {
		rmSync(dir, {recursive: true, force: true});
	});

	it('returns an empty Map when the file does not exist', () => {
		const missing = join(dir, 'missing.json');
		const result = loadContacts(missing);
		expect(result).toBeInstanceOf(Map);
		expect(result.size).toBe(0);
	});

	it('returns a Map populated from valid JSON', () => {
		const path = join(dir, 'contacts.json');
		writeFileSync(path, JSON.stringify({'+18452168005': 'Vika', 'craig@example.com': 'Craig'}));
		const result = loadContacts(path);
		expect(result.get('+18452168005')).toBe('Vika');
		expect(result.get('craig@example.com')).toBe('Craig');
		expect(result.size).toBe(2);
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
		expect(result.get('+18452168005')).toBe('Vika');
		expect(result.has('chats')).toBe(false);
		expect(result.size).toBe(1);
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
