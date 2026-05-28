import { describe, expect, it } from "vitest";
import {
	TaskError,
	TaskStatus,
	canTransition,
	transitionStatus,
} from "./task.js";

describe("canTransition", () => {
	it("permite PENDING -> IN_PROGRESS", () => {
		expect(canTransition(TaskStatus.PENDING, TaskStatus.IN_PROGRESS)).toBe(
			true,
		);
	});

	it("permite PENDING -> POSTPONED", () => {
		expect(canTransition(TaskStatus.PENDING, TaskStatus.POSTPONED)).toBe(true);
	});

	it("permite PENDING -> CANCELLED", () => {
		expect(canTransition(TaskStatus.PENDING, TaskStatus.CANCELLED)).toBe(true);
	});

	it("rechaza PENDING -> COMPLETED", () => {
		expect(canTransition(TaskStatus.PENDING, TaskStatus.COMPLETED)).toBe(false);
	});

	it("permite IN_PROGRESS -> COMPLETED", () => {
		expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.COMPLETED)).toBe(
			true,
		);
	});

	it("permite IN_PROGRESS -> POSTPONED", () => {
		expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.POSTPONED)).toBe(
			true,
		);
	});

	it("permite IN_PROGRESS -> CANCELLED", () => {
		expect(canTransition(TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED)).toBe(
			true,
		);
	});

	it("permite POSTPONED -> PENDING", () => {
		expect(canTransition(TaskStatus.POSTPONED, TaskStatus.PENDING)).toBe(true);
	});

	it("permite POSTPONED -> IN_PROGRESS", () => {
		expect(canTransition(TaskStatus.POSTPONED, TaskStatus.IN_PROGRESS)).toBe(
			true,
		);
	});

	it("permite POSTPONED -> CANCELLED", () => {
		expect(canTransition(TaskStatus.POSTPONED, TaskStatus.CANCELLED)).toBe(
			true,
		);
	});

	it("rechaza COMPLETED -> cualquier estado", () => {
		expect(canTransition(TaskStatus.COMPLETED, TaskStatus.PENDING)).toBe(false);
		expect(canTransition(TaskStatus.COMPLETED, TaskStatus.IN_PROGRESS)).toBe(
			false,
		);
		expect(canTransition(TaskStatus.COMPLETED, TaskStatus.POSTPONED)).toBe(
			false,
		);
		expect(canTransition(TaskStatus.COMPLETED, TaskStatus.CANCELLED)).toBe(
			false,
		);
	});

	it("rechaza CANCELLED -> cualquier estado", () => {
		expect(canTransition(TaskStatus.CANCELLED, TaskStatus.PENDING)).toBe(false);
		expect(canTransition(TaskStatus.CANCELLED, TaskStatus.IN_PROGRESS)).toBe(
			false,
		);
		expect(canTransition(TaskStatus.CANCELLED, TaskStatus.POSTPONED)).toBe(
			false,
		);
		expect(canTransition(TaskStatus.CANCELLED, TaskStatus.COMPLETED)).toBe(
			false,
		);
	});
});

describe("transitionStatus", () => {
	it("retorna ok con el nuevo estado si es válido", () => {
		const result = transitionStatus(TaskStatus.PENDING, TaskStatus.IN_PROGRESS);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(TaskStatus.IN_PROGRESS);
		}
	});

	it("retorna error INVALID_STATE_TRANSITION si no es válido", () => {
		const result = transitionStatus(TaskStatus.PENDING, TaskStatus.COMPLETED);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(TaskError.INVALID_STATE_TRANSITION);
		}
	});

	it("retorna error desde COMPLETED a cualquier estado", () => {
		const result = transitionStatus(
			TaskStatus.COMPLETED,
			TaskStatus.IN_PROGRESS,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(TaskError.INVALID_STATE_TRANSITION);
		}
	});

	it("retorna error desde CANCELLED a cualquier estado", () => {
		const result = transitionStatus(TaskStatus.CANCELLED, TaskStatus.PENDING);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(TaskError.INVALID_STATE_TRANSITION);
		}
	});
});
