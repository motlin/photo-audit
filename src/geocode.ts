/**
 * Reverse-geocoding helpers for the photo-audit CLI.
 *
 * The CLI displays a human-readable place name (Apple Photos / iMazing style,
 * e.g. "Palisades Park") next to findings for files that carry GPS metadata.
 * The primary source of place names is ExifTool's built-in geolocation
 * feature, enabled via `geolocation: true` on the {@link ExifTool}
 * constructor and surfaced as `GeolocationCity` / `GeolocationRegion` /
 * `GeolocationCountry` tags.
 *
 * This module owns the pure helpers around that lookup: rounding GPS
 * coordinates to a stable cache key, formatting a place string from a set of
 * geolocation tags, and a tiny JSON-backed cache so that scans across nearby
 * photos do not need to redo work.
 */

import {readFile, writeFile} from 'node:fs/promises';

/** Rounds a coordinate to 4 decimal places (~11m precision). */
export function roundCoord(n: number): number {
	return Math.round(n * 10000) / 10000;
}

/**
 * Cache key for a latitude/longitude pair, rounded to 4 decimal places so
 * nearby photos all map to the same entry.
 */
export function coordKey(latitude: number, longitude: number): string {
	return `${roundCoord(latitude)},${roundCoord(longitude)}`;
}

/**
 * A reverse-geocoded location. Any individual field may be absent if the
 * source did not provide it. A `null` entry in the cache means "we already
 * looked this coordinate up and got nothing back", which is worth remembering
 * so we don't keep retrying.
 */
export interface LocationLabel {
	city?: string;
	region?: string;
	country?: string;
}

export class GeocodeCache {
	private readonly entries = new Map<string, LocationLabel | null>();

	get(latitude: number, longitude: number): LocationLabel | null | undefined {
		return this.entries.get(coordKey(latitude, longitude));
	}

	has(latitude: number, longitude: number): boolean {
		return this.entries.has(coordKey(latitude, longitude));
	}

	set(latitude: number, longitude: number, label: LocationLabel | null): void {
		this.entries.set(coordKey(latitude, longitude), label);
	}

	toJSON(): Record<string, LocationLabel | null> {
		const out: Record<string, LocationLabel | null> = {};
		for (const [key, value] of this.entries) {
			out[key] = value;
		}
		return out;
	}

	static fromJSON(data: unknown): GeocodeCache {
		const cache = new GeocodeCache();
		if (data === null || typeof data !== 'object') {
			return cache;
		}
		for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
			if (value === null) {
				cache.entries.set(key, null);
				continue;
			}
			if (typeof value === 'object') {
				cache.entries.set(key, value as LocationLabel);
			}
		}
		return cache;
	}
}

/**
 * Load a cache from disk. Missing or malformed files yield an empty cache
 * rather than an error: a corrupt cache is never fatal, the audit can rebuild
 * it on the fly.
 */
export async function loadGeocodeCache(path: string): Promise<GeocodeCache> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch {
		return new GeocodeCache();
	}
	try {
		return GeocodeCache.fromJSON(JSON.parse(raw));
	} catch {
		return new GeocodeCache();
	}
}

export async function saveGeocodeCache(path: string, cache: GeocodeCache): Promise<void> {
	await writeFile(path, `${JSON.stringify(cache.toJSON(), null, 2)}\n`, 'utf8');
}

/**
 * Geolocation tags as returned by ExifTool when launched with
 * `geolocation: true`. We accept anything matching this shape so callers can
 * pass a raw `Tags` object without further narrowing.
 */
export interface GeolocationTagSubset {
	GeolocationCity?: string;
	GeolocationRegion?: string;
	GeolocationCountry?: string;
}

/**
 * Build a `city, region, country` style label out of a tag bag. Empty strings
 * are treated as missing. Returns null when every field is absent.
 */
export function formatPlaceFromTags(tags: GeolocationTagSubset): string | null {
	const parts = [tags.GeolocationCity, tags.GeolocationRegion, tags.GeolocationCountry].filter(
		(part): part is string => part !== undefined && part !== '',
	);
	return parts.length === 0 ? null : parts.join(', ');
}
