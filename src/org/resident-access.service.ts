// Which residents the caller may see or change (PA-01a, PA-03). A resident belongs to one facility;
// while "transferring" the receiving facility may also act, because it must accept the transfer
// (SPEC-011 §3.1). Residents of another organisation are reported as not found.
import { Injectable } from '@nestjs/common';
import { type Action, type Id, canInFacility } from '@carekind/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { StaffPrincipal } from '../auth/principal.js';
import { forbidden, notFound } from '../common/api-error.js';
import type { DbExecutor } from '../db/database.js';
import { residentEvents, residents } from '../db/schema.js';
import type { ResidentRow } from './org-mappers.js';

// The destination named by the latest transfer_out, while the resident is still transferring.
export async function pendingTransferDestination(
	executor: DbExecutor,
	resident: ResidentRow,
): Promise<Id | null> {
	if (resident.status !== 'transferring') {
		return null;
	}
	const [latest] = await executor
		.select({ toFacilityId: residentEvents.toFacilityId })
		.from(residentEvents)
		.where(and(eq(residentEvents.residentId, resident.id), eq(residentEvents.type, 'transfer_out')))
		.orderBy(desc(residentEvents.createdAt))
		.limit(1);
	return latest?.toFacilityId ?? null;
}

@Injectable()
export class ResidentAccessService {
	async find(actor: StaffPrincipal, residentId: Id, executor: DbExecutor): Promise<ResidentRow> {
		const [row] = await executor
			.select()
			.from(residents)
			.where(
				and(eq(residents.id, residentId), eq(residents.organisationId, actor.organisationId)),
			);
		if (row === undefined) {
			throw notFound('Resident');
		}
		return row;
	}

	async forAction(
		actor: StaffPrincipal,
		residentId: Id,
		action: Action,
		executor: DbExecutor,
	): Promise<ResidentRow> {
		const resident = await this.find(actor, residentId, executor);
		if (canInFacility(actor, resident.facilityId, action)) {
			return resident;
		}
		const destination = await pendingTransferDestination(executor, resident);
		if (destination !== null && canInFacility(actor, destination, action)) {
			return resident;
		}
		throw forbidden();
	}
}
