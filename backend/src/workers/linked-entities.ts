import * as entityLinkRepository from "../db/repositories/entity-link-repository.js";
import * as ideaRepository from "../db/repositories/idea-repository.js";
import * as listRepository from "../db/repositories/list-repository.js";
import * as objectiveRepository from "../db/repositories/objective-repository.js";
import * as projectRepository from "../db/repositories/project-repository.js";
import * as taskRepository from "../db/repositories/task-repository.js";
import { logger } from "../config/logger.js";
import type {
	DisplayEntity,
	IdeaDisplay,
	ListDisplay,
	ObjectiveDisplay,
	ProjectDisplay,
	TaskDisplay,
} from "../types/display.js";

export type LinkedEntityData = {
	id: string;
	type: string;
	title: string;
	description?: string;
	relation?: string;
	note?: string;
	items?: Array<{ content: string; checked: boolean; quantity?: string }>;
	status?: string;
	priority?: string;
	deadline?: string;
	listType?: string;
	category?: string;
	tags?: string[];
};

/**
 * Resolves all linked entities for a given source entity (by its links array).
 * Excludes links where the "other" entity is of `excludeType` (e.g. "task" when
 * building the linked entities for a task reminder so we don't recurse into self).
 */
export async function resolveLinkedEntities(
	links: entityLinkRepository.EntityLinkRecord[],
	sourceType?: string,
): Promise<LinkedEntityData[]> {
	const entities: LinkedEntityData[] = [];

	for (const link of links) {
		const isSource = link.sourceType === sourceType;
		const otherType = isSource ? link.targetType : link.sourceType;
		const otherId = isSource ? link.targetId : link.sourceId;

		try {
			switch (otherType) {
				case "list": {
					const list = await listRepository.getListById(otherId);
					if (list) {
						const items = listRepository.getItems(list);
						entities.push({
							id: list.id,
							type: "list",
							title: list.title,
							description: list.description ?? undefined,
							status: list.status,
							listType: list.type,
							relation: link.relation,
							note: link.note ?? undefined,
							items: items.map((i) => ({
								content: i.content,
								checked: i.checked,
								quantity: i.quantity,
							})),
						});
					}
					break;
				}
				case "task": {
					const task = await taskRepository.getTaskById(otherId);
					if (task) {
						entities.push({
							id: task.id,
							type: "task",
							title: task.title,
							description: task.description ?? undefined,
							status: task.status,
							priority: task.priority,
							deadline: task.dueDate?.toISOString(),
							relation: link.relation,
							note: link.note ?? undefined,
						});
					}
					break;
				}
				case "objective": {
					const objective = await objectiveRepository.getObjectiveById(otherId);
					if (objective) {
						entities.push({
							id: objective.id,
							type: "objective",
							title: objective.title,
							description: objective.description ?? undefined,
							status: objective.status,
							deadline: objective.deadline?.toISOString(),
							relation: link.relation,
							note: link.note ?? undefined,
						});
					}
					break;
				}
				case "project": {
					const project = await projectRepository.getProjectById(otherId);
					if (project) {
						entities.push({
							id: project.id,
							type: "project",
							title: project.title,
							description: project.description ?? undefined,
							status: project.status,
							category: project.category ?? undefined,
							deadline: project.deadline?.toISOString(),
							relation: link.relation,
							note: link.note ?? undefined,
						});
					}
					break;
				}
				case "idea": {
					const idea = await ideaRepository.getIdeaById(otherId);
					if (idea) {
						entities.push({
							id: idea.id,
							type: "idea",
							title: idea.title,
							description: idea.description ?? undefined,
							status: idea.status,
							tags: idea.tags,
							relation: link.relation,
							note: link.note ?? undefined,
						});
					}
					break;
				}
				case "event": {
					// Events are typically the source in event-alert-worker; skip here.
					break;
				}
			}
		} catch (error) {
			logger.error(
				{ error, otherType, otherId },
				"Error resolving linked entity",
			);
		}
	}

	return entities;
}

/**
 * Builds Flutter-native DisplayEntity objects from resolved linked entities.
 */
export function buildLinkedDisplayEntities(
	linkedEntities: LinkedEntityData[],
): DisplayEntity[] {
	const entities: DisplayEntity[] = [];

	for (const ent of linkedEntities) {
		switch (ent.type) {
			case "task": {
				const taskDisplay: TaskDisplay = {
					type: "task",
					title: ent.title,
					priority: (ent.priority as "high" | "medium" | "low") ?? "medium",
					status:
						(ent.status as
							| "pending"
							| "in_progress"
							| "completed"
							| "postponed"
							| "cancelled") ?? "pending",
				};
				if (ent.deadline) taskDisplay.dueDate = ent.deadline;
				entities.push(taskDisplay);
				break;
			}
			case "list": {
				const listDisplay: ListDisplay = {
					type: "list",
					title: ent.title,
					items: (ent.items ?? []).map((i) => ({
						content: i.content,
						checked: i.checked,
						...(i.quantity ? { quantity: i.quantity } : {}),
					})),
				};
				entities.push(listDisplay);
				break;
			}
			case "objective": {
				const objDisplay: ObjectiveDisplay = {
					type: "objective",
					title: ent.title,
					status:
						(ent.status as "active" | "paused" | "completed" | "cancelled") ??
						"active",
				};
				if (ent.deadline) objDisplay.deadline = ent.deadline;
				entities.push(objDisplay);
				break;
			}
			case "project": {
				const projDisplay: ProjectDisplay = {
					type: "project",
					title: ent.title,
					status:
						(ent.status as "active" | "paused" | "completed" | "cancelled") ??
						"active",
				};
				if (ent.category) projDisplay.category = ent.category;
				if (ent.deadline) projDisplay.deadline = ent.deadline;
				entities.push(projDisplay);
				break;
			}
			case "idea": {
				const ideaDisplay: IdeaDisplay = {
					type: "idea",
					title: ent.title,
					status:
						(ent.status as
							| "new_idea"
							| "evaluating"
							| "approved"
							| "discarded"
							| "converted") ?? "new_idea",
				};
				if (ent.tags && ent.tags.length > 0) ideaDisplay.tags = ent.tags;
				entities.push(ideaDisplay);
				break;
			}
		}
	}

	return entities;
}

/**
 * Fetches all entity links for a given entity and resolves them.
 */
export async function getLinkedEntitiesFor(
	entityType: string,
	entityId: string,
): Promise<LinkedEntityData[]> {
	const links = await entityLinkRepository.getLinksFor(
		entityType as entityLinkRepository.EntityLinkRecord["sourceType"],
		entityId,
	);
	return resolveLinkedEntities(links, entityType);
}
