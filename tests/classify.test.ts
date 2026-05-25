import {describe, expect, it} from 'vitest';
import {classify} from '../src/classify.ts';
import type {DateParts} from '../src/dateParts.ts';

const date = (year: number, month: number, day: number | null): DateParts => ({
	year,
	month,
	day,
	time: null,
});

const dateTime = (
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
): DateParts => ({
	year,
	month,
	day,
	time: {hour, minute, second},
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

	it('does not flag WRONG_DATE when only an ancestor folder date disagrees (folder dates are labels, not per-file constraints)', () => {
		const finding = classify({
			path: '/photos/2019/2019-01-01 Party/IMG_1.jpg',
			metadataDate: date(2023, 5, 26),
			filenameDate: null,
			folderDate: date(2019, 1, 1),
		});
		expect(finding.kind).toBe('MISSING_DATE');
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

	it('reports only the filename conflict when filename and folder both disagree (folder is ignored)', () => {
		const finding = classify({
			path: '/photos/2019-01-01 Party/2020-02-02 thing.jpg',
			metadataDate: date(2023, 5, 26),
			filenameDate: date(2020, 2, 2),
			folderDate: date(2019, 1, 1),
		});
		expect(finding.kind).toBe('WRONG_DATE');
		if (finding.kind === 'WRONG_DATE') {
			expect(finding.conflicts).toEqual([{source: 'filename', found: date(2020, 2, 2)}]);
		}
	});

	it('reports CONSISTENT when filename has no date but folder date agrees with metadata', () => {
		const finding = classify({
			path: '/photos/2022-06-04 Addams family/IMG_random.jpg',
			metadataDate: date(2022, 6, 4),
			filenameDate: null,
			folderDate: date(2022, 6, 4),
		});
		expect(finding.kind).toBe('CONSISTENT');
	});

	it('reports MISSING_DATE when filename has no date and folder disagrees (folder cannot rescue)', () => {
		const finding = classify({
			path: '/photos/2020-11-02 Genesis School Photos/uuid.jpg',
			metadataDate: date(2020, 10, 29),
			filenameDate: null,
			folderDate: date(2020, 11, 2),
		});
		expect(finding.kind).toBe('MISSING_DATE');
	});

	it('flags METADATA_SUSPECT when date-only metadata conflicts with a precise filename timestamp', () => {
		const finding = classify({
			path: '/CyanPhotos/iMazing/2021-05-16 082026 iMazing.JPG',
			metadataDate: date(2021, 4, 12),
			metadataConfidence: 'date-only',
			filenameDate: dateTime(2021, 5, 16, 8, 20, 26),
			folderDate: null,
		});
		expect(finding.kind).toBe('METADATA_SUSPECT');
		if (finding.kind === 'METADATA_SUSPECT') {
			expect(finding.metadataDate).toEqual(date(2021, 4, 12));
			expect(finding.filenameDate).toEqual(dateTime(2021, 5, 16, 8, 20, 26));
			expect(finding.folderDate).toBeNull();
		}
	});

	it('does not flag METADATA_SUSPECT from folder alone (folder dates do not produce findings)', () => {
		const finding = classify({
			path: '/photos/2021-05-16 082026/IMG_1.jpg',
			metadataDate: date(2020, 10, 18),
			metadataConfidence: 'date-only',
			filenameDate: null,
			folderDate: dateTime(2021, 5, 16, 8, 20, 26),
		});
		expect(finding.kind).toBe('MISSING_DATE');
	});

	it('does not flag WRONG_DATE for date-only metadata when only folder disagrees', () => {
		const finding = classify({
			path: '/photos/2019-01-01 Party/IMG_1.jpg',
			metadataDate: date(2020, 10, 18),
			metadataConfidence: 'date-only',
			filenameDate: null,
			folderDate: date(2019, 1, 1),
		});
		expect(finding.kind).toBe('MISSING_DATE');
	});

	it('keeps WRONG_DATE when high-confidence metadata conflicts with a precise filename time', () => {
		const finding = classify({
			path: '/photos/2024-10-11 153044 iMazing.MOV',
			metadataDate: dateTime(2023, 5, 26, 18, 29, 41),
			metadataConfidence: 'high',
			filenameDate: dateTime(2024, 10, 11, 15, 30, 44),
			folderDate: null,
		});
		expect(finding.kind).toBe('WRONG_DATE');
	});

	it('reports EDIT_DERIVED when the input carries edit-derived dates instead of a capture date', () => {
		const finding = classify({
			path: '/CyanPhotos/iMazing/2018-04-21 092845 iMazing.JPG',
			metadataDate: null,
			editDerived: {
				firstEdit: dateTime(2018, 4, 20, 21, 53, 52),
				lastEdit: dateTime(2018, 4, 21, 9, 28, 45),
				software: 'Adobe Photoshop CC 2015.5 (Windows)',
			},
			filenameDate: dateTime(2018, 4, 21, 9, 28, 45),
			folderDate: null,
		});
		expect(finding.kind).toBe('EDIT_DERIVED');
		if (finding.kind === 'EDIT_DERIVED') {
			expect(finding.path).toBe('/CyanPhotos/iMazing/2018-04-21 092845 iMazing.JPG');
			expect(finding.firstEdit).toEqual(dateTime(2018, 4, 20, 21, 53, 52));
			expect(finding.lastEdit).toEqual(dateTime(2018, 4, 21, 9, 28, 45));
			expect(finding.software).toBe('Adobe Photoshop CC 2015.5 (Windows)');
		}
	});

	it('EDIT_DERIVED overrides NO_METADATA_DATE even when filenameDate and folderDate are null', () => {
		const finding = classify({
			path: '/photos/edited.jpg',
			metadataDate: null,
			editDerived: {
				firstEdit: dateTime(2020, 1, 1, 10, 0, 0),
				lastEdit: dateTime(2020, 1, 1, 10, 5, 0),
				software: 'Adobe Lightroom Classic 9.0',
			},
			filenameDate: null,
			folderDate: null,
		});
		expect(finding.kind).toBe('EDIT_DERIVED');
	});
});
