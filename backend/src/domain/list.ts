import { type Result, err, ok } from "../types/result.js";

export type ListItem = {
	content: string;
	quantity?: string;
	checked: boolean;
};

export enum ListStatus {
	ACTIVE = "active",
	COMPLETED = "completed",
	CANCELLED = "cancelled",
}

export enum ListError {
	NOT_FOUND = "LIST_NOT_FOUND",
	INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
	INVALID_ITEM_INDEX = "INVALID_ITEM_INDEX",
	LIST_HAS_UNCHECKED_ITEMS = "LIST_HAS_UNCHECKED_ITEMS",
	MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
}

const VALID_TRANSITIONS: Record<ListStatus, ListStatus[]> = {
	[ListStatus.ACTIVE]: [ListStatus.COMPLETED, ListStatus.CANCELLED],
	[ListStatus.COMPLETED]: [],
	[ListStatus.CANCELLED]: [],
};

export function canTransition(from: ListStatus, to: ListStatus): boolean {
	return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionStatus(
	current: ListStatus,
	target: ListStatus,
): Result<ListStatus, ListError> {
	if (!canTransition(current, target)) {
		return err(ListError.INVALID_STATE_TRANSITION);
	}
	return ok(target);
}

export function validateCreateList(payload: {
	title?: string;
}): Result<{ title: string }, ListError> {
	if (!payload.title || payload.title.trim().length === 0) {
		return err(ListError.MISSING_REQUIRED_FIELD);
	}
	return ok({ title: payload.title.trim() });
}

export function validateItemIndex(
	items: ListItem[],
	index: number,
): Result<ListItem, ListError> {
	if (index < 0 || index >= items.length) {
		return err(ListError.INVALID_ITEM_INDEX);
	}
	const item = items[index];
	if (!item) {
		return err(ListError.INVALID_ITEM_INDEX);
	}
	return ok(item);
}

export function validateCompleteList(
	items: ListItem[],
): Result<void, ListError> {
	const unchecked = items.filter((i) => !i.checked);
	if (unchecked.length > 0) {
		return err(ListError.LIST_HAS_UNCHECKED_ITEMS);
	}
	return ok(undefined);
}
