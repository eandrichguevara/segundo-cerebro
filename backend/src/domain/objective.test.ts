import { describe, expect, it } from "vitest";
import {
	ObjectiveError,
	ObjectiveStatus,
	canTransition,
	transitionStatus,
} from "./objective.js";

describe("canTransition", () => {
	it("permite ACTIVE -> PAUSED", () => {
		expect(canTransition(ObjectiveStatus.ACTIVE, ObjectiveStatus.PAUSED)).toBe(
			true,
		);
	});

	it("permite ACTIVE -> COMPLETED", () => {
		expect(
			canTransition(ObjectiveStatus.ACTIVE, ObjectiveStatus.COMPLETED),
		).toBe(true);
	});

	it("permite ACTIVE -> CANCELLED", () => {
		expect(
			canTransition(ObjectiveStatus.ACTIVE, ObjectiveStatus.CANCELLED),
		).toBe(true);
	});

	it("permite PAUSED -> ACTIVE", () => {
		expect(canTransition(ObjectiveStatus.PAUSED, ObjectiveStatus.ACTIVE)).toBe(
			true,
		);
	});

	it("permite PAUSED -> CANCELLED", () => {
		expect(
			canTransition(ObjectiveStatus.PAUSED, ObjectiveStatus.CANCELLED),
		).toBe(true);
	});

	it("rechaza COMPLETED -> cualquier estado", () => {
		expect(
			canTransition(ObjectiveStatus.COMPLETED, ObjectiveStatus.ACTIVE),
		).toBe(false);
		expect(
			canTransition(ObjectiveStatus.COMPLETED, ObjectiveStatus.PAUSED),
		).toBe(false);
		expect(
			canTransition(ObjectiveStatus.COMPLETED, ObjectiveStatus.CANCELLED),
		).toBe(false);
	});

	it("rechaza CANCELLED -> cualquier estado", () => {
		expect(
			canTransition(ObjectiveStatus.CANCELLED, ObjectiveStatus.ACTIVE),
		).toBe(false);
		expect(
			canTransition(ObjectiveStatus.CANCELLED, ObjectiveStatus.PAUSED),
		).toBe(false);
		expect(
			canTransition(ObjectiveStatus.CANCELLED, ObjectiveStatus.COMPLETED),
		).toBe(false);
	});

	it("rechaza ACTIVE -> ACTIVE (auto-transición)", () => {
		expect(canTransition(ObjectiveStatus.ACTIVE, ObjectiveStatus.ACTIVE)).toBe(
			false,
		);
	});

	it("rechaza PAUSED -> COMPLETED", () => {
		expect(
			canTransition(ObjectiveStatus.PAUSED, ObjectiveStatus.COMPLETED),
		).toBe(false);
	});
});

describe("transitionStatus", () => {
	it("retorna ok con el nuevo estado si es válido", () => {
		const result = transitionStatus(
			ObjectiveStatus.ACTIVE,
			ObjectiveStatus.PAUSED,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBe(ObjectiveStatus.PAUSED);
		}
	});

	it("retorna error INVALID_STATE_TRANSITION si no es válido", () => {
		const result = transitionStatus(
			ObjectiveStatus.COMPLETED,
			ObjectiveStatus.ACTIVE,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe(ObjectiveError.INVALID_STATE_TRANSITION);
		}
	});
});
