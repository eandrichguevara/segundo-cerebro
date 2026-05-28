import { type Result, err, ok } from "../types/result.js";

export enum EventStatus {
	ACTIVE = "active",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
}

export enum EventError {
	NOT_FOUND = "EVENT_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
	INVALID_RECURRENCE_RULE = "INVALID_RECURRENCE_RULE",
	EXCEPTION_DATE_MISMATCH = "EXCEPTION_DATE_MISMATCH",
	PARENT_NOT_RECURRING = "PARENT_NOT_RECURRING",
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type RecurrenceRule = {
	frequency: RecurrenceFrequency;
	interval: number;
	daysOfWeek?: number[];
	dayOfMonth?: number;
	monthOfYear?: number;
	endDate?: string;
	count?: number;
};

const VALID_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
	[EventStatus.ACTIVE]: [EventStatus.COMPLETED, EventStatus.CANCELLED],
	[EventStatus.COMPLETED]: [],
	[EventStatus.CANCELLED]: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: EventStatus,
	target: EventStatus,
): Result<EventStatus, EventError> {
	if (!canTransition(current, target)) {
		return err(EventError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}

export function validateCreateEvent(payload: {
	title?: string;
	startTime?: string;
}): Result<{ title: string; startTime: string }, EventError> {
	if (!payload.title || payload.title.trim().length === 0) {
		return err(EventError.MISSING_REQUIRED_FIELD);
	}
	if (!payload.startTime) {
		return err(EventError.MISSING_REQUIRED_FIELD);
	}
	return ok({
		title: payload.title.trim(),
		startTime: payload.startTime,
	});
}

const VALID_FREQUENCIES = new Set<string>([
	"daily",
	"weekly",
	"monthly",
	"yearly",
]);

export function validateRecurrenceRule(
	rule: unknown,
): Result<RecurrenceRule, EventError> {
	if (typeof rule !== "object" || rule === null) {
		return err(EventError.INVALID_RECURRENCE_RULE);
	}
	const r = rule as Record<string, unknown>;

	if (!r.frequency || typeof r.frequency !== "string") {
		return err(EventError.INVALID_RECURRENCE_RULE);
	}
	if (!VALID_FREQUENCIES.has(r.frequency)) {
		return err(EventError.INVALID_RECURRENCE_RULE);
	}

	const interval = typeof r.interval === "number" ? r.interval : 1;
	if (interval < 1) {
		return err(EventError.INVALID_RECURRENCE_RULE);
	}

	const validated: RecurrenceRule = {
		frequency: r.frequency as RecurrenceFrequency,
		interval,
	};

	if (Array.isArray(r.daysOfWeek)) {
		validated.daysOfWeek = r.daysOfWeek.filter(
			(d): d is number => typeof d === "number" && d >= 0 && d <= 6,
		);
	}
	if (typeof r.dayOfMonth === "number") {
		validated.dayOfMonth = r.dayOfMonth;
	}
	if (typeof r.monthOfYear === "number") {
		validated.monthOfYear = r.monthOfYear;
	}
	if (typeof r.endDate === "string") {
		validated.endDate = r.endDate;
	}
	if (typeof r.count === "number") {
		validated.count = r.count;
	}

	return ok(validated);
}

export function generateRecurrenceInstances(
	rule: RecurrenceRule,
	startTime: Date,
	endTime: Date | undefined,
	rangeStart: Date,
	rangeEnd: Date,
): Array<{ start: Date; end: Date | undefined }> {
	const instances: Array<{ start: Date; end: Date | undefined }> = [];
	let current = new Date(startTime);
	const durationMs = endTime
		? endTime.getTime() - startTime.getTime()
		: undefined;
	let count = 0;
	const maxCount = rule.count ?? 365;
	const ruleEndDate = rule.endDate ? new Date(rule.endDate) : undefined;

	while (current <= rangeEnd && count < maxCount) {
		if (ruleEndDate && current > ruleEndDate) break;

		if (current >= rangeStart) {
			const instanceEnd = durationMs
				? new Date(current.getTime() + durationMs)
				: undefined;
			instances.push({ start: new Date(current), end: instanceEnd });
		}

		count++;

		switch (rule.frequency) {
			case "daily":
				current.setDate(current.getDate() + rule.interval);
				break;

			case "weekly": {
				const dayOfWeek = current.getDay();
				const days = rule.daysOfWeek ?? [];

				if (days.length > 0) {
					const sortedDays = [...days].sort((a, b) => a - b);
					const currentDayIndex = sortedDays.indexOf(dayOfWeek);
					const nextDay = sortedDays[currentDayIndex + 1];
					if (nextDay !== undefined) {
						current.setDate(
							current.getDate() + (nextDay - dayOfWeek),
						);
				} else {
					const firstDay = sortedDays[0] ?? 0;
					const nextWeekOffset =
						7 - dayOfWeek + firstDay + 7 * (rule.interval - 1);
					current.setDate(current.getDate() + nextWeekOffset);
				}
				} else {
					current.setDate(current.getDate() + 7 * rule.interval);
				}
				break;
			}

			case "monthly": {
				const day = rule.dayOfMonth ?? current.getDate();
				current.setMonth(current.getMonth() + rule.interval);
				current.setDate(Math.min(day, daysInMonth(current)));
				break;
			}

			case "yearly":
				current.setFullYear(current.getFullYear() + rule.interval);
				break;
		}
	}

	return instances;
}

function daysInMonth(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function isRecurrenceRule(value: unknown): value is RecurrenceRule {
	const result = validateRecurrenceRule(value);
	return result.ok;
}
