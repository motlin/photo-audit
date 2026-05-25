import {describe, expect, it} from 'vitest';
import type {DateParts} from '../src/dateParts.ts';
import {planFolderWarnings, type FolderFileEntry} from '../src/folderWarnings.ts';

const dt = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): DateParts => ({
	year,
	month,
	day,
	time: {hour, minute, second},
});

const file = (path: string, metadataDate: DateParts, folderPath: string): FolderFileEntry => ({
	path,
	metadataDate,
	folderPath,
});

describe('planFolderWarnings', () => {
	it('is silent when folder date is the earliest file date (starting-day label, e.g. "Levi\'s Birth")', () => {
		const folderPath = '/photos/2015-07-15 Levi Birth';
		const folderDate = dt(2015, 7, 15);
		const files = [
			file('/photos/2015-07-15 Levi Birth/a.jpg', dt(2015, 7, 16, 10, 19, 58), folderPath),
			file('/photos/2015-07-15 Levi Birth/b.jpg', dt(2015, 7, 22, 20, 19, 28), folderPath),
		];
		expect(planFolderWarnings(files, [{folderPath, folderDate}])).toEqual([]);
	});

	it('is silent when files agree with the folder date', () => {
		const folderPath = '/photos/2022-06-04 Addams shoot';
		const folderDate = dt(2022, 6, 4);
		const files = [
			file('/photos/2022-06-04 Addams shoot/a.jpg', dt(2022, 6, 4, 14, 0, 0), folderPath),
			file('/photos/2022-06-04 Addams shoot/b.jpg', dt(2022, 6, 4, 15, 30, 0), folderPath),
		];
		expect(planFolderWarnings(files, [{folderPath, folderDate}])).toEqual([]);
	});

	it('warns FOLDER_AFTER_FILES when folder date is after every file metadata date', () => {
		const folderPath = '/photos/2013-09-07 Pumping';
		const folderDate = dt(2013, 9, 7);
		const files = [
			file('/photos/2013-09-07 Pumping/a.jpg', dt(2013, 7, 19, 9, 15, 29), folderPath),
			file('/photos/2013-09-07 Pumping/b.jpg', dt(2013, 8, 16, 20, 56, 12), folderPath),
		];
		const warnings = planFolderWarnings(files, [{folderPath, folderDate}]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({
			kind: 'FOLDER_AFTER_FILES',
			folderPath,
			folderDate,
			earliestFile: dt(2013, 7, 19, 9, 15, 29),
			latestFile: dt(2013, 8, 16, 20, 56, 12),
		});
	});

	it('warns FOLDER_UNIFORM_METADATA when every file shares the same metadata timestamp down to the second', () => {
		const folderPath = '/photos/2020-11-02 Genesis School Photos';
		const folderDate = dt(2020, 11, 2);
		const sharedTimestamp = dt(2020, 10, 29, 14, 45, 0);
		const files = [
			file('/photos/2020-11-02 Genesis School Photos/uuid1.jpg', sharedTimestamp, folderPath),
			file('/photos/2020-11-02 Genesis School Photos/uuid2.jpg', sharedTimestamp, folderPath),
			file('/photos/2020-11-02 Genesis School Photos/uuid3.jpg', sharedTimestamp, folderPath),
		];
		const warnings = planFolderWarnings(files, [{folderPath, folderDate}]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({
			kind: 'FOLDER_UNIFORM_METADATA',
			folderPath,
			folderDate,
			sharedTimestamp,
			fileCount: 3,
		});
	});

	it('prefers FOLDER_UNIFORM_METADATA over FOLDER_AFTER_FILES when both could apply', () => {
		const folderPath = '/photos/2020-11-02 Genesis School Photos';
		const folderDate = dt(2020, 11, 2);
		const sharedTimestamp = dt(2020, 10, 29, 14, 45, 0);
		const files = [
			file('/photos/2020-11-02 Genesis School Photos/uuid1.jpg', sharedTimestamp, folderPath),
			file('/photos/2020-11-02 Genesis School Photos/uuid2.jpg', sharedTimestamp, folderPath),
		];
		const warnings = planFolderWarnings(files, [{folderPath, folderDate}]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.kind).toBe('FOLDER_UNIFORM_METADATA');
	});

	it('does not flag uniform metadata for a single-file folder (needs at least 2 files to be suspicious)', () => {
		const folderPath = '/photos/2022-06-04 Lone shot';
		const folderDate = dt(2022, 6, 4);
		const sharedTimestamp = dt(2020, 10, 29, 14, 45, 0);
		const files = [file('/photos/2022-06-04 Lone shot/a.jpg', sharedTimestamp, folderPath)];
		const warnings = planFolderWarnings(files, [{folderPath, folderDate}]);
		expect(warnings.find((w) => w.kind === 'FOLDER_UNIFORM_METADATA')).toBeUndefined();
	});

	it('produces independent warnings per folder', () => {
		const pumping = '/photos/2013-09-07 Pumping';
		const genesis = '/photos/2020-11-02 Genesis';
		const genesisShared = dt(2020, 10, 29, 14, 45, 0);
		const files = [
			file('/photos/2013-09-07 Pumping/a.jpg', dt(2013, 7, 19, 9, 0, 0), pumping),
			file('/photos/2020-11-02 Genesis/x.jpg', genesisShared, genesis),
			file('/photos/2020-11-02 Genesis/y.jpg', genesisShared, genesis),
		];
		const folders = [
			{folderPath: pumping, folderDate: dt(2013, 9, 7)},
			{folderPath: genesis, folderDate: dt(2020, 11, 2)},
		];
		const warnings = planFolderWarnings(files, folders);
		expect(warnings.map((w) => w.kind).sort()).toEqual(['FOLDER_AFTER_FILES', 'FOLDER_UNIFORM_METADATA']);
	});
});
