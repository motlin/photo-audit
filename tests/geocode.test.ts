import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	coordKey,
	formatPlaceFromTags,
	GeocodeCache,
	loadGeocodeCache,
	roundCoord,
	saveGeocodeCache,
} from '../src/geocode.ts';

describe('roundCoord', () => {
	it('rounds positive numbers to 4 decimal places', () => {
		expect(roundCoord(40.84810000123)).toBe(40.8481);
	});

	it('rounds negative numbers to 4 decimal places', () => {
		expect(roundCoord(-73.9842333)).toBe(-73.9842);
	});

	it('rounds toward the nearest value past the halfway point', () => {
		expect(roundCoord(40.848161)).toBe(40.8482);
	});

	it('handles zero', () => {
		expect(roundCoord(0)).toBe(0);
	});

	it('returns an integer-equivalent when the input has no fractional part', () => {
		expect(roundCoord(40)).toBe(40);
	});
});

describe('coordKey', () => {
	it('rounds both lat and lon to 4 decimals and joins them with a comma', () => {
		expect(coordKey(40.848098, -73.984231)).toBe('40.8481,-73.9842');
	});

	it('produces the same key for nearby coordinates within 4-decimal precision', () => {
		expect(coordKey(40.84810111, -73.98423999)).toBe(coordKey(40.84812, -73.98424));
	});

	it('differs when coordinates round to different 4-decimal values', () => {
		expect(coordKey(40.8481, -73.9842)).not.toBe(coordKey(40.8482, -73.9842));
	});
});

describe('GeocodeCache', () => {
	it('returns undefined for a coordinate that has not been set', () => {
		const cache = new GeocodeCache();
		expect(cache.get(40.8481, -73.9842)).toBeUndefined();
	});

	it('returns the stored label for the same coordinate', () => {
		const cache = new GeocodeCache();
		cache.set(40.8481, -73.9842, {city: 'Palisades Park', country: 'United States'});
		expect(cache.get(40.8481, -73.9842)).toEqual({city: 'Palisades Park', country: 'United States'});
	});

	it('returns the stored label when coordinates differ only beyond 4 decimal places', () => {
		const cache = new GeocodeCache();
		cache.set(40.84810111, -73.98423999, {city: 'Palisades Park', country: 'United States'});
		expect(cache.get(40.84812, -73.98424)).toEqual({city: 'Palisades Park', country: 'United States'});
	});

	it('stores a null label to remember a negative result', () => {
		const cache = new GeocodeCache();
		cache.set(0, 0, null);
		expect(cache.has(0, 0)).toBe(true);
		expect(cache.get(0, 0)).toBeNull();
	});

	it('reports `has` true for set coordinates and false for unset ones', () => {
		const cache = new GeocodeCache();
		cache.set(40.8481, -73.9842, {city: 'Palisades Park'});
		expect(cache.has(40.8481, -73.9842)).toBe(true);
		expect(cache.has(0, 0)).toBe(false);
	});
});

describe('GeocodeCache JSON persistence', () => {
	let tempDir: string;
	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'photo-audit-geocode-'));
	});
	afterEach(async () => {
		await rm(tempDir, {recursive: true, force: true});
	});

	it('returns an empty cache when the file does not exist', async () => {
		const cache = await loadGeocodeCache(join(tempDir, 'missing.json'));
		expect(cache.has(40.8481, -73.9842)).toBe(false);
	});

	it('round-trips entries through saveGeocodeCache and loadGeocodeCache', async () => {
		const path = join(tempDir, 'geo.json');
		const cache = new GeocodeCache();
		cache.set(40.8481, -73.9842, {city: 'Palisades Park', country: 'United States'});
		cache.set(0, 0, null);
		await saveGeocodeCache(path, cache);

		const reloaded = await loadGeocodeCache(path);
		expect(reloaded.get(40.8481, -73.9842)).toEqual({
			city: 'Palisades Park',
			country: 'United States',
		});
		expect(reloaded.has(0, 0)).toBe(true);
		expect(reloaded.get(0, 0)).toBeNull();
	});

	it('writes JSON keyed by coordinate string', async () => {
		const path = join(tempDir, 'geo.json');
		const cache = new GeocodeCache();
		cache.set(40.8481, -73.9842, {city: 'Palisades Park'});
		await saveGeocodeCache(path, cache);

		const raw = await readFile(path, 'utf8');
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		expect(parsed['40.8481,-73.9842']).toEqual({city: 'Palisades Park'});
	});

	it('treats malformed JSON as an empty cache rather than throwing', async () => {
		const path = join(tempDir, 'geo.json');
		await writeFile(path, 'not json', 'utf8');
		const cache = await loadGeocodeCache(path);
		expect(cache.has(40.8481, -73.9842)).toBe(false);
	});
});

describe('formatPlaceFromTags', () => {
	it('joins city, region, and country', () => {
		expect(
			formatPlaceFromTags({
				GeolocationCity: 'Palisades Park',
				GeolocationRegion: 'New Jersey',
				GeolocationCountry: 'United States',
			}),
		).toBe('Palisades Park, New Jersey, United States');
	});

	it('omits missing components but keeps the order', () => {
		expect(
			formatPlaceFromTags({
				GeolocationCity: 'Zurich',
				GeolocationCountry: 'Switzerland',
			}),
		).toBe('Zurich, Switzerland');
	});

	it('returns null when no geolocation tag is present', () => {
		expect(formatPlaceFromTags({})).toBeNull();
	});

	it('returns null when every geolocation field is an empty string', () => {
		expect(
			formatPlaceFromTags({
				GeolocationCity: '',
				GeolocationCountry: '',
			}),
		).toBeNull();
	});
});
