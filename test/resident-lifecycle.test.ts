// SPEC-011 §3.1 resident lifecycle and SPEC-009 consent reset on transfer. Synthetic data only.
import { type ResidentEventType } from '@carekind/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, expectApiError, requireKey, startTestApi } from './helpers.js';

let api: TestApi;
let orgA: TestApi['seed']['organisations']['orgA'];
let admin: ReturnType<TestApi['client']>;

const now = (): string => new Date().toISOString();

async function event(residentId: string, type: ResidentEventType, toFacilityId?: string) {
	return admin.org.recordResidentEvent(residentId, { type, occurredAt: now(), toFacilityId });
}

beforeAll(async () => {
	api = await startTestApi();
	orgA = api.seed.organisations.orgA;
	admin = api.client(await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'));
});

afterAll(async () => {
	await api.close();
});

describe('resident lifecycle', () => {
	it('should_follow_the_full_lifecycle_and_keep_history', async () => {
		const nsw1 = requireKey(orgA.facilityIds, 'nsw1');
		const created = await admin.org.createResident(nsw1, {
			givenName: 'Synthetic',
			familyName: 'Lifecycle',
		});
		expect(created.status).toBe('pre_admission');
		const steps: [ResidentEventType, string][] = [
			['admit', 'in_residence'],
			['temporary_leave', 'temporary_leave'],
			['return', 'in_residence'],
			['depart', 'departed'],
			['archive', 'archived'],
		];
		for (const [type, expected] of steps) {
			const result = await event(created.id, type);
			expect(result.resident.status).toBe(expected);
			expect(result.consentReset).toBe(false);
		}
		const detail = await admin.org.getResident(created.id);
		expect(detail.events.map((item) => item.type)).toEqual(steps.map(([type]) => type));
	});

	it('should_reject_an_invalid_transition', async () => {
		const residentId = requireKey(orgA.residentIds, 'nsw1-3');
		await expectApiError(event(residentId, 'archive'), 'invalid_transition');
		await expectApiError(event(residentId, 'return'), 'invalid_transition');
		const detail = await admin.org.getResident(residentId);
		expect(detail.status).toBe('in_residence');
	});

	it('should_allow_death_while_on_temporary_leave', async () => {
		const result = await event(requireKey(orgA.residentIds, 'onLeave'), 'death');
		expect(result.resident.status).toBe('deceased');
	});

	it('should_keep_archived_records_read_only', async () => {
		const residentId = requireKey(orgA.residentIds, 'departed');
		await event(residentId, 'archive');
		await expectApiError(admin.org.updateResident(residentId, { room: 'X1' }), 'conflict');
		await expectApiError(
			admin.org.updateConsent(residentId, {
				status: 'withdrawn',
				source: 'self',
				jurisdiction: 'NSW',
			}),
			'conflict',
		);
	});

	it('should_require_toFacilityId_only_for_transfer_out', async () => {
		const residentId = requireKey(orgA.residentIds, 'nsw1-4');
		const response = await api.raw('POST', `/org/residents/${residentId}/events`, {
			token: await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'),
			json: { type: 'transfer_out', occurredAt: now() },
		});
		expect(response.status).toBe(400);
		await expectApiError(
			event(residentId, 'transfer_out', requireKey(orgA.facilityIds, 'nsw1')),
			'validation_failed',
		);
	});
});

describe('transfers', () => {
	it('should_let_the_receiving_facility_accept_and_reset_consent_across_states', async () => {
		const residentId = requireKey(orgA.residentIds, 'vic-1');
		const nsw1 = requireKey(orgA.facilityIds, 'nsw1');
		await admin.org.updateConsent(residentId, {
			status: 'consented',
			source: 'self',
			jurisdiction: 'VIC',
		});
		const out = await event(residentId, 'transfer_out', nsw1);
		expect(out.resident.status).toBe('transferring');
		expect(out.event.toFacilityId).toBe(nsw1);

		// The NSW 1 manager has no VIC access but sees the incoming resident and accepts it.
		const manager = api.client(
			await api.login(requireKey(orgA.emails, 'facilityManager'), 'org'),
		);
		const incoming = await manager.org.listResidents(nsw1);
		expect(incoming.some((resident) => resident.id === residentId)).toBe(true);
		const accepted = await manager.org.recordResidentEvent(residentId, {
			type: 'transfer_accept',
			occurredAt: now(),
		});
		expect(accepted.resident.status).toBe('in_residence');
		expect(accepted.resident.facilityId).toBe(nsw1);
		expect(accepted.resident.room).toBeNull();
		expect(accepted.consentReset).toBe(true);
		expect(accepted.crossStateTransfer).toBe(true);
		const consent = await manager.org.getConsent(residentId);
		expect(consent.status).toBe('unknown');
		expect(consent.source).toBeNull();
	});

	it('should_report_same_state_transfers_as_not_cross_state', async () => {
		const residentId = requireKey(orgA.residentIds, 'transferPending');
		const result = await event(residentId, 'transfer_accept');
		expect(result.resident.facilityId).toBe(requireKey(orgA.facilityIds, 'nsw2'));
		expect(result.consentReset).toBe(true);
		expect(result.crossStateTransfer).toBe(false);
	});

	it('should_not_let_the_sending_facility_accept_its_own_transfer', async () => {
		const residentId = requireKey(orgA.residentIds, 'nsw1-5');
		await event(residentId, 'transfer_out', requireKey(orgA.facilityIds, 'vic'));
		const manager = api.client(
			await api.login(requireKey(orgA.emails, 'facilityManager'), 'org'),
		);
		await expectApiError(
			manager.org.recordResidentEvent(residentId, {
				type: 'transfer_accept',
				occurredAt: now(),
			}),
			'forbidden',
		);
	});
});

describe('consent', () => {
	it('should_default_to_unknown_without_a_record', async () => {
		const residentId = requireKey(orgA.residentIds, 'preAdmission');
		const consent = await admin.org.getConsent(residentId);
		expect(consent).toMatchObject({ status: 'unknown', source: null, recordedBy: null });
	});

	it('should_not_accept_unknown_as_a_recorded_decision', async () => {
		const residentId = requireKey(orgA.residentIds, 'nsw1-6');
		const response = await api.raw('PUT', `/org/residents/${residentId}/consent`, {
			token: await api.login(requireKey(orgA.emails, 'orgAdmin'), 'org'),
			json: { status: 'unknown', source: 'self', jurisdiction: 'NSW' },
		});
		expect(response.status).toBe(400);
	});

	it('should_record_a_decision_with_source_and_recorder', async () => {
		const residentId = requireKey(orgA.residentIds, 'nsw1-6');
		const consent = await admin.org.updateConsent(residentId, {
			status: 'withdrawn',
			source: 'substitute_decision_maker',
			jurisdiction: 'NSW',
			basisNote: 'Synthetic note',
		});
		expect(consent.status).toBe('withdrawn');
		expect(consent.recordedBy).toBe(requireKey(orgA.staffIds, 'orgAdmin'));
	});
});

describe('overview', () => {
	it('should_report_facility_level_counts_only', async () => {
		const overview = await admin.org.getOverview();
		for (const row of overview) {
			expect(Object.keys(row).sort()).toEqual(
				[
					'appEnabledStaffCount',
					'consentCoverage',
					'credentialsDueWithin60Days',
					'currentStaffCount',
					'facilityId',
					'facilityName',
					'pendingAttributionRatio',
					'pendingReviewCount',
					'recordTimeliness',
					'residentsConsented',
					'residentsInResidence',
					'state',
					'status',
				].sort(),
			);
			expect(row.pendingReviewCount).toEqual({ value: null, reason: 'nurse_app_not_live' });
		}
		const nsw1 = overview.find(
			(row) => row.facilityId === requireKey(orgA.facilityIds, 'nsw1'),
		);
		// RN AHPRA in 20 days, RN screening in 45 days, EN AHPRA expired (synthetic seed).
		expect(nsw1?.credentialsDueWithin60Days).toBe(3);
	});
});
