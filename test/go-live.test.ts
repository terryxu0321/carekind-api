// SPEC-011 PA-05 go-live gate: every item complete, and in NSW written staff notice at least
// 14 days before activation. Synthetic data only.
import { GOLIVE_ITEM_KEYS, type AustralianState, addDays } from '@carekind/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { todayIn } from '../src/common/dates.js';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

let api: TestApi;
let admin: ReturnType<TestApi['client']>;

async function newFacility(state: AustralianState, timezone: string): Promise<string> {
	const facility = await admin.org.createFacility({
		name: `Synthetic Go-Live ${state}`,
		address: '5 Example Street, Sydney NSW 2000',
		state,
		beds: 20,
		timezone,
	});
	expect(facility.status).toBe('configuring');
	return facility.id;
}

async function completeAll(facilityId: string, noticeSentOn: string): Promise<void> {
	for (const key of GOLIVE_ITEM_KEYS) {
		await admin.org.updateGoLiveItem(facilityId, key, {
			completed: true,
			noticeSentOn: key === 'staff_notice_sent' ? noticeSentOn : undefined,
		});
	}
}

beforeAll(async () => {
	api = await startTestApi();
	admin = api.client(
		await api.login(requireKey(api.seed.organisations.orgA.emails, 'orgAdmin'), 'org'),
	);
});

afterAll(async () => {
	await api.close();
});

describe('go-live gate', () => {
	it('should_block_activation_until_every_item_is_complete', async () => {
		const facilityId = await newFacility('NSW', 'Australia/Sydney');
		const status = await admin.org.getGoLive(facilityId);
		expect(status.items).toHaveLength(GOLIVE_ITEM_KEYS.length);
		expect(status.canActivate).toBe(false);
		await expectApiError(admin.org.activateFacility(facilityId), 'go_live_incomplete');
	});

	it('should_enforce_the_nsw_14_day_staff_notice', async () => {
		const facilityId = await newFacility('NSW', 'Australia/Sydney');
		const today = todayIn('Australia/Sydney');
		await completeAll(facilityId, addDays(today, -13));
		const blocked = await admin.org.getGoLive(facilityId);
		expect(blocked.canActivate).toBe(false);
		expect(blocked.blockers).toEqual([
			{ kind: 'notice_period_not_met', earliestActivationDate: addDays(today, 1) },
		]);
		await expectApiError(admin.org.activateFacility(facilityId), 'go_live_incomplete');

		await admin.org.updateGoLiveItem(facilityId, 'staff_notice_sent', {
			completed: true,
			noticeSentOn: addDays(today, -14),
		});
		const live = await admin.org.activateFacility(facilityId);
		expect(live.status).toBe('live');
		await expectApiError(admin.org.activateFacility(facilityId), 'conflict');
	});

	it('should_only_record_the_notice_date_outside_nsw', async () => {
		const facilityId = await newFacility('VIC', 'Australia/Melbourne');
		await completeAll(facilityId, todayIn('Australia/Melbourne'));
		const live = await admin.org.activateFacility(facilityId);
		expect(live.status).toBe('live');
	});

	it('should_require_the_notice_date_on_staff_notice_sent', async () => {
		const facilityId = requireKey(api.seed.organisations.orgA.facilityIds, 'vic');
		await expectApiError(
			admin.org.updateGoLiveItem(facilityId, 'staff_notice_sent', { completed: true }),
			'validation_failed',
		);
		await expectApiError(
			admin.org.updateGoLiveItem(facilityId, 'contract_signed', {
				completed: true,
				noticeSentOn: todayIn('Australia/Melbourne'),
			}),
			'validation_failed',
		);
	});

	it('should_keep_go_live_away_from_don_and_admin_officer', async () => {
		const orgA = api.seed.organisations.orgA;
		const don = api.client(await api.login(requireKey(orgA.emails, 'don'), 'org'));
		await expectApiError(
			don.org.activateFacility(requireKey(orgA.facilityIds, 'nsw2')),
			'forbidden',
		);
	});
});
