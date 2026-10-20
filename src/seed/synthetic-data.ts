// 合成数据，仅用于开发与测试 (synthetic data, for development and testing only — code-rules CORE-09, P-3).
// Every name, address, ABN, email and registration number below is invented. Emails use the
// reserved example.com domain. Tech design §6: 1 platform admin; 2 organisations (isolation tests);
// organisation A has 3 facilities (NSW × 2, VIC × 1), 12 staff and 30 residents.
import type {
	AustralianState,
	ConsentSource,
	ConsentStatus,
	CredentialKind,
	EmploymentType,
	FacilityRole,
	GoLiveItemKey,
	ResidentEventType,
	ResidentStatus,
	StaffLifecycle,
} from '@carekind/shared';

export type FacilityKey = 'nsw1' | 'nsw2' | 'vic' | 'orgBNsw';

export interface SyntheticFacility {
	key: FacilityKey;
	name: string;
	address: string;
	state: AustralianState;
	beds: number;
	timezone: string;
	isLive: boolean;
	completedItems: GoLiveItemKey[];
	// Days before seeding that written staff notice was given (staff_notice_sent).
	noticeDaysAgo: number | null;
}

export interface SyntheticStaff {
	key: string;
	givenName: string;
	familyName: string;
	position: string;
	employmentType: EmploymentType;
	isOrgAdmin: boolean;
	hasAppAccess: boolean;
	email: string | null;
	lifecycle: StaffLifecycle;
	assignments: { facility: FacilityKey; role: FacilityRole }[];
	credentials: { kind: CredentialKind; reference: string | null; expiresInDays: number | null }[];
}

export interface SyntheticResident {
	key: string;
	facility: FacilityKey;
	givenName: string;
	preferredName: string | null;
	familyName: string;
	room: string | null;
	status: ResidentStatus;
	consent: { status: ConsentStatus; source: ConsentSource | null } | null;
}

export interface SyntheticOrganisation {
	key: 'orgA' | 'orgB';
	name: string;
	abn: string;
	contactName: string;
	contactEmail: string;
	facilities: SyntheticFacility[];
	staff: SyntheticStaff[];
	residents: SyntheticResident[];
}

export const SYNTHETIC_PLATFORM_ADMIN = {
	name: 'Synthetic Platform Admin',
	email: 'platform.admin@example.com',
};

const ALL_ITEMS: GoLiveItemKey[] = [
	'contract_signed',
	'staff_register_imported',
	'resident_register_imported',
	'consent_recorded',
	'staff_notice_sent',
	'training_completed',
	'record_transfer_agreed',
];

const FACILITIES_A: SyntheticFacility[] = [
	{
		key: 'nsw1',
		name: 'Synthetic Gardens (NSW 1)',
		address: '1 Example Street, Sydney NSW 2000',
		state: 'NSW',
		beds: 60,
		timezone: 'Australia/Sydney',
		isLive: true,
		completedItems: ALL_ITEMS,
		noticeDaysAgo: 30,
	},
	{
		key: 'nsw2',
		name: 'Synthetic Grove (NSW 2)',
		address: '2 Example Road, Parramatta NSW 2150',
		state: 'NSW',
		beds: 40,
		timezone: 'Australia/Sydney',
		isLive: false,
		completedItems: ALL_ITEMS.filter((key) => key !== 'training_completed'),
		// Inside the NSW 14-day notice period, so go-live stays blocked (PA-05).
		noticeDaysAgo: 5,
	},
	{
		key: 'vic',
		name: 'Synthetic Bay (VIC)',
		address: '3 Example Avenue, Melbourne VIC 3000',
		state: 'VIC',
		beds: 30,
		timezone: 'Australia/Melbourne',
		isLive: false,
		completedItems: [],
		noticeDaysAgo: null,
	},
];

