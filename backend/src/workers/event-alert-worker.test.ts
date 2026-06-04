import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: { TIMEZONE: "America/Santiago" },
}));

vi.mock("../config/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock("../config/current-time.js", () => ({
	formatDateInTimezone: vi.fn().mockReturnValue("2026-06-04"),
	formatTimeInTimezone: vi.fn().mockReturnValue("10:00"),
}));

vi.mock("../db/repositories/device-repository.js", () => ({
	getAllTokens: vi.fn().mockResolvedValue(["token-1"]),
	removeToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/repositories/entity-link-repository.js", () => ({
	getLinksFor: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/event-repository.js", () => ({
	getActiveEventsInProgress: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/list-repository.js", () => ({
	getListById: vi.fn().mockResolvedValue(null),
	getItems: vi.fn().mockReturnValue([]),
}));

vi.mock("../db/repositories/task-repository.js", () => ({
	getTaskById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/repositories/objective-repository.js", () => ({
	getObjectiveById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/repositories/project-repository.js", () => ({
	getProjectById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../db/repositories/idea-repository.js", () => ({
	getIdeaById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../domain/event.js", () => ({
	generateRecurrenceInstances: vi.fn().mockReturnValue([]),
}));

vi.mock("../notifications/fcm.js", () => ({
	sendNotification: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
}));

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: "evt-1",
		title: "Trabajar en proyecto X",
		description: "Sesión de desarrollo",
		startTime: new Date(Date.now() - 3_600_000),
		endTime: new Date(Date.now() + 3_600_000),
		location: "Oficina",
		category: "trabajo",
		status: "active",
		recurrenceRule: null,
		...overrides,
	};
}

describe("event-alert-worker", () => {
	afterEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("sends notification for an active event", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(sendNotification)).toHaveBeenCalledWith(
			"token-1",
			expect.objectContaining({
				title: "📅 Trabajar en proyecto X",
				sendNotification: true,
			}),
		);
	});

	it("does not resend on second poll for same event", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		await pollActiveEventsOnce();
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);
	});

	it("sends cancel when event becomes inactive", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		const activeEvent = makeEvent();
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			activeEvent as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");

		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(sendNotification)).toHaveBeenLastCalledWith(
			"token-1",
			expect.objectContaining({ sendNotification: true }),
		);

		vi.mocked(getActiveEventsInProgress).mockResolvedValue([]);
		await pollActiveEventsOnce();

		const calls = vi.mocked(sendNotification).mock.calls;
		const cancelCall = calls.find(
			(c) => (c[1] as Record<string, unknown>).sendNotification === false,
		);
		expect(cancelCall).toBeDefined();
		expect(cancelCall?.[1]).toEqual(
			expect.objectContaining({
				title: "",
				body: "",
				data: expect.objectContaining({ type: "event_notification_cancel" }),
				sendNotification: false,
			}),
		);
	});

	it("includes linked list with items in payload", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		vi.mocked(getLinksFor).mockResolvedValue([
			{
				id: "link-1",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "list",
				targetId: "list-1",
				relation: "part_of",
				note: "Lista de compra",
				createdAt: new Date(),
			},
		]);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Compra supermercado",
			description: "Cosas del día",
			status: "active",
			type: "shopping",
		} as never);
		vi.mocked(getItems).mockReturnValue([
			{ content: "2 kg arroz", checked: false, quantity: "2 kg" },
			{ content: "pan", checked: true, quantity: undefined },
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const data = (call[1] as Record<string, unknown>).data as Record<
			string,
			string
		>;
		const links = JSON.parse(data.links);

		expect(links).toHaveLength(1);
		expect(links[0]).toEqual(
			expect.objectContaining({
				id: "list-1",
				type: "list",
				title: "Compra supermercado",
				relation: "part_of",
				note: "Lista de compra",
				items: [
					{ content: "2 kg arroz", checked: false, quantity: "2 kg" },
					{ content: "pan", checked: true, quantity: undefined },
				],
			}),
		);
	});

	it("includes linked task with priority and status", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		vi.mocked(getLinksFor).mockResolvedValue([
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "task",
				targetId: "task-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getTaskById } = await import(
			"../db/repositories/task-repository.js"
		);
		vi.mocked(getTaskById).mockResolvedValue({
			id: "task-1",
			title: "Revisar PRs",
			description: "PRs del backend",
			status: "in_progress",
			priority: "high",
			dueDate: new Date("2026-06-05T00:00:00Z"),
		} as never);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const data = (call[1] as Record<string, unknown>).data as Record<
			string,
			string
		>;
		const links = JSON.parse(data.links);

		expect(links[0]).toEqual(
			expect.objectContaining({
				id: "task-1",
				type: "task",
				title: "Revisar PRs",
				description: "PRs del backend",
				status: "in_progress",
				priority: "high",
				deadline: "2026-06-05T00:00:00.000Z",
			}),
		);
	});

	it("includes event description in payload", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const data = (call[1] as Record<string, unknown>).data as Record<
			string,
			string
		>;
		const event = JSON.parse(data.event);

		expect(event).toEqual(
			expect.objectContaining({
				id: "evt-1",
				title: "Trabajar en proyecto X",
				description: "Sesión de desarrollo",
				location: "Oficina",
				category: "trabajo",
			}),
		);
	});
});
