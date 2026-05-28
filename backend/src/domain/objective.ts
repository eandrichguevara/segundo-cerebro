import { type Result, err, ok } from "../types/result.js";

export enum ObjectiveStatus {
	ACTIVE = "active",
	PAUSED = "paused",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
}

export enum ObjectiveError {
	NOT_FOUND = "OBJECTIVE_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
	HAS_PENDING_TASKS = "OBJECTIVE_HAS_PENDING_TASKS",
}

const VALID_TRANSITIONS: Record<ObjectiveStatus, ObjectiveStatus[]> = {
	[ObjectiveStatus.ACTIVE]: [
		ObjectiveStatus.PAUSED,
		ObjectiveStatus.COMPLETED,
		ObjectiveStatus.CANCELLED,
	],
	[ObjectiveStatus.PAUSED]: [ObjectiveStatus.ACTIVE, ObjectiveStatus.CANCELLED],
	[ObjectiveStatus.COMPLETED]: [],
	[ObjectiveStatus.CANCELLED]: [],
};

export function canTransition(
	from: ObjectiveStatus,
	to: ObjectiveStatus,
): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: ObjectiveStatus,
	target: ObjectiveStatus,
): Result<ObjectiveStatus, ObjectiveError> {
	if (!canTransition(current, target)) {
		return err(ObjectiveError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}