function member(
	key: string,
	name: [string, string],
	position: string,
	details: Partial<Omit<SyntheticStaff, 'key' | 'givenName' | 'familyName' | 'position'>>,
): SyntheticStaff {
	return {
		key,
		givenName: name[0],
		familyName: name[1],
		position,
		employmentType: 'full_time',
		isOrgAdmin: false,
		hasAppAccess: false,
		email: null,
		lifecycle: 'recorded',
		assignments: [],
		credentials: [],
		...details,
	};
}

const STAFF_A: SyntheticStaff[] = [
	member('orgAdmin', ['Avery', 'Sample'], 'Operations Director', {
		isOrgAdmin: true,
		email: 'org-a.admin@example.com',
		lifecycle: 'active',
	}),
	member('facilityManager', ['Blake', 'Mockton'], 'Facility Manager', {
		email: 'org-a.manager@example.com',
		lifecycle: 'active',
		assignments: [{ facility: 'nsw1', role: 'facility_manager' }],
	}),
	// Multi-facility: DON at NSW 1, RN shifts at NSW 2.
	member('don', ['Casey', 'Testwell'], 'Director of Nursing', {
		hasAppAccess: true,
		email: 'org-a.don@example.com',
		lifecycle: 'active',
		assignments: [
			{ facility: 'nsw1', role: 'don' },
			{ facility: 'nsw2', role: 'rn' },
		],
		credentials: [
			{ kind: 'ahpra_registration', reference: 'NMW0000000001', expiresInDays: 400 },
		],
	}),
	member('adminOfficer', ['Devon', 'Fakeley'], 'Quality Officer', {
		employmentType: 'part_time',
		email: 'org-a.officer@example.com',
		lifecycle: 'active',
		assignments: [{ facility: 'vic', role: 'admin_officer' }],
	}),
	member('vicManager', ['Emery', 'Dummett'], 'Facility Manager', {
		email: 'org-a.vic-manager@example.com',
		lifecycle: 'invited',
		assignments: [{ facility: 'vic', role: 'facility_manager' }],
	}),
	member('rn', ['Finley', 'Example'], 'Registered Nurse', {
		hasAppAccess: true,
		email: 'org-a.rn1@example.com',
		lifecycle: 'active',
		assignments: [{ facility: 'nsw1', role: 'rn' }],
		credentials: [
			{ kind: 'ahpra_registration', reference: 'NMW0000000002', expiresInDays: 20 },
			{ kind: 'worker_screening', reference: 'WS-000002', expiresInDays: 45 },
			{ kind: 'carekind_training', reference: null, expiresInDays: null },
		],
	}),
	member('en', ['Harper', 'Synthetic'], 'Enrolled Nurse', {
		employmentType: 'part_time',
		hasAppAccess: true,
		email: 'org-a.en1@example.com',
		lifecycle: 'pending_training',
		assignments: [{ facility: 'nsw1', role: 'en' }],
		credentials: [
			{ kind: 'ahpra_registration', reference: 'NMW0000000003', expiresInDays: -10 },
		],
	}),
	// Multi-facility casual PCW.
	member('pcw', ['Jordan', 'Pretendo'], 'Personal Care Worker', {
		employmentType: 'casual',
		hasAppAccess: true,
		email: 'org-a.pcw1@example.com',
		lifecycle: 'invited',
		assignments: [
			{ facility: 'nsw1', role: 'pcw' },
			{ facility: 'nsw2', role: 'pcw' },
		],
		credentials: [{ kind: 'police_check', reference: 'PC-000004', expiresInDays: 200 }],
	}),
	member('agencyPcw', ['Kai', 'Mockton'], 'Personal Care Worker', {
		employmentType: 'agency',
		hasAppAccess: true,
		email: 'org-a.pcw2@example.com',
		assignments: [{ facility: 'nsw2', role: 'pcw' }],
		credentials: [{ kind: 'worker_screening', reference: 'WS-000005', expiresInDays: 50 }],
	}),
	// No-app staff appear only in the register (tech design §2).
	member('kitchen', ['Logan', 'Sample'], 'Kitchen Hand', {
		employmentType: 'part_time',
		assignments: [{ facility: 'nsw1', role: 'no_app' }],
	}),
	member('cleaner', ['Morgan', 'Testwell'], 'Cleaner', {
		employmentType: 'casual',
		assignments: [
			{ facility: 'nsw2', role: 'no_app' },
			{ facility: 'vic', role: 'no_app' },
		],
	}),
	member('formerPcw', ['Quinn', 'Fakeley'], 'Personal Care Worker', {
		employmentType: 'casual',
		hasAppAccess: true,
		email: 'org-a.pcw3@example.com',
		lifecycle: 'deactivated',
		assignments: [{ facility: 'nsw1', role: 'pcw' }],
	}),
];

