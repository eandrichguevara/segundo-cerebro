import type { QuickMemoryResponse } from "@/types/quick-memory";

const API_URL = process.env.API_URL ?? "http://localhost:3000";

export async function fetchQuickMemory(): Promise<QuickMemoryResponse> {
	const res = await fetch(`${API_URL}/debug/quick-memory`, { cache: "no-store" });
	if (!res.ok) {
		throw new Error(`Backend responded with ${res.status}`);
	}
	return res.json();
}

export type DbEntity =
	| "tasks"
	| "objectives"
	| "events"
	| "lists"
	| "memories"
	| "conversations"
	| "jobs"
	| "projects"
	| "ideas"
	| "devices"
	| "entity-links";

export interface DbListResponse<T> {
	data: T[];
	total: number;
}

export async function fetchDbData<T>(
	entity: DbEntity,
	params?: Record<string, string | number>,
): Promise<DbListResponse<T>> {
	const searchParams = new URLSearchParams();
	if (params) {
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== null && value !== "") {
				searchParams.set(key, String(value));
			}
		}
	}
	const qs = searchParams.toString();
	const url = `${API_URL}/api/db/${entity}${qs ? `?${qs}` : ""}`;
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) {
		throw new Error(`Backend responded with ${res.status} for ${entity}`);
	}
	return res.json();
}

export interface EntityLinkInfo {
	id: string;
	linkedType: string;
	linkedId: string;
	linkedTitle: string;
	relation: string;
}

export interface TaskRow {
	id: string;
	title: string;
	description: string | null;
	status: string;
	dueDate: string | null;
	priority: string;
	objectiveId: string | null;
	objectiveTitle: string | null;
	createdAt: string;
	updatedAt: string;
	cancelledAt: string | null;
	links?: EntityLinkInfo[];
}

export interface ObjectiveRow {
	id: string;
	title: string;
	description: string | null;
	deadline: string | null;
	status: string;
	taskCount: number;
	completedTasks: number;
	createdAt: string;
	links?: EntityLinkInfo[];
}

export interface EventRow {
	id: string;
	title: string;
	description: string | null;
	location: string | null;
	category: string | null;
	startTime: string;
	endTime: string | null;
	status: string;
	recurrenceRule: Record<string, unknown> | null;
	isException: boolean;
	createdAt: string;
	links?: EntityLinkInfo[];
}

export interface ListRow {
	id: string;
	title: string;
	description: string | null;
	type: string;
	status: string;
	items: Array<{ content: string; quantity?: string; checked: boolean }>;
	createdAt: string;
	links?: EntityLinkInfo[];
}

export interface MemoryRow {
	id: string;
	content: string;
	metadata: Record<string, unknown> | null;
	createdAt: string;
}

export interface ConversationRow {
	id: string;
	sessionId: string;
	role: string;
	content: string;
	createdAt: string;
}

export interface JobRow {
	id: string;
	type: string;
	source: string;
	status: string;
	attempts: number;
	maxAttempts: number;
	createdAt: string;
	updatedAt: string;
}

export async function fetchAllEntityCounts(): Promise<Record<string, number>> {
	const entities: DbEntity[] = [
		"tasks", "objectives", "events", "lists", "memories", "conversations", "jobs", "projects", "ideas", "devices", "entity-links",
	];
	const counts: Record<string, number> = {};
	for (const entity of entities) {
		try {
			const res = await fetchDbData<Record<string, unknown>>(entity, { limit: 1 });
			counts[entity] = res.total;
		} catch {
			counts[entity] = 0;
		}
	}
	return counts;
}

export interface ProjectRow {
	id: string;
	title: string;
	description: string | null;
	status: string;
	category: string | null;
	deadline: string | null;
	createdAt: string;
	updatedAt: string;
	cancelledAt: string | null;
	links?: EntityLinkInfo[];
}

export interface IdeaRow {
	id: string;
	title: string;
	description: string | null;
	status: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	links?: EntityLinkInfo[];
}

export interface DeviceRow {
	id: string;
	platform: string;
	fcmToken: string;
	createdAt: string;
	updatedAt: string;
}

export interface EntityLinkRow {
	id: string;
	sourceType: string;
	sourceId: string;
	targetType: string;
	targetId: string;
	relation: string;
	note: string | null;
	createdAt: string;
}
