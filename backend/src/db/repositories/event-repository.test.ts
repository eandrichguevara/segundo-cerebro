import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "../index.js";
import * as eventRepository from "./event-repository.js";
import type { $Enums, Prisma } from "@prisma/client";

describe("event repository", () => {
	const testEvents: string[] = [];
	const testTaskId: string[] = [];

	afterEach(async () => {
		for (const id of testEvents) {
			await prisma.event.delete({ where: { id } }).catch(() => {});
		}
		for (const id of testTaskId) {
			await prisma.task.delete({ where: { id } }).catch(() => {});
		}
		testEvents.length = 0;
		testTaskId.length = 0;
	});

	it("should create an event", async () => {
		const event = await eventRepository.createEvent({
			title: "Reunión de equipo",
			description: "Revisión semanal",
			location: "Sala A",
			category: "trabajo",
			startTime: "2026-06-01T10:00:00Z",
			endTime: "2026-06-01T11:00:00Z",
		});

		testEvents.push(event.id);

		expect(event.title).toBe("Reunión de equipo");
		expect(event.description).toBe("Revisión semanal");
		expect(event.location).toBe("Sala A");
		expect(event.category).toBe("trabajo");
		expect(event.status).toBe("active");
	});

	it("should create a recurring event", async () => {
		const event = await eventRepository.createEvent({
			title: "Daily standup",
			startTime: "2026-06-01T09:00:00Z",
			endTime: "2026-06-01T09:15:00Z",
			recurrenceRule: {
				frequency: "daily",
				interval: 1,
			},
		});

		testEvents.push(event.id);

		expect(event.recurrenceRule).toEqual({
			frequency: "daily",
			interval: 1,
		});
	});

	it("should get event by id", async () => {
		const created = await eventRepository.createEvent({
			title: "Evento test",
			startTime: "2026-06-01T10:00:00Z",
		});
		testEvents.push(created.id);

		const event = await eventRepository.getEventById(created.id);
		expect(event).not.toBeNull();
		expect(event?.title).toBe("Evento test");
	});

	it("should return null for non-existent event", async () => {
		const event = await eventRepository.getEventById(
			"00000000-0000-0000-0000-000000000000",
		);
		expect(event).toBeNull();
	});

	it("should update an event", async () => {
		const created = await eventRepository.createEvent({
			title: "Original",
			startTime: "2026-06-01T10:00:00Z",
		});
		testEvents.push(created.id);

		const updated = await eventRepository.updateEvent(created.id, {
			title: "Actualizado",
			location: "Sala B",
		});

		expect(updated.title).toBe("Actualizado");
		expect(updated.location).toBe("Sala B");
	});

	it("should transition event status", async () => {
		const created = await eventRepository.createEvent({
			title: "A completar",
			startTime: "2026-06-01T10:00:00Z",
		});
		testEvents.push(created.id);

		const updated = await eventRepository.transitionEventStatus(
			created.id,
			"completed" as never,
		);

		expect(updated.status).toBe("completed");
	});

	it("should get events by date range", async () => {
		const e1 = await eventRepository.createEvent({
			title: "Evento en rango",
			startTime: "2026-06-15T10:00:00Z",
		});
		testEvents.push(e1.id);

		const e2 = await eventRepository.createEvent({
			title: "Evento fuera de rango",
			startTime: "2026-07-15T10:00:00Z",
		});
		testEvents.push(e2.id);

		const events = await eventRepository.getEventsByDateRange(
			new Date("2026-06-01T00:00:00Z"),
			new Date("2026-06-30T23:59:59Z"),
		);

		expect(events.some((e) => e.id === e1.id)).toBe(true);
		expect(events.some((e) => e.id === e2.id)).toBe(false);
	});

	it("should create exception for recurring event", async () => {
		const parent = await eventRepository.createEvent({
			title: "Evento recurrente",
			startTime: "2026-06-01T10:00:00Z",
			recurrenceRule: { frequency: "weekly", interval: 1 },
		});
		testEvents.push(parent.id);

		const exception = await eventRepository.createEvent({
			title: "Evento recurrente",
			startTime: "2026-06-08T14:00:00Z",
			parentId: parent.id,
			isException: true,
			exceptionDate: "2026-06-08T10:00:00Z",
		});
		testEvents.push(exception.id);

		expect(exception.isException).toBe(true);
		expect(exception.parentId).toBe(parent.id);
		expect(exception.exceptionDate?.toISOString()).toBe(
			new Date("2026-06-08T10:00:00Z").toISOString(),
		);
	});

	it("should link task to event", async () => {
		const event = await eventRepository.createEvent({
			title: "Evento con tarea",
			startTime: "2026-06-01T10:00:00Z",
		});
		testEvents.push(event.id);

		const task = await prisma.task.create({
			data: {
				title: "Tarea vinculada",
			},
		});
		testTaskId.push(task.id);

		await eventRepository.linkTaskToEvent(task.id, event.id);

		const linkedTasks = await eventRepository.getLinkedTasks(event.id);
		expect(linkedTasks.some((t: { id: string }) => t.id === task.id)).toBe(
			true,
		);

		const linkedEvents = await eventRepository.getLinkedEvents(task.id);
		expect(linkedEvents.some((e) => e.id === event.id)).toBe(true);
	});

	it("should unlink task from event", async () => {
		const event = await eventRepository.createEvent({
			title: "Evento",
			startTime: "2026-06-01T10:00:00Z",
		});
		testEvents.push(event.id);

		const task = await prisma.task.create({
			data: { title: "Tarea" },
		});
		testTaskId.push(task.id);

		await eventRepository.linkTaskToEvent(task.id, event.id);
		await eventRepository.unlinkTaskFromEvent(task.id, event.id);

		const linkedTasks = await eventRepository.getLinkedTasks(event.id);
		expect(linkedTasks.length).toBe(0);
	});
});
