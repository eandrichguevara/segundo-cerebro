import { Prisma } from "@prisma/client";
import type { EventStatus } from "../../domain/event.js";
import { prisma } from "../index.js";

export type EventRecord = {
	id: string;
	title: string;
	description: string | null;
	location: string | null;
	category: string | null;
	startTime: Date;
	endTime: Date | null;
	status: string;
	recurrenceRule: Prisma.JsonValue;
	parentId: string | null;
	isException: boolean;
	exceptionDate: Date | null;
	createdAt: Date;
	updatedAt: Date;
	cancelledAt: Date | null;
};

export type CreateEventData = {
	title: string;
	description?: string;
	location?: string;
	category?: string;
	startTime: string;
	endTime?: string;
	recurrenceRule?: Record<string, unknown>;
	parentId?: string;
	isException?: boolean;
	exceptionDate?: string;
};

export type UpdateEventData = {
	title?: string;
	description?: string | null;
	location?: string | null;
	category?: string | null;
	startTime?: string;
	endTime?: string | null;
	recurrenceRule?: Record<string, unknown> | null;
	parentId?: string;
	isException?: boolean;
	exceptionDate?: string | null;
};

export async function createEvent(data: CreateEventData) {
	const event = await prisma.event.create({
		data: {
			title: data.title,
			description: data.description ?? null,
			location: data.location ?? null,
			category: data.category ?? null,
			startTime: new Date(data.startTime),
			endTime: data.endTime ? new Date(data.endTime) : null,
			recurrenceRule: data.recurrenceRule
				? (data.recurrenceRule as Prisma.InputJsonValue)
				: Prisma.JsonNull,
			parentId: data.parentId ?? null,
			isException: data.isException ?? false,
			exceptionDate: data.exceptionDate ? new Date(data.exceptionDate) : null,
		},
	});
	return event as unknown as EventRecord;
}

export async function getEventById(id: string) {
	const event = await prisma.event.findUnique({ where: { id } });
	return event as unknown as EventRecord | null;
}

export async function updateEvent(id: string, data: UpdateEventData) {
	const updateData: Prisma.EventUncheckedUpdateInput = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.location !== undefined) updateData.location = data.location;
	if (data.category !== undefined) updateData.category = data.category;
	if (data.startTime !== undefined)
		updateData.startTime = new Date(data.startTime);
	if (data.endTime !== undefined)
		updateData.endTime = data.endTime ? new Date(data.endTime) : null;
	if (data.recurrenceRule !== undefined)
		updateData.recurrenceRule = data.recurrenceRule
			? (data.recurrenceRule as Prisma.InputJsonValue)
			: Prisma.JsonNull;
	if (data.parentId !== undefined) updateData.parentId = data.parentId;
	if (data.isException !== undefined) updateData.isException = data.isException;
	if (data.exceptionDate !== undefined)
		updateData.exceptionDate = data.exceptionDate
			? new Date(data.exceptionDate)
			: null;

	const event = await prisma.event.update({
		where: { id },
		data: updateData,
	});
	return event as unknown as EventRecord;
}

export async function transitionEventStatus(
	id: string,
	status: EventStatus,
	cancelledAt?: Date | null,
) {
	const event = await prisma.event.update({
		where: { id },
		data: {
			status: status as never,
			...(cancelledAt !== undefined ? { cancelledAt } : {}),
		},
	});
	return event as unknown as EventRecord;
}

export async function getEventsByDateRange(start: Date, end: Date) {
	const events = await prisma.event.findMany({
		where: {
			status: "active" as never,
			startTime: { gte: start, lte: end },
		},
		orderBy: { startTime: "asc" },
	});
	return events as unknown as EventRecord[];
}

export async function getRecurringEvents() {
	const events = await prisma.event.findMany({
		where: {
			status: "active" as never,
			recurrenceRule: { not: Prisma.JsonNull },
			parentId: null,
		},
	});
	return events as unknown as EventRecord[];
}

export async function getUpcomingEvents(limit = 10) {
	const events = await prisma.event.findMany({
		where: {
			status: "active" as never,
			startTime: { gte: new Date() },
		},
		orderBy: { startTime: "asc" },
		take: limit,
	});
	return events as unknown as EventRecord[];
}

export async function getEventExceptions(parentId: string) {
	const events = await prisma.event.findMany({
		where: {
			parentId,
			isException: true,
		},
	});
	return events as unknown as EventRecord[];
}

