import {describe, expect, it} from 'vitest';
import {classify} from '../src/classify.ts';
import type {DateParts} from '../src/dateParts.ts';

const date = (year: number, month: number, day: number | null): DateParts => ({
	year,
	month,
	day,
	time: null,
});

describe('classify', () => {
	it('flags WRONG_DATE when the filename date disagrees with metadata', () => {
		const finding = classify({
			path: '/CyanPhotos/iMazing/2024-10-11 153044 iMazing.MOV',
			metadataDate: date(2023, 5, 26),
			filenameDate: date(2024, 10, 11),
			folderDate: null,
		});
		expect(finding.kind).toBe('WRONG_DATE');
		if (finding.kind === 'WRONG_DATE') {
			expect(finding.conflicts).toEqual([{source: 'filename', found: date(2024, 10, 11)}]);
		}
	});

	it('flags WRONG_DATE when an ancestor folder date disagrees', () => {
		const finding = classify({
			path: '/photos/2019/2019-01-01 Party/IMG_1.jpg',
			metadataDate: date(2023, 5, 26),
			filenameDate: null,
			folderDate: date(2019, 1, 1),
		});
		expect(finding.kind).toBe('WRONG_DATE');
		if (finding.kind === 'WRONG_DATE') {
			expect(finding.conflicts).toEqual([{source: 'folder', found: date(2019, 1, 1)}]);
		}
	});

	it('reports CONSISTENT when filename and folder both agree with metadata', () => {
		const finding = classify({
			path: '/photos/2023-05-26 Palisades/IMG_20230526_100000.jpg',
			metadataDate: date(2023, 5, 26),
			filenameDate: date(2023, 5, 26),
			folderDate: date(2023, 5, 26),
		});
		expect(finding.kind).toBe('CONSISTENT');
	});

	it('treats a month-precision folder as consistent when year and month match', () => {
		const finding = classify({
			path: '/photos/2022-06 Nadia Shoot/IMG_2.jpg',
			metadataDate: date(2022, 6, 4),
			filenameDate: null,
			folderDate: date(2022, 6, null),
		});
		expect(finding.kind).toBe('CONSISTENT');
	});

	it('reports MISSING_DATE when metadata has a date but the name does not', () => {
		const finding = classify({
			path: '/photos/Image Capture/IMG_4309.jpg',
			metadataDate: date(2024, 1, 2),
			filenameDate: null,
			folderDate: null,
		});
		expect(finding.kind).toBe('MISSING_DATE');
	});

	it('reports NO_METADATA_DATE when the file has no metadata date', () => {
		const finding = classify({
			path: '/photos/scan.png',
			metadataDate: null,
			filenameDate: date(2010, 3, 3),
			folderDate: null,
		});
		expect(finding.kind).toBe('NO_METADATA_DATE');
	});

	it('collects multiple conflicts when filename and folder both disagree', () => {
		const finding = classify({
			path: '/photos/2019-01-01 Party/2020-02-02 thing.jpg',
			metadataDate: date(2023, 5, 26),
			filenameDate: date(2020, 2, 2),
			folderDate: date(2019, 1, 1),
		});
		expect(finding.kind).toBe('WRONG_DATE');
		if (finding.kind === 'WRONG_DATE') {
			expect(finding.conflicts).toHaveLength(2);
		}
	});
});
