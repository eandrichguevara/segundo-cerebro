export type TaskDisplay = {
	type: "task";
	title: string;
	priority: "high" | "medium" | "low";
	status: "pending" | "in_progress" | "completed" | "postponed" | "cancelled";
	dueDate?: string;
};

export type ListDisplay = {
	type: "list";
	title: string;
	items: Array<{ content: string; quantity?: string; checked: boolean }>;
};

export type ObjectiveDisplay = {
	type: "objective";
	title: string;
	status: "active" | "paused" | "completed" | "cancelled";
	deadline?: string;
};

export type EventDisplay = {
	type: "event";
	title: string;
	startTime: string;
	endTime?: string;
	location?: string;
	recurrence?: string;
	category?: string;
};

export type MemoryDisplay = {
	type: "memory";
	content: string;
};

export type ProjectDisplay = {
	type: "project";
	title: string;
	status: "active" | "paused" | "completed" | "cancelled";
	category?: string;
	deadline?: string;
};

export type IdeaDisplay = {
	type: "idea";
	title: string;
	status: "new_idea" | "evaluating" | "approved" | "discarded" | "converted";
	tags?: string[];
};

export type DisplayEntity =
	| TaskDisplay
	| ListDisplay
	| ObjectiveDisplay
	| EventDisplay
	| MemoryDisplay
	| ProjectDisplay
	| IdeaDisplay;
