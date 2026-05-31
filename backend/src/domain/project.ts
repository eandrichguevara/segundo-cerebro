import { type Result, err, ok } from "../types/result.js";

export enum ProjectStatus {
	ACTIVE = "active",
	PAUSED = "paused",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
}

export enum ProjectError {
	NOT_FOUND = "PROJECT_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
}

const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
	[ProjectStatus.ACTIVE]: [
		ProjectStatus.PAUSED,
		ProjectStatus.COMPLETED,
		ProjectStatus.CANCELLED,
	],
	[ProjectStatus.PAUSED]: [ProjectStatus.ACTIVE, ProjectStatus.CANCELLED],
	[ProjectStatus.COMPLETED]: [],
	[ProjectStatus.CANCELLED]: [],
};

export function canTransition(
	from: ProjectStatus,
	to: ProjectStatus,
): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: ProjectStatus,
	target: ProjectStatus,
): Result<ProjectStatus, ProjectError> {
	if (!canTransition(current, target)) {
		return err(ProjectError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}
