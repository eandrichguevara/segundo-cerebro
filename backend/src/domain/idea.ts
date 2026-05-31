import { type Result, err, ok } from "../types/result.js";

export enum IdeaStatus {
	NEW = "new_idea",
	EVALUATING = "evaluating",
	APPROVED = "approved",
	DISCARDED = "discarded",
	CONVERTED = "converted",
}

export enum IdeaError {
	NOT_FOUND = "IDEA_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
}

const VALID_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
	[IdeaStatus.NEW]: [IdeaStatus.EVALUATING, IdeaStatus.DISCARDED],
	[IdeaStatus.EVALUATING]: [
		IdeaStatus.APPROVED,
		IdeaStatus.DISCARDED,
		IdeaStatus.NEW,
	],
	[IdeaStatus.APPROVED]: [IdeaStatus.CONVERTED],
	[IdeaStatus.DISCARDED]: [],
	[IdeaStatus.CONVERTED]: [],
};

export function canTransition(from: IdeaStatus, to: IdeaStatus): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: IdeaStatus,
	target: IdeaStatus,
): Result<IdeaStatus, IdeaError> {
	if (!canTransition(current, target)) {
		return err(IdeaError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}
