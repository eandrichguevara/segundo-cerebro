import type { Prisma } from "@prisma/client";
import { broadcastAuthenticated } from "../api/ws.js";
import {
	formatDateInTimezone,
	formatTimeInTimezone,
} from "../config/current-time.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import * as deviceRepository from "../db/repositories/device-repository.js";
import * as entityLinkRepository from "../db/repositories/entity-link-repository.js";
import {
	type EventRecord,
	getActiveEventsInProgress,
} from "../db/repositories/event-repository.js";
import * as ideaRepository from "../db/repositories/idea-repository.js";
import * as listRepository from "../db/repositories/list-repository.js";
import * as objectiveRepository from "../db/repositories/objective-repository.js";
import * as projectRepository from "../db/repositories/project-repository.js";
import * as taskRepository from "../db/repositories/task-repository.js";
import {
	type RecurrenceRule,
	generateRecurrenceInstances,
} from "../domain/event.js";
import { sendNotification } from "../notifications/fcm.js";
import type {
	DisplayEntity,
	EventDisplay,
	IdeaDisplay,
	ListDisplay,
	ObjectiveDisplay,
	ProjectDisplay,
	TaskDisplay,
} from "../types/display.js";

const POLL_INTERVAL_MS = 60_000;
const MAX_LIST_ITEMS = 15;
const REFRESH_INTERVAL_MS = env.EVENT_NOTIFICATION_REFRESH_MS;

const notificationTimestamps = new Map<string, number>();

