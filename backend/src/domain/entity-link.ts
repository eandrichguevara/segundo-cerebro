import { type Result, err, ok } from "../types/result.js";

export const VALID_ENTITY_TYPES = [
	"task",
	"objective",
	"project",
	"idea",
	"list",
	"event",
] as const;

export type EntityType = (typeof VALID_ENTITY_TYPES)[number];

export const VALID_RELATIONS = [
	"related",
	"part_of",
	"depends_on",
	"inspired_by",
	"blocks",
] as const;

export type LinkRelation = (typeof VALID_RELATIONS)[number];

export enum EntityLinkError {
	INVALID_ENTITY_TYPE = "INVALID_ENTITY_TYPE",
	INVALID_RELATION = "INVALID_RELATION",
	SELF_LINK = "SELF_LINK",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
	LINK_NOT_FOUND = "LINK_NOT_FOUND",
	LINK_ALREADY_EXISTS = "LINK_ALREADY_EXISTS",
}

export interface LinkInput {
	sourceType: string;
	sourceId: string;
	targetType: string;
	targetId: string;
	relation?: string;
	note?: string;
}

export function validateLink(
	input: LinkInput,
): Result<LinkInput, EntityLinkError> {
	if (!VALID_ENTITY_TYPES.includes(input.sourceType as EntityType)) {
		return err(EntityLinkError.INVALID_ENTITY_TYPE);
	}
	if (!VALID_ENTITY_TYPES.includes(input.targetType as EntityType)) {
		return err(EntityLinkError.INVALID_ENTITY_TYPE);
	}

	if (
		input.sourceType === input.targetType &&
		input.sourceId === input.targetId
	) {
		return err(EntityLinkError.SELF_LINK);
	}

	if (
		input.relation &&
		!VALID_RELATIONS.includes(input.relation as LinkRelation)
	) {
		return err(EntityLinkError.INVALID_RELATION);
	}

	return ok(input);
}
