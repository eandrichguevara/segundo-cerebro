import { describe, expect, it } from "vitest";
import {
	EventError,
	EventStatus,
	canTransition,
	generateRecurrenceInstances,
	transitionStatus,
	validateCreateEvent,
	validateRecurrenceRule,
} from "./event.js";

describe("event state machine", () => {
	it("should allow active -> completed", () => {
		expect(canTransition(EventStatus.ACTIVE, EventStatus.COMPLETED)).toBe(true);
	});

	it("should allow active -> cancelled", () => {
		expect(canTransition(EventStatus.ACTIVE, EventStatus.CANCELLED)).toBe(true);
	});

	it("should not allow completed -> anything", () => {
		expect(canTransition(EventStatus.COMPLETED, EventStatus.ACTIVE)).toBe(
			false,
		);
		expect(canTransition(EventStatus.COMPLETED, EventStatus.CANCELLED)).toBe(
			false,
		);
	});

	it("should not allow cancelled -> anything", () => {
		expect(canTransition(EventStatus.CANCELLED, EventStatus.ACTIVE)).toBe(
			false,
		);
		expect(canTransition(EventStatus.CANCELLED, EventStatus.COMPLETED)).toBe(
			false,
		);
	});

	it("should return error for invalid transition", () => {
		const result = transitionStatus(EventStatus.COMPLETED, EventStatus.ACTIVE);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(EventError.INVALID_STATE_TRANSITION);
		}
	});

	it("should succeed for valid transition", () => {
		const result = transitionStatus(EventStatus.ACTIVE, EventStatus.COMPLETED);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(EventStatus.COMPLETED);
		}
	});
});

describe("validateCreateEvent", () => {
	it("should require title", () => {
		const result = validateCreateEvent({
			title: "",
			startTime: "2026-06-01T10:00:00Z",
		});
		expect(result.ok).toBe(false);
	});

	it("should require startTime", () => {
		const result = validateCreateEvent({
			title: "Reunión",
			startTime: "",
		});
		expect(result.ok).toBe(false);
	});

	it("should pass with valid data", () => {
		const result = validateCreateEvent({
			title: "Reunión",
			startTime: "2026-06-01T10:00:00Z",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.title).toBe("Reunión");
			expect(result.value.startTime).toBe("2026-06-01T10:00:00Z");
		}
	});
});

describe("validateRecurrenceRule", () => {
	it("should reject null", () => {
		const result = validateRecurrenceRule(null);
		expect(result.ok).toBe(false);
	});

	it("should reject missing frequency", () => {
		const result = validateRecurrenceRule({ interval: 1 });
		expect(result.ok).toBe(false);
	});

	it("should reject invalid frequency", () => {
		const result = validateRecurrenceRule({
			frequency: "bimonthly",
			interval: 1,
		});
		expect(result.ok).toBe(false);
	});

	it("should accept valid weekly rule", () => {
		const result = validateRecurrenceRule({
			frequency: "weekly",
			interval: 1,
			daysOfWeek: [1, 3, 5],
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.frequency).toBe("weekly");
			expect(result.value.interval).toBe(1);
			expect(result.value.daysOfWeek).toEqual([1, 3, 5]);
		}
	});

	it("should default interval to 1", () => {
		const result = validateRecurrenceRule({ frequency: "daily" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.interval).toBe(1);
		}
	});

	it("should accept rule with endDate", () => {
		const result = validateRecurrenceRule({
			frequency: "monthly",
			interval: 1,
			dayOfMonth: 15,
			endDate: "2026-12-31T23:59:59Z",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.endDate).toBe("2026-12-31T23:59:59Z");
		}
	});
});

describe("generateRecurrenceInstances", () => {
	it("should generate daily instances", () => {
		const start = new Date("2026-06-01T10:00:00Z");
		const rangeStart = new Date("2026-06-01T00:00:00Z");
		const rangeEnd = new Date("2026-06-05T00:00:00Z");

		const instances = generateRecurrenceInstances(
			{ frequency: "daily", interval: 1 },
			start,
			undefined,
			rangeStart,
			rangeEnd,
		);

		expect(instances.length).toBeGreaterThanOrEqual(4);
	});

	it("should generate weekly instances", () => {
		const start = new Date("2026-06-01T10:00:00Z");
		const rangeStart = new Date("2026-06-01T00:00:00Z");
		const rangeEnd = new Date("2026-06-22T00:00:00Z");

		const instances = generateRecurrenceInstances(
			{ frequency: "weekly", interval: 1 },
			start,
			undefined,
			rangeStart,
			rangeEnd,
		);

		expect(instances.length).toBeGreaterThanOrEqual(3);
	});

	it("should generate monthly instances", () => {
		const start = new Date("2026-01-15T10:00:00Z");
		const rangeStart = new Date("2026-01-01T00:00:00Z");
		const rangeEnd = new Date("2026-06-01T00:00:00Z");

		const instances = generateRecurrenceInstances(
			{ frequency: "monthly", interval: 1, dayOfMonth: 15 },
			start,
			undefined,
			rangeStart,
			rangeEnd,
		);

		expect(instances.length).toBeGreaterThanOrEqual(5);
	});

	it("should respect count limit", () => {
		const start = new Date("2026-01-01T10:00:00Z");
		const rangeStart = new Date("2026-01-01T00:00:00Z");
		const rangeEnd = new Date("2027-12-31T00:00:00Z");

		const instances = generateRecurrenceInstances(
			{ frequency: "daily", interval: 1, count: 5 },
			start,
			undefined,
			rangeStart,
			rangeEnd,
		);

		expect(instances.length).toBe(5);
	});

	it("should include instances within range only", () => {
		const start = new Date("2025-01-01T10:00:00Z");
		const rangeStart = new Date("2026-06-01T00:00:00Z");
		const rangeEnd = new Date("2026-06-10T00:00:00Z");

		const instances = generateRecurrenceInstances(
			{ frequency: "daily", interval: 1, count: 500 },
			start,
			undefined,
			rangeStart,
			rangeEnd,
		);

		for (const inst of instances) {
			expect(inst.start.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
			expect(inst.start.getTime()).toBeLessThanOrEqual(rangeEnd.getTime());
		}
	});
});