type LinkedEntityData = {
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

function isRecurringInstanceActive(event: EventRecord, now: Date): boolean {
	if (!event.recurrenceRule || typeof event.recurrenceRule !== "object") {
		return false;
	}

	const rule = event.recurrenceRule as Record<string, unknown>;
	const frequency = String(rule.frequency ?? "daily");

	const lookbackHours =
		frequency === "yearly"
			? 8760
			: frequency === "monthly"
				? 744
				: frequency === "weekly"
					? 168
					: 48;

	const rangeStart = new Date(
		Math.max(
			event.startTime.getTime(),
			now.getTime() - lookbackHours * 3_600_000,
		),
	);

	const instances = generateRecurrenceInstances(
		{ ...(rule as RecurrenceRule), count: 10_000 },
		event.startTime,
		event.endTime ?? undefined,
		rangeStart,
		new Date(now.getTime() + 60_000),
	);

	return instances.some((inst) => {
		const instEnd = inst.end ?? new Date(inst.start.getTime() + 3_600_000);
		return inst.start <= now && instEnd > now;
	});
}

function isEventActiveNow(event: EventRecord, now: Date): boolean {
	if (event.recurrenceRule && typeof event.recurrenceRule === "object") {
		return isRecurringInstanceActive(event, now);
	}

	if (event.endTime && event.endTime <= now) {
		logger.debug(
			{
				eventId: event.id,
				eventTitle: event.title,
				endTime: event.endTime.toISOString(),
				now: now.toISOString(),
			},
			"Event skipped: endTime <= now",
		);
		return false;
	}

	return true;
}

async function resolveLinkedEntities(
	links: entityLinkRepository.EntityLinkRecord[],
): Promise<LinkedEntityData[]> {
	const entities: LinkedEntityData[] = [];

	for (const link of links) {
		const isSourceEvent = link.sourceType === "event";
		const otherType = isSourceEvent ? link.targetType : link.sourceType;
		const otherId = isSourceEvent ? link.targetId : link.sourceId;

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

function buildEventChatText(
	event: EventRecord,
	linkedEntities: LinkedEntityData[],
): string {
	const timeStr = `${formatTimeInTimezone(event.startTime)}${event.endTime ? ` - ${formatTimeInTimezone(event.endTime)}` : ""}`;
	const parts: string[] = [`📅 **${event.title}** empieza ahora · ${timeStr}`];
	if (event.location) parts.push(`📍 ${event.location}`);
	if (event.category) parts.push(`#${event.category}`);

	const listCount = linkedEntities.filter((e) => e.type === "list").length;
	const taskCount = linkedEntities.filter((e) => e.type === "task").length;
	const objectiveCount = linkedEntities.filter(
		(e) => e.type === "objective",
	).length;

	const summary: string[] = [];
	if (taskCount > 0)
		summary.push(`${taskCount} tarea${taskCount > 1 ? "s" : ""}`);
	if (listCount > 0)
		summary.push(`${listCount} lista${listCount > 1 ? "s" : ""}`);
	if (objectiveCount > 0)
		summary.push(`${objectiveCount} objetivo${objectiveCount > 1 ? "s" : ""}`);

	if (summary.length > 0) {
		parts.push(
			`Tiene ${summary.join(", ")} relacionada${summary.length > 1 ? "s" : ""}.`,
		);
	}

	return parts.join("\n");
}

function buildEventDisplayEntities(
	event: EventRecord,
	linkedEntities: LinkedEntityData[],
): DisplayEntity[] {
	const entities: DisplayEntity[] = [];

	// Event display
	const eventDisplay: EventDisplay = {
		type: "event",
		title: event.title,
		startTime: event.startTime.toISOString(),
	};
	if (event.endTime) eventDisplay.endTime = event.endTime.toISOString();
	if (event.location) eventDisplay.location = event.location;
	if (event.category) eventDisplay.category = event.category;
	if (event.recurrenceRule && typeof event.recurrenceRule === "object") {
		const rule = event.recurrenceRule as Record<string, unknown>;
		eventDisplay.recurrence = String(rule.frequency ?? "custom");
	}
	entities.push(eventDisplay);

	// Linked entity displays
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

function sendEventChatMessage(
	event: EventRecord,
	linkedEntities: LinkedEntityData[],
): void {
	const text = buildEventChatText(event, linkedEntities);
	const display = buildEventDisplayEntities(event, linkedEntities);

	// Send text message first
	const sentText = broadcastAuthenticated({
		version: "1",
		type: "text",
		content: text,
	});

	// Send display entities for native rendering
	const sentDisplay = broadcastAuthenticated({
		version: "1",
		type: "display",
		entities: display,
	});

	if (sentText > 0 || sentDisplay > 0) {
		logger.info(
			{
				eventId: event.id,
				eventTitle: event.title,
				connectedClients: Math.max(sentText, sentDisplay),
			},
			"Event chat message sent",
		);
	}
}

async function sendEventNotification(
	event: EventRecord,
	linkedEntities: LinkedEntityData[],
): Promise<void> {
	const timeStr = `${formatTimeInTimezone(event.startTime)}${event.endTime ? ` - ${formatTimeInTimezone(event.endTime)}` : ""}`;
	const dateStr = formatDateInTimezone(event.startTime);

	const eventData = {
		id: event.id,
		title: event.title,
		description: event.description,
		startTime: event.startTime.toISOString(),
		endTime: event.endTime?.toISOString() ?? null,
		location: event.location,
		category: event.category,
	};

	const linksData = linkedEntities.map((ent) => {
		if (ent.type === "list" && ent.items) {
			const truncatedItems =
				ent.items.length > MAX_LIST_ITEMS
					? [
							...ent.items.slice(0, MAX_LIST_ITEMS),
							{
								content: `... y ${ent.items.length - MAX_LIST_ITEMS} más`,
								checked: false,
							},
						]
					: ent.items;
			return {
				id: ent.id,
				type: ent.type,
				title: ent.title,
				description: ent.description,
				status: ent.status,
				listType: ent.listType,
				relation: ent.relation,
				note: ent.note,
				items: truncatedItems,
			};
		}
		return {
			id: ent.id,
			type: ent.type,
			title: ent.title,
			description: ent.description,
			status: ent.status,
			priority: ent.priority,
			deadline: ent.deadline,
			listType: ent.listType,
			category: ent.category,
			tags: ent.tags,
			relation: ent.relation,
			note: ent.note,
		};
	});

	const dataPayload: Record<string, string> = {
		type: "event_notification",
		event: JSON.stringify(eventData),
		links: JSON.stringify(linksData),
	};

	const bodySummary = [timeStr];
	if (event.location) bodySummary.push(`📍 ${event.location}`);
	if (event.category) bodySummary.push(`#${event.category}`);

	for (const ent of linkedEntities) {
		if (ent.type === "list" && ent.items) {
			const checked = ent.items.filter((i) => i.checked).length;
			const total = ent.items.length;
			bodySummary.push(`📋 ${ent.title} (${checked}/${total})`);
		}
	}

	const tokens = await deviceRepository.getAllTokens();
	if (tokens.length === 0) {
		logger.warn("No FCM tokens registered for event notification");
		return;
	}

	for (const token of tokens) {
		const result = await sendNotification(token, {
			title: `📅 ${event.title}`,
			body: bodySummary.join(" · "),
			data: dataPayload,
			sendNotification: true,
		});
		if (!result.ok) {
			logger.warn(
				{ fcmToken: token.slice(0, 8) },
				"FCM send failed for event, removing token",
			);
			await deviceRepository.removeToken(token).catch(() => {});
		}
	}
}

async function sendEventCancelNotification(eventId: string): Promise<void> {
	const tokens = await deviceRepository.getAllTokens();
	if (tokens.length === 0) return;

	const dataPayload: Record<string, string> = {
		type: "event_notification_cancel",
		event_id: eventId,
	};

	for (const token of tokens) {
		const result = await sendNotification(token, {
			title: "",
			body: "",
			data: dataPayload,
			sendNotification: false,
		});
		if (!result.ok) {
			await deviceRepository.removeToken(token).catch(() => {});
		}
	}
}

async function pollActiveEvents(): Promise<void> {
	try {
		const now = new Date();
		const allActiveEvents = await getActiveEventsInProgress(now);
		const activeEventIds = new Set<string>();

		for (const event of allActiveEvents) {
			if (!isEventActiveNow(event, now)) continue;

			activeEventIds.add(event.id);

			const lastSent = notificationTimestamps.get(event.id);

			if (lastSent !== undefined) {
				// Already notified before — check if refresh is due
				if (now.getTime() - lastSent < REFRESH_INTERVAL_MS) {
					continue; // Not due for refresh yet
				}
				logger.debug(
					{ eventId: event.id, eventTitle: event.title },
					"Event notification refresh due",
				);
			}

			const links = await entityLinkRepository.getLinksFor("event", event.id);
			const linkedEntities = await resolveLinkedEntities(links);

			if (lastSent === undefined) {
				// First activation: send FCM push + chat message
				await sendEventNotification(event, linkedEntities);
				sendEventChatMessage(event, linkedEntities);
				logger.info(
					{ eventId: event.id, eventTitle: event.title },
					"Event notification sent",
				);
			} else {
				// Refresh: only send FCM push
				await sendEventNotification(event, linkedEntities);
				logger.debug(
					{ eventId: event.id, eventTitle: event.title },
					"Event notification refreshed",
				);
			}

			notificationTimestamps.set(event.id, now.getTime());
		}

		for (const [eventId] of notificationTimestamps) {
			if (!activeEventIds.has(eventId)) {
				await sendEventCancelNotification(eventId);
				notificationTimestamps.delete(eventId);
				logger.info({ eventId }, "Event notification cancelled");
			}
		}
	} catch (error) {
		logger.error({ error }, "Error polling active events");
	}
}

export async function pollActiveEventsOnce(): Promise<void> {
	await pollActiveEvents();
}

export function startEventAlertWorker(): () => void {
	logger.info("Starting event alert worker");
	pollActiveEvents();
	const timer = setInterval(pollActiveEvents, POLL_INTERVAL_MS);

	return () => {
		clearInterval(timer);
		notificationTimestamps.clear();
		logger.info("Event alert worker stopped");
	};
}
