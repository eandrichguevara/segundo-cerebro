import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		TIMEZONE: "America/Santiago",
		EVENT_NOTIFICATION_REFRESH_MS: 300_000,
	},
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
		vi.useRealTimers();
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

	it("includes list summary in notification body", async () => {
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
				note: null,
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
		const payload = call[1] as Record<string, string>;

		expect(payload.body).toContain("📋 Compra supermercado (1/2)");
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

	it("includes multiple linked lists in notification body", async () => {
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
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "list",
				targetId: "list-2",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById)
			.mockResolvedValueOnce({
				id: "list-1",
				title: "Compras",
				description: null,
				status: "active",
				type: "shopping",
			} as never)
			.mockResolvedValueOnce({
				id: "list-2",
				title: "Pendientes",
				description: null,
				status: "active",
				type: "general",
			} as never);
		vi.mocked(getItems)
			.mockReturnValueOnce([
				{ content: "leche", checked: true, quantity: undefined },
				{ content: "huevos", checked: false, quantity: undefined },
			])
			.mockReturnValueOnce([
				{ content: "pagar cuentas", checked: false, quantity: undefined },
			]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const payload = call[1] as Record<string, string>;

		expect(payload.body).toContain("📋 Compras (1/2)");
		expect(payload.body).toContain("📋 Pendientes (0/1)");
	});

	it("includes empty list summary in notification body", async () => {
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
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Vacía",
			description: null,
			status: "active",
			type: "general",
		} as never);
		vi.mocked(getItems).mockReturnValue([]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const payload = call[1] as Record<string, string>;

		expect(payload.body).toContain("📋 Vacía (0/0)");
	});

	it("truncates list items in data payload but shows full count in body", async () => {
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
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Lista grande",
			description: null,
			status: "active",
			type: "general",
		} as never);

		const items = Array.from({ length: 20 }, (_, i) => ({
			content: `Item ${i + 1}`,
			checked: i < 12,
			quantity: undefined,
		}));
		vi.mocked(getItems).mockReturnValue(items);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		const call = vi.mocked(sendNotification).mock.calls[0];
		const payload = call[1] as Record<string, string>;

		// Body shows full count (12 checked out of 20)
		expect(payload.body).toContain("📋 Lista grande (12/20)");

		// Data payload has truncated items (15 + 1 truncation marker)
		const p = call[1] as Record<string, unknown>;
		const dataPayload = p.data as Record<string, string>;
		const links = JSON.parse(dataPayload.links) as Array<
			Record<string, unknown>
		>;
		expect(links[0].items).toHaveLength(16);
		expect((links[0].items as Array<Record<string, unknown>>)[15]).toEqual(
			expect.objectContaining({ content: "... y 5 más" }),
		);
	});

	it("excludes non-list linked entities from notification body", async () => {
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
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
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

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Compras",
			description: null,
			status: "active",
			type: "shopping",
		} as never);
		vi.mocked(getItems).mockReturnValue([
			{ content: "pan", checked: false, quantity: undefined },
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
		const payload = call[1] as Record<string, string>;

		// Body has list summary but NOT task info
		expect(payload.body).toContain("📋 Compras (0/1)");
		expect(payload.body).not.toContain("Revisar PRs");
		expect(payload.body).not.toContain("🔴");

		// Data payload has both entities
		const dataPayload = (call[1] as Record<string, unknown>).data as Record<
			string,
			string
		>;
		const links = JSON.parse(dataPayload.links) as Array<
			Record<string, unknown>
		>;
		expect(links).toHaveLength(2);
	});

	it("sends no notification when no FCM tokens are registered", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { getAllTokens } = await import(
			"../db/repositories/device-repository.js"
		);
		vi.mocked(getAllTokens).mockResolvedValue([]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).not.toHaveBeenCalled();

		// Restore default implementation for subsequent tests
		vi.mocked(getAllTokens).mockResolvedValue(["token-1"]);
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

	it("refreshes notification after refresh interval elapses", async () => {
		vi.useFakeTimers();

		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");

		// First poll: sends initial notification
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Advance time past the refresh interval (300000ms)
		vi.advanceTimersByTime(300_001);

		// Second poll: should refresh due to elapsed interval
		await pollActiveEventsOnce();
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(2);

		vi.useRealTimers();
	});

	it("refreshes with updated linked entities", async () => {
		vi.useFakeTimers();

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
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Compras",
			description: null,
			status: "active",
			type: "shopping",
		} as never);

		// First poll: items mostly unchecked
		vi.mocked(getItems).mockReturnValue([
			{ content: "leche", checked: false, quantity: undefined },
			{ content: "huevos", checked: false, quantity: undefined },
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Verify first payload shows (0/2)
		const firstPayload = vi.mocked(sendNotification).mock.calls[0][1] as Record<
			string,
			string
		>;
		expect(firstPayload.body).toContain("📋 Compras (0/2)");

		// Update linked entity state between refreshes
		vi.mocked(getItems).mockReturnValue([
			{ content: "leche", checked: true, quantity: undefined },
			{ content: "huevos", checked: true, quantity: undefined },
		]);

		// Advance past refresh interval
		vi.advanceTimersByTime(300_001);

		// Second poll: should refresh with updated data
		await pollActiveEventsOnce();
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(2);

		const secondPayload = vi.mocked(sendNotification).mock
			.calls[1][1] as Record<string, string>;
		expect(secondPayload.body).toContain("📋 Compras (2/2)");

		vi.useRealTimers();
	});

	it("sends notifications for multiple active events independently", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-1" }) as never,
			makeEvent({ id: "evt-2", title: "Reunión semanal" }) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		// Two events × one token = 2 FCM calls
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(2);

		// Each event gets its own notification title
		expect(vi.mocked(sendNotification)).toHaveBeenCalledWith(
			"token-1",
			expect.objectContaining({ title: "📅 Trabajar en proyecto X" }),
		);
		expect(vi.mocked(sendNotification)).toHaveBeenCalledWith(
			"token-1",
			expect.objectContaining({ title: "📅 Reunión semanal" }),
		);
	});

	it("handles dynamic event lifecycle across polls", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-1" }) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Second poll: new event appears, old event still active
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-1" }) as never,
			makeEvent({ id: "evt-2", title: "Nuevo evento" }) as never,
		]);
		await pollActiveEventsOnce();
		// evt-1 already sent (no refresh due), evt-2 new → sends
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(2);

		// Third poll: old event disappears, evt-2 remains
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-2", title: "Nuevo evento" }) as never,
		]);
		await pollActiveEventsOnce();
		// evt-1 should be cancelled, evt-2 already sent (no refresh due)
		const cancelCalls = vi
			.mocked(sendNotification)
			.mock.calls.filter(
				(c) => (c[1] as Record<string, unknown>).sendNotification === false,
			);
		expect(cancelCalls).toHaveLength(1);
		const cancelData = cancelCalls[0][1] as Record<string, unknown>;
		expect(cancelData.data).toEqual(
			expect.objectContaining({
				type: "event_notification_cancel",
				event_id: "evt-1",
			}),
		);

		// Fourth poll: no activity at all
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([]);
		await pollActiveEventsOnce();
		// evt-2 should also be cancelled
		const cancelCallsAfter = vi
			.mocked(sendNotification)
			.mock.calls.filter(
				(c) => (c[1] as Record<string, unknown>).sendNotification === false,
			);
		expect(cancelCallsAfter).toHaveLength(2);
	});

	it("handles FCM token failure on refresh and removes invalid token", async () => {
		vi.useFakeTimers();

		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");

		// First poll: token valid → succeeds
		const { sendNotification } = await import("../notifications/fcm.js");
		vi.mocked(sendNotification).mockResolvedValue({
			ok: true,
			value: undefined,
		});
		await pollActiveEventsOnce();
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Second poll (refresh): token invalid → fails
		vi.mocked(sendNotification).mockResolvedValue({
			ok: false,
			error: "INVALID_TOKEN",
		});
		vi.advanceTimersByTime(300_001);
		await pollActiveEventsOnce();

		// Failed token should be removed
		const { removeToken } = await import(
			"../db/repositories/device-repository.js"
		);
		expect(vi.mocked(removeToken)).toHaveBeenCalledWith("token-1");

		vi.useRealTimers();
	});

	it("recovers from getLinksFor error without corrupting timestamp state", async () => {
		vi.useFakeTimers();

		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");

		// First poll: getLinksFor succeeds
		vi.mocked(getLinksFor).mockResolvedValue([]);
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Second poll (refresh): getLinksFor throws
		vi.mocked(getLinksFor).mockRejectedValue(new Error("DB connection lost"));
		vi.advanceTimersByTime(300_001);
		await pollActiveEventsOnce();

		// Notification should NOT have been sent again (error was caught)
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(1);

		// Error should be logged
		const { logger } = await import("../config/logger.js");
		expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.any(Error) }),
			"Error polling active events",
		);

		// Third poll (another refresh): getLinksFor succeeds again → should send
		vi.mocked(getLinksFor).mockResolvedValue([]);
		vi.advanceTimersByTime(300_001);
		await pollActiveEventsOnce();

		// Notification sent again after recovery
		expect(vi.mocked(sendNotification)).toHaveBeenCalledTimes(2);

		vi.useRealTimers();
	});

	it("does not send notification for an event that already ended", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({
				// endTime in the past: still returned by DB but not active
				endTime: new Date(Date.now() - 60_000),
			}) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).not.toHaveBeenCalled();
	});
});
