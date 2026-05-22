import {describe, expect, it} from 'vitest';
import {folderDateFor} from '../src/audit.ts';

describe('folderDateFor', () => {
	it('finds the date of the nearest dated ancestor folder', () => {
		expect(folderDateFor('/photos/2019/2019-01-01 Party/IMG_1.jpg', '/photos')).toEqual({
			year: 2019,
			month: 1,
			day: 1,
			time: null,
		});
	});

	it('returns null when no ancestor folder is dated', () => {
		expect(folderDateFor('/photos/Image Capture/IMG_4309.jpg', '/photos')).toBeNull();
	});

	it('does not look above the root', () => {
		expect(
			folderDateFor('/photos/2019-01-01 Party/undated/IMG.jpg', '/photos/2019-01-01 Party/undated'),
		).toBeNull();
	});
});