const GIVEN_NAMES = [
	'Alice',
	'George',
	'Edith',
	'Harold',
	'Iris',
	'Walter',
	'Joan',
	'Arthur',
	'Beryl',
	'Frank',
	'Gwen',
	'Leonard',
	'Mavis',
	'Norman',
	'Olive',
	'Percy',
	'Rita',
	'Stanley',
	'Thelma',
	'Vera',
	'Wilfred',
	'Doris',
	'Clifford',
	'Hazel',
	'Reginald',
	'Ivy',
	'Bernard',
];
const FAMILY_NAMES = ['Sample', 'Mockton', 'Testwell', 'Fakeley', 'Dummett', 'Pretendo', 'Example'];
const CONSENT_SOURCES: ConsentSource[] = ['self', 'supporter', 'substitute_decision_maker'];

// Consent mix for in-residence residents: mostly recorded, some refused or withdrawn, some unknown.
function consentFor(index: number): SyntheticResident['consent'] {
	if (index % 5 === 3) {
		return null;
	}
	if (index % 7 === 4) {
		return { status: 'not_consented', source: 'substitute_decision_maker' };
	}
	if (index === 9) {
		return { status: 'withdrawn', source: 'self' };
	}
	return { status: 'consented', source: CONSENT_SOURCES[index % 3] ?? 'self' };
}

function regularResidents(
	facility: FacilityKey,
	count: number,
	offset: number,
): SyntheticResident[] {
	return Array.from({ length: count }, (_unused, position) => {
		const index = offset + position;
		return {
			key: `${facility}-${position + 1}`,
			facility,
			givenName: GIVEN_NAMES[index % GIVEN_NAMES.length] ?? 'Alice',
			preferredName: null,
			familyName: FAMILY_NAMES[index % FAMILY_NAMES.length] ?? 'Sample',
			room: `${facility.toUpperCase()}-${String(position + 1).padStart(2, '0')}`,
			status: 'in_residence',
			consent: consentFor(index),
		};
	});
}

// Special cases the admin console must handle (SPEC-011 §9): same name, transfers, departures.
const SPECIAL_RESIDENTS_A: SyntheticResident[] = [
	{
		key: 'sameNameNsw1',
		facility: 'nsw1',
		givenName: 'Mary',
		preferredName: 'Molly',
		familyName: 'Sample',
		room: 'NSW1-20',
		status: 'in_residence',
		consent: { status: 'consented', source: 'self' },
	},
	{
		key: 'sameNameNsw2',
		facility: 'nsw2',
		givenName: 'Mary',
		preferredName: null,
		familyName: 'Sample',
		room: 'NSW2-20',
		status: 'in_residence',
		consent: null,
	},
	{
		key: 'onLeave',
		facility: 'nsw1',
		givenName: 'Ernest',
		preferredName: 'Ernie',
		familyName: 'Dummett',
		room: 'NSW1-21',
		status: 'temporary_leave',
		consent: { status: 'consented', source: 'supporter' },
	},
	{
		key: 'preAdmission',
		facility: 'nsw1',
		givenName: 'Myrtle',
		preferredName: null,
		familyName: 'Example',
		room: null,
		status: 'pre_admission',
		consent: null,
	},
	{
		key: 'transferPending',
		facility: 'nsw1',
		givenName: 'Clara',
		preferredName: null,
		familyName: 'Mockton',
		room: 'NSW1-22',
		status: 'transferring',
		consent: { status: 'consented', source: 'self' },
	},
	{
		key: 'transferredFromVic',
		facility: 'nsw2',
		givenName: 'Henry',
		preferredName: null,
		familyName: 'Fakeley',
		room: null,
		status: 'in_residence',
		consent: { status: 'unknown', source: null },
	},
	{
		key: 'departed',
		facility: 'nsw1',
		givenName: 'Ada',
		preferredName: null,
		familyName: 'Pretendo',
		room: null,
		status: 'departed',
		consent: { status: 'consented', source: 'self' },
	},
	{
		key: 'deceased',
		facility: 'vic',
		givenName: 'Otto',
		preferredName: null,
		familyName: 'Testwell',
		room: null,
		status: 'deceased',
		consent: { status: 'consented', source: 'substitute_decision_maker' },
	},
];

