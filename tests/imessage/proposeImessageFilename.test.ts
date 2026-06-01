import {describe, expect, it} from 'vitest';
import type {DateParts} from '../../src/dateParts.ts';
import {proposeImessageFilename} from '../../src/imessage/proposeImessageFilename.ts';

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

const dateTimeMs = (
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	second: number,
	millisecond: number,
): DateParts => ({
	year,
	month,
	day,
	time: {hour, minute, second, millisecond},
});

describe('proposeImessageFilename', () => {
	it('drops iMessage UUID-style stems and emits date, sender → recipient, camera', () => {
		expect(
			proposeImessageFilename({
				originalName: '75626143906__7DDACC18-1480-46CB-91EA-51B325B6E7DA.heic',
				date: dateTime(2024, 12, 18, 19, 37, 29),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: 'iPhone 13 Pro back 24mm',
			}),
		).toBe('2024-12-18 19.37.29 (Vika → Craig) (iPhone 13 Pro back 24mm).heic');
	});

	it('drops the literal FullSizeRender stem', () => {
		expect(
			proposeImessageFilename({
				originalName: 'FullSizeRender.heic',
				date: dateTime(2024, 12, 15, 12, 36, 42),
				senderName: '+16315237124',
				recipient: 'Craig',
				cameraSuffix: 'iPhone 8 back 94mm',
			}),
		).toBe('2024-12-15 12.36.42 (+16315237124 → Craig) (iPhone 8 back 94mm).heic');
	});

	it('shortens a macOS Screenshot stem with a narrow no-break space before PM', () => {
		expect(
			proposeImessageFilename({
				originalName: 'Screenshot 2025-01-13 at 4.43.28 PM.jpeg',
				date: dateTime(2025, 1, 13, 16, 44, 38),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2025-01-13 16.44.38 (Vika → Craig) Screenshot.jpeg');
	});

	it('shortens a macOS Screenshot stem with a regular ASCII space before PM', () => {
		expect(
			proposeImessageFilename({
				originalName: 'Screenshot 2025-01-13 at 4.43.28 PM.jpeg',
				date: dateTime(2025, 1, 13, 16, 44, 38),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2025-01-13 16.44.38 (Vika → Craig) Screenshot.jpeg');
	});

	it('strips the iMessage-slash-stripped URL prefix and keeps the rest', () => {
		expect(
			proposeImessageFilename({
				originalName: 'httpswww.dolcevita.comproductsfernly-boots-dune-suede.jpeg',
				date: dateTime(2025, 1, 9, 17, 50, 46),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2025-01-09 17.50.46 (Vika → Craig) dolcevita.comproductsfernly-boots-dune-suede.jpeg');
	});

	it('drops a camera-firmware stem and emits sender → group recipient and camera with sub-second precision', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_3606.HEIC',
				date: dateTimeMs(2025, 1, 1, 15, 22, 55, 835),
				senderName: 'Lindsay',
				recipient: 'Motlins',
				cameraSuffix: 'iPhone 15 Pro back 24mm',
			}),
		).toBe('2025-01-01 15.22.55.835 (Lindsay → Motlins) (iPhone 15 Pro back 24mm).HEIC');
	});

	it('emits a (sender → group) bracket for outgoing-to-group with the sender as the current user', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.jpg',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: 'Craig',
				recipient: 'Motlins',
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00 (Craig → Motlins).jpg');
	});

	it('emits an incoming-DM bracket (sender → current user)', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.jpg',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00 (Vika → Craig).jpg');
	});

	it('emits an outgoing-DM bracket (current user → partner)', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.jpg',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: 'Craig',
				recipient: 'Vika',
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00 (Craig → Vika).jpg');
	});

	it('falls back to sender-only when recipient is null (rare outgoing-to-group with unknown title)', () => {
		expect(
			proposeImessageFilename({
				originalName: '67797364692__EC814E2D-21CF-4F84-96D4-BC620A849A81.heic',
				date: dateTimeMs(2022, 6, 26, 18, 0, 46, 900),
				senderName: 'Craig',
				recipient: null,
				cameraSuffix: 'iPhone 13 Pro front 23mm',
			}),
		).toBe('2022-06-26 18.00.46.900 (Craig) (iPhone 13 Pro front 23mm).heic');
	});

	it('falls back to recipient-only when senderName is null', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.heic',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: null,
				recipient: 'Motlins',
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00 (Motlins).heic');
	});

	it('omits the sender/recipient bracket when both are null', () => {
		expect(
			proposeImessageFilename({
				originalName: 'FullSizeRender.heic',
				date: dateTime(2024, 1, 2, 3, 4, 5),
				senderName: null,
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-01-02 03.04.05.heic');
	});

	it('preserves a human-typed stem verbatim', () => {
		expect(
			proposeImessageFilename({
				originalName: 'birthday cake closeup.jpg',
				date: dateTime(2024, 3, 14, 9, 15, 30),
				senderName: 'Mom',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2024-03-14 09.15.30 (Mom → Craig) birthday cake closeup.jpg');
	});

	it('strips a leading date already present in the original name', () => {
		expect(
			proposeImessageFilename({
				originalName: '2020-01-01 hello.jpg',
				date: dateTime(2024, 5, 6, 7, 8, 9),
				senderName: null,
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-05-06 07.08.09 hello.jpg');
	});

	it('drops a plain UUID stem with no numeric prefix', () => {
		expect(
			proposeImessageFilename({
				originalName: '7DDACC18-1480-46CB-91EA-51B325B6E7DA.heic',
				date: dateTime(2024, 12, 18, 19, 37, 29),
				senderName: 'Vika',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2024-12-18 19.37.29 (Vika → Craig).heic');
	});

	it('drops the literal image stem', () => {
		expect(
			proposeImessageFilename({
				originalName: 'image.png',
				date: dateTime(2024, 7, 8, 12, 0, 0),
				senderName: 'Alex',
				recipient: 'Craig',
				cameraSuffix: null,
			}),
		).toBe('2024-07-08 12.00.00 (Alex → Craig).png');
	});

	it('drops the literal video and Attachment stems', () => {
		expect(
			proposeImessageFilename({
				originalName: 'video.mp4',
				date: dateTime(2024, 7, 8, 12, 0, 0),
				senderName: null,
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-07-08 12.00.00.mp4');
		expect(
			proposeImessageFilename({
				originalName: 'Attachment.heic',
				date: dateTime(2024, 7, 8, 12, 0, 0),
				senderName: null,
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-07-08 12.00.00.heic');
	});

	it('preserves the .jpeg extension exactly', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1234.jpeg',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: null,
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00.jpeg');
	});

	it('treats empty-string sender and recipient as omitted slots', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.heic',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: '',
				recipient: '',
				cameraSuffix: '',
			}),
		).toBe('2024-05-01 10.00.00.heic');
	});

	it('sanitizes slashes that sneak into slot values', () => {
		expect(
			proposeImessageFilename({
				originalName: 'IMG_1.heic',
				date: dateTime(2024, 5, 1, 10, 0, 0),
				senderName: 'Al/ex',
				recipient: null,
				cameraSuffix: null,
			}),
		).toBe('2024-05-01 10.00.00 (Alex).heic');
	});
});
