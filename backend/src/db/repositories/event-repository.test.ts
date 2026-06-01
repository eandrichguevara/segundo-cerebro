import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		event: {
			create: vi.fn(),
			findUnique: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
		},
		taskEventLink: {
			create: vi.fn(),
			deleteMany: vi.fn(),
			findMany: vi.fn(),
		},
		task: {
			create: vi.fn(),
		},
	},
}));

const mockEvent = {
	id: "event-1",
	title: "Reunión de equipo",
	description: "Revisión semanal",
	location: "Sala A",
	category: "trabajo",
	startTime: new Date("2026-06-01T10:00:00Z"),
	endTime: new Date("2026-06-01T11:00:00Z"),
	status: "active",
	recurrenceRule: null,
	parentId: null,
	isException: false,
	exceptionDate: null,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	cancelledAt: null,
};

const mockRecurringEvent = {
	...mockEvent,
	recurrenceRule: { frequency: "daily", interval: 1 },
};

const mockExceptionEvent = {
	...mockEvent,
	id: "event-2",
	title: "Evento recurrente",
	startTime: new Date("2026-06-08T14:00:00Z"),
	isException: true,
	parentId: "event-1",
	exceptionDate: new Date("2026-06-08T10:00:00Z"),
};

describe("event repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createEvent", () => {
		it("should create an event", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.event.create).mockResolvedValue(mockEvent);
			const { createEvent } = await import("./event-repository.js");

			const result = await createEvent({
				title: "Reunión de equipo",
				description: "Revisión semanal",
				location: "Sala A",
				category: "trabajo",
				startTime: "2026-06-01T10:00:00Z",
				endTime: "2026-06-01T11:00:00Z",
			});

			expect(prisma.event.create).toHaveBeenCalledWith({
				data: {
					title: "Reunión de equipo",
					description: "Revisión semanal",
					location: "Sala A",
					category: "trabajo",
					startTime: new Date("2026-06-01T10:00:00Z"),
					endTime: new Date("2026-06-01T11:00:00Z"),
					recurrenceRule: Prisma.JsonNull,
					parentId: null,
					isException: false,
					exceptionDate: null,
				},
			});
			expect(result.title).toBe("Reunión de equipo");
			expect(result.description).toBe("Revisión semanal");
			expect(result.location).toBe("Sala A");
			expect(result.category).toBe("trabajo");
			expect(result.status).toBe("active");
		});

		it("should create a recurring event", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.event.create).mockResolvedValue(mockRecurringEvent);
			const { createEvent } = await import("./event-repository.js");

			const result = await createEvent({
				title: "Daily standup",
				startTime: "2026-06-01T09:00:00Z",
				endTime: "2026-06-01T09:15:00Z",
				recurrenceRule: {
					frequency: "daily",
					interval: 1,
				},
			});

			expect(prisma.event.create).toHaveBeenCalledWith({
				data: {
					title: "Daily standup",
					description: null,
					location: null,
					category: null,
					startTime: new Date("2026-06-01T09:00:00Z"),
					endTime: new Date("2026-06-01T09:15:00Z"),
					recurrenceRule: { frequency: "daily", interval: 1 },
					parentId: null,
					isException: false,
					exceptionDate: null,
				},
			});
			expect(result.recurrenceRule).toEqual({
				frequency: "daily",
				interval: 1,
			});
		});
	});

	describe("getEventById", () => {
		it("should get event by id", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.event.findUnique).mockResolvedValue(mockEvent);
			const { getEventById } = await import("./event-repository.js");

			const result = await getEventById("event-1");

			expect(prisma.event.findUnique).toHaveBeenCalledWith({
				where: { id: "event-1" },
			});
			expect(result).not.toBeNull();
			expect(result?.title).toBe("Reunión de equipo");
		});

		it("should return null for non-existent event", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.event.findUnique).mockResolvedValue(null);
			const { getEventById } = await import("./event-repository.js");

			const result = await getEventById("00000000-0000-0000-0000-000000000000");

			expect(result).toBeNull();
		});
	});

	describe("updateEvent", () => {
		it("should update an event", async () => {
			const { prisma } = await import("../index.js");
			const updatedEvent = {
				...mockEvent,
				title: "Actualizado",
				location: "Sala B",
			};
			vi.mocked(prisma.event.update).mockResolvedValue(updatedEvent);
			const { updateEvent } = await import("./event-repository.js");

			const result = await updateEvent("event-1", {
				title: "Actualizado",
				location: "Sala B",
			});

			expect(prisma.event.update).toHaveBeenCalledWith({
				where: { id: "event-1" },
				data: {
					title: "Actualizado",
					location: "Sala B",
				},
			});
			expect(result.title).toBe("Actualizado");
			expect(result.location).toBe("Sala B");
		});
	});

	describe("transitionEventStatus", () => {
		it("should transition event status", async () => {
			const { prisma } = await import("../index.js");
			const completedEvent = { ...mockEvent, status: "completed" };
			vi.mocked(prisma.event.update).mockResolvedValue(completedEvent);
			const { transitionEventStatus } = await import("./event-repository.js");

			const result = await transitionEventStatus("event-1", "completed");

			expect(prisma.event.update).toHaveBeenCalledWith({
				where: { id: "event-1" },
				data: { status: "completed" },
			});
			expect(result.status).toBe("completed");
		});
	});

	describe("getEventsByDateRange", () => {
		it("should get events by date range", async () => {
			const { prisma } = await import("../index.js");
			const e1 = { ...mockEvent, id: "event-1" };
			const e2 = {
				...mockEvent,
				id: "event-2",
				title: "Evento fuera de rango",
				startTime: new Date("2026-07-15T10:00:00Z"),
			};
			vi.mocked(prisma.event.findMany).mockResolvedValue([e1]);
			const { getEventsByDateRange } = await import("./event-repository.js");

			const result = await getEventsByDateRange(
				new Date("2026-06-01T00:00:00Z"),
				new Date("2026-06-30T23:59:59Z"),
			);

			expect(prisma.event.findMany).toHaveBeenCalledWith({
				where: {
					status: "active",
					startTime: {
						gte: new Date("2026-06-01T00:00:00Z"),
						lte: new Date("2026-06-30T23:59:59Z"),
					},
				},
				orderBy: { startTime: "asc" },
			});
			expect(result.some((e) => e.id === "event-1")).toBe(true);
			expect(result.some((e) => e.id === "event-2")).toBe(false);
		});
	});

	describe("createException", () => {
		it("should create exception for recurring event", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.event.create).mockResolvedValue(mockExceptionEvent);
			const { createEvent } = await import("./event-repository.js");

			const result = await createEvent({
				title: "Evento recurrente",
				startTime: "2026-06-08T14:00:00Z",
				parentId: "event-1",
				isException: true,
				exceptionDate: "2026-06-08T10:00:00Z",
			});

			expect(prisma.event.create).toHaveBeenCalledWith({
				data: {
					title: "Evento recurrente",
					description: null,
					location: null,
					category: null,
					startTime: new Date("2026-06-08T14:00:00Z"),
					endTime: null,
					recurrenceRule: Prisma.JsonNull,
					parentId: "event-1",
					isException: true,
					exceptionDate: new Date("2026-06-08T10:00:00Z"),
				},
			});
			expect(result.isException).toBe(true);
			expect(result.parentId).toBe("event-1");
		});
	});
});
