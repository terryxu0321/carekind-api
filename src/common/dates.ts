import type { IsoDate, IsoDateTime } from '@carekind/shared';

// Credential reminders are not tied to one facility, so CareKind's home time zone is used.
export const DEFAULT_TIME_ZONE = 'Australia/Sydney';

// "Today" as a calendar date in the facility's own time zone (NSW notice days, credential expiry).
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
	// en-CA formats dates as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function toIso(value: Date): IsoDateTime {
	return value.toISOString();
}

export function toIsoOrNull(value: Date | null): IsoDateTime | null {
	return value === null ? null : value.toISOString();
}