export interface SyntheticResidentEvent {
	resident: string;
	type: ResidentEventType;
	from: FacilityKey;
	to: FacilityKey | null;
	daysAgo: number;
}

// Lifecycle history behind the special residents above (organisation A).
export const SYNTHETIC_RESIDENT_EVENTS_A: SyntheticResidentEvent[] = [
	{ resident: 'onLeave', type: 'temporary_leave', from: 'nsw1', to: null, daysAgo: 2 },
	{ resident: 'transferPending', type: 'transfer_out', from: 'nsw1', to: 'nsw2', daysAgo: 1 },
	// Cross-state transfer VIC → NSW, accepted: consent was reset to unknown.
	{ resident: 'transferredFromVic', type: 'transfer_out', from: 'vic', to: 'nsw2', daysAgo: 12 },
	{
		resident: 'transferredFromVic',
		type: 'transfer_accept',
		from: 'vic',
		to: 'nsw2',
		daysAgo: 10,
	},
	{ resident: 'departed', type: 'depart', from: 'nsw1', to: null, daysAgo: 20 },
	{ resident: 'deceased', type: 'death', from: 'vic', to: null, daysAgo: 15 },
];

export const SYNTHETIC_ORGANISATIONS: SyntheticOrganisation[] = [
	{
		key: 'orgA',
		name: 'Synthetic Care Group A',
		abn: '51000000001',
		contactName: 'Avery Sample',
		contactEmail: 'contact@org-a.example.com',
		facilities: FACILITIES_A,
		staff: STAFF_A,
		residents: [
			...regularResidents('nsw1', 9, 0),
			...regularResidents('nsw2', 8, 9),
			...regularResidents('vic', 5, 17),
			...SPECIAL_RESIDENTS_A,
		],
	},
	{
		key: 'orgB',
		name: 'Synthetic Care Group B',
		abn: '51000000002',
		contactName: 'Rowan Example',
		contactEmail: 'contact@org-b.example.com',
		facilities: [
			{
				key: 'orgBNsw',
				name: 'Synthetic Heights (Org B, NSW)',
				address: '9 Example Lane, Newcastle NSW 2300',
				state: 'NSW',
				beds: 25,
				timezone: 'Australia/Sydney',
				isLive: false,
				completedItems: [],
				noticeDaysAgo: null,
			},
		],
		staff: [
			member('orgAdmin', ['Rowan', 'Example'], 'Chief Executive', {
				isOrgAdmin: true,
				email: 'org-b.admin@example.com',
				lifecycle: 'active',
			}),
			member('facilityManager', ['Sasha', 'Mockton'], 'Facility Manager', {
				email: 'org-b.manager@example.com',
				lifecycle: 'active',
				assignments: [{ facility: 'orgBNsw', role: 'facility_manager' }],
			}),
		],
		residents: regularResidents('orgBNsw', 3, 22),
	},
];
