import type { Prisma } from "@prisma/client";
import { logger } from "../config/logger.js";
import * as deviceRepository from "../db/repositories/device-repository.js";
import * as entityLinkRepository from "../db/repositories/entity-link-repository.js";
import {
	type EventRecord,
	getActiveEventsInProgress,
} from "../db/repositories/event-repository.js";
import * as listRepository from "../db/repositories/list-repository.js";
import * as objectiveRepository from "../db/repositories/objective-repository.js";
import * as taskRepository from "../db/repositories/task-repository.js";
import {
	type RecurrenceRule,
	generateRecurrenceInstances,
} from "../domain/event.js";
import { sendNotification } from "../notifications/fcm.js";

const POLL_INTERVAL_MS = 60_000;
const UPDATE_INTERVAL_MS = 5 * 60_000;

type SentState = {
	sentAt: number;
	lastUpdated: number;
};

const sentNotifications = new Map<string, SentState>();

type LinkedEntityData = {
	type: string;
	title: string;
	items?: Array<{ content: string; checked: boolean; quantity?: string }>;
	status?: string;
	priority?: string;
	deadline?: string;
};

function formatTime(date: Date): string {
	return date.toLocaleTimeString("es-AR", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("es-AR", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

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
							type: "list",
							title: list.title,
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
							type: "task",
							title: task.title,
							status: task.status,
							priority: task.priority,
						});
					}
					break;
				}
				case "objective": {
					const objective = await objectiveRepository.getObjectiveById(otherId);
					if (objective) {
						entities.push({
							type: "objective",
							title: objective.title,
							status: objective.status,
							deadline: objective.deadline?.toISOString(),
						});
					}
					break;
				}
				case "project": {
					entities.push({ type: "project", title: otherId });
					break;
				}
				case "idea": {
					entities.push({ type: "idea", title: otherId });
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

async function sendEventNotification(
	event: EventRecord,
	links: entityLinkRepository.EntityLinkRecord[],
): Promise<void> {
	const linkedEntities = await resolveLinkedEntities(links);

	const timeStr = `${formatTime(event.startTime)}${event.endTime ? ` - ${formatTime(event.endTime)}` : ""}`;
	const dateStr = formatDate(event.startTime);

	const eventData = {
		id: event.id,
		title: event.title,
		startTime: event.startTime.toISOString(),
		endTime: event.endTime?.toISOString() ?? null,
		location: event.location,
		category: event.category,
	};

	const linksData = linkedEntities.map((ent) => {
		if (ent.type === "list" && ent.items) {
			return {
				type: ent.type,
				title: ent.title,
				items: ent.items,
			};
		}
		return {
			type: ent.type,
			title: ent.title,
			status: ent.status,
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
			const sent = sentNotifications.get(event.id);
			const shouldSend =
				!sent || now.getTime() - sent.lastUpdated >= UPDATE_INTERVAL_MS;

			if (!shouldSend) continue;

			const links = await entityLinkRepository.getLinksFor("event", event.id);
			await sendEventNotification(event, links);
			sentNotifications.set(event.id, {
				sentAt: now.getTime(),
				lastUpdated: now.getTime(),
			});
			logger.info(
				{ eventId: event.id, eventTitle: event.title },
				"Event notification sent",
			);
		}

		for (const [eventId] of sentNotifications.entries()) {
			if (!activeEventIds.has(eventId)) {
				await sendEventCancelNotification(eventId);
				sentNotifications.delete(eventId);
				logger.info({ eventId }, "Event notification cancelled");
			}
		}
	} catch (error) {
		logger.error({ error }, "Error polling active events");
	}
}

export function startEventAlertWorker(): () => void {
	logger.info("Starting event alert worker");
	pollActiveEvents();
	const timer = setInterval(pollActiveEvents, POLL_INTERVAL_MS);

	return () => {
		clearInterval(timer);
		sentNotifications.clear();
		logger.info("Event alert worker stopped");
	};
}
