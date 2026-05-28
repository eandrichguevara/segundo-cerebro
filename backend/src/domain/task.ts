import { type Result, err, ok } from "../types/result.js";

export enum TaskStatus {
	PENDING = "pending",
	IN_PROGRESS = "in_progress",
	COMPLETED = "completed",
	POSTPONED = "postponed",
	CANCELLED = "cancelled",
}

export enum TaskError {
	NOT_FOUND = "TASK_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
	CANNOT_MODIFY_COMPLETED = "CANNOT_MODIFY_COMPLETED",
	CANNOT_MODIFY_CANCELLED = "CANNOT_MODIFY_CANCELLED",
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
	[TaskStatus.PENDING]: [
		TaskStatus.IN_PROGRESS,
		TaskStatus.POSTPONED,
		TaskStatus.CANCELLED,
	],
	[TaskStatus.IN_PROGRESS]: [
		TaskStatus.COMPLETED,
		TaskStatus.POSTPONED,
		TaskStatus.CANCELLED,
	],
	[TaskStatus.COMPLETED]: [],
	[TaskStatus.POSTPONED]: [
		TaskStatus.PENDING,
		TaskStatus.IN_PROGRESS,
		TaskStatus.CANCELLED,
	],
	[TaskStatus.CANCELLED]: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: TaskStatus,
	target: TaskStatus,
): Result<TaskStatus, TaskError> {
	if (!canTransition(current, target)) {
		return err(TaskError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}
