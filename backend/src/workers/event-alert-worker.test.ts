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

vi.mock("../api/ws.js", () => ({
	broadcastAuthenticated: vi.fn().mockReturnValue(1),
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

	it("sends chat message on first activation", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		// text + display = 2 calls
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// First call: text message
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;
		expect(textCall.type).toBe("text");
		expect(textCall.content).toContain("Trabajar en proyecto X");
		expect(textCall.content).toContain("10:00");

		// Second call: display entities
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		expect(displayCall.type).toBe("display");
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(1);
		expect(entities[0]).toMatchObject({
			type: "event",
			title: "Trabajar en proyecto X",
			location: "Oficina",
			category: "trabajo",
		});
	});

	it("does not send chat message on refresh", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");

		// First poll: sends 2 chat messages (text + display)
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// Second poll: refresh only, no chat messages
		await pollActiveEventsOnce();
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);
	});

	it("sends chat message with linked entities display", async () => {
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
				targetType: "task",
				targetId: "task-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "list",
				targetId: "list-1",
				relation: "part_of",
				note: "Lista asociada",
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
			{ content: "leche", checked: false, quantity: undefined },
			{ content: "huevos", checked: true, quantity: undefined },
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");

		// text message should mention linked entities summary
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;
		expect(textCall.type).toBe("text");
		expect(textCall.content).toContain("Trabajar en proyecto X");
		expect(textCall.content).toContain("tarea");

		// display message should include event + linked entities
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		expect(displayCall.type).toBe("display");
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(3); // event + task + list

		// First entity is the event
		expect(entities[0]).toMatchObject({
			type: "event",
			title: "Trabajar en proyecto X",
		});

		// Second entity is the linked task
		expect(entities[1]).toMatchObject({
			type: "task",
			title: "Revisar PRs",
			status: "in_progress",
			priority: "high",
		});

		// Third entity is the linked list
		expect(entities[2]).toMatchObject({
			type: "list",
			title: "Compras",
		});
	});

	it("sends chat message for each new event independently", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-1" }) as never,
			makeEvent({ id: "evt-2", title: "Reunión semanal" }) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		// 2 events × 2 messages (text + display) = 4 calls
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(4);

		// Verify both events appear in text messages
		const textMessages = vi
			.mocked(broadcastAuthenticated)
			.mock.calls.filter(
				(c) => (c[0] as Record<string, unknown>).type === "text",
			)
			.map((c) => (c[0] as Record<string, unknown>).content as string);
		expect(textMessages).toHaveLength(2);
		expect(textMessages[0]).toContain("Trabajar en proyecto X");
		expect(textMessages[1]).toContain("Reunión semanal");
	});

	it("still sends chat message when no FCM tokens registered", async () => {
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

		// FCM not sent (no tokens)
		const { sendNotification } = await import("../notifications/fcm.js");
		expect(vi.mocked(sendNotification)).not.toHaveBeenCalled();

		// Chat message still sent (WS is independent)
		const { broadcastAuthenticated } = await import("../api/ws.js");
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// Restore default
		vi.mocked(getAllTokens).mockResolvedValue(["token-1"]);
	});

	it("sends chat message for event without linked entities", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		// Explicitly set getLinksFor to empty (avoids cross-test contamination)
		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		vi.mocked(getLinksFor).mockResolvedValue([]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// Text should not contain entity summary
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;
		expect(textCall.type).toBe("text");
		expect(textCall.content).toContain("Trabajar en proyecto X");
		expect(textCall.content).not.toContain("tarea");
		expect(textCall.content).not.toContain("lista");
		expect(textCall.content).not.toContain("objetivo");

		// Display should only have the event entity
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(1);
		expect(entities[0]).toMatchObject({
			type: "event",
			title: "Trabajar en proyecto X",
		});
	});

	it("sends chat message for event without endTime", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({
				endTime: null,
			}) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;

		expect(entities[0]).toMatchObject({
			type: "event",
			title: "Trabajar en proyecto X",
		});
		// endTime should not be present in the display
		expect(entities[0]).not.toHaveProperty("endTime");
	});

	it("sends chat message for event without location and category", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({
				location: null,
				category: null,
			}) as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;

		// Text should not contain location or category lines
		expect(textCall.content).toContain("Trabajar en proyecto X");
		expect(textCall.content).not.toContain("📍");
		expect(textCall.content).not.toContain("#");

		// Display should not have location or category
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities[0]).not.toHaveProperty("location");
		expect(entities[0]).not.toHaveProperty("category");
	});

	it("does not crash when broadcast returns 0 (no WS clients connected)", async () => {
		const { broadcastAuthenticated } = await import("../api/ws.js");
		vi.mocked(broadcastAuthenticated).mockReturnValue(0);

		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await expect(pollActiveEventsOnce()).resolves.toBeUndefined();

		// Should still have been called (just returned 0)
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// Restore default
		vi.mocked(broadcastAuthenticated).mockReturnValue(1);
	});

	it("sends chat message with all entity types in display", async () => {
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
				targetType: "task",
				targetId: "task-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "list",
				targetId: "list-1",
				relation: "part_of",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-3",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "objective",
				targetId: "obj-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-4",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "project",
				targetId: "proj-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-5",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "idea",
				targetId: "idea-1",
				relation: "inspired_by",
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
			description: null,
			status: "pending",
			priority: "high",
			dueDate: null,
		} as never);

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
		vi.mocked(getItems).mockReturnValue([]);

		const { getObjectiveById } = await import(
			"../db/repositories/objective-repository.js"
		);
		vi.mocked(getObjectiveById).mockResolvedValue({
			id: "obj-1",
			title: "Aprender TypeScript",
			description: null,
			status: "active",
			deadline: null,
		} as never);

		const { getProjectById } = await import(
			"../db/repositories/project-repository.js"
		);
		vi.mocked(getProjectById).mockResolvedValue({
			id: "proj-1",
			title: "Rediseño web",
			description: null,
			status: "active",
			category: "trabajo",
			deadline: null,
		} as never);

		const { getIdeaById } = await import(
			"../db/repositories/idea-repository.js"
		);
		vi.mocked(getIdeaById).mockResolvedValue({
			id: "idea-1",
			title: "App de meditación",
			description: null,
			status: "evaluating",
			tags: ["salud", "bienestar"],
		} as never);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;

		// Event + 5 linked entities = 6 total
		expect(entities).toHaveLength(6);

		// Verify entity types and order
		expect(entities[0]).toMatchObject({ type: "event" });
		expect(entities[1]).toMatchObject({ type: "task", title: "Revisar PRs" });
		expect(entities[2]).toMatchObject({ type: "list", title: "Compras" });
		expect(entities[3]).toMatchObject({
			type: "objective",
			title: "Aprender TypeScript",
		});
		expect(entities[4]).toMatchObject({
			type: "project",
			title: "Rediseño web",
		});
		expect(entities[5]).toMatchObject({
			type: "idea",
			title: "App de meditación",
			tags: ["salud", "bienestar"],
		});
	});

	it("chat text uses correct singular and plural forms", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({ id: "evt-1" }) as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		// Two tasks + one list
		vi.mocked(getLinksFor).mockResolvedValue([
			{
				id: "link-1",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "task",
				targetId: "task-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "task",
				targetId: "task-2",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-3",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "list",
				targetId: "list-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getTaskById } = await import(
			"../db/repositories/task-repository.js"
		);
		vi.mocked(getTaskById)
			.mockResolvedValueOnce({
				id: "task-1",
				title: "Tarea 1",
				description: null,
				status: "pending",
				priority: "medium",
				dueDate: null,
			} as never)
			.mockResolvedValueOnce({
				id: "task-2",
				title: "Tarea 2",
				description: null,
				status: "pending",
				priority: "low",
				dueDate: null,
			} as never);

		const { getListById, getItems } = await import(
			"../db/repositories/list-repository.js"
		);
		vi.mocked(getListById).mockResolvedValue({
			id: "list-1",
			title: "Lista",
			description: null,
			status: "active",
			type: "general",
		} as never);
		vi.mocked(getItems).mockReturnValue([]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;

		// 2 tareas (plural) + 1 lista (singular) → "Tiene 2 tareas, 1 lista relacionadas."
		const content = textCall.content as string;
		expect(content).toContain("2 tareas");
		expect(content).toContain("1 lista");
		expect(content).toContain("relacionadas.");
	});

	it("chat text excludes projects and ideas from summary text", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({
				id: "evt-1",
				title: "Revisión trimestral",
			}) as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		vi.mocked(getLinksFor).mockResolvedValue([
			{
				id: "link-1",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "project",
				targetId: "proj-1",
				relation: "related",
				note: null,
				createdAt: new Date(),
			},
			{
				id: "link-2",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "idea",
				targetId: "idea-1",
				relation: "inspired_by",
				note: null,
				createdAt: new Date(),
			},
		]);

		const { getProjectById } = await import(
			"../db/repositories/project-repository.js"
		);
		vi.mocked(getProjectById).mockResolvedValue({
			id: "proj-1",
			title: "Rediseño web",
			description: null,
			status: "active",
			category: null,
			deadline: null,
		} as never);

		const { getIdeaById } = await import(
			"../db/repositories/idea-repository.js"
		);
		vi.mocked(getIdeaById).mockResolvedValue({
			id: "idea-1",
			title: "App de meditación",
			description: null,
			status: "evaluating",
			tags: [],
		} as never);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;

		// Text should NOT mention projects or ideas
		const content = textCall.content as string;
		expect(content).not.toContain("proyecto");
		expect(content).not.toContain("idea");

		// But display still includes them
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(3); // event + project + idea
		expect(entities[1]).toMatchObject({ type: "project" });
		expect(entities[2]).toMatchObject({ type: "idea" });
	});

	it("includes list items with quantities in display message", async () => {
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
			title: "Supermercado",
			description: null,
			status: "active",
			type: "shopping",
		} as never);
		vi.mocked(getItems).mockReturnValue([
			{ content: "2 kg arroz", checked: false, quantity: "2 kg" },
			{ content: "pan", checked: true, quantity: undefined },
			{ content: "leche", checked: false, quantity: "1 L" },
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;

		expect(entities).toHaveLength(2); // event + list
		expect(entities[1]).toMatchObject({
			type: "list",
			title: "Supermercado",
		});

		const listEntity = entities[1] as Record<string, unknown>;
		const items = listEntity.items as Array<Record<string, unknown>>;
		expect(items).toHaveLength(3);
		expect(items[0]).toEqual({
			content: "2 kg arroz",
			checked: false,
			quantity: "2 kg",
		});
		expect(items[1]).toEqual({
			content: "pan",
			checked: true,
		});
		expect(items[2]).toEqual({
			content: "leche",
			checked: false,
			quantity: "1 L",
		});
	});

	it("sends chat message for event with recurrence rule", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent({
				id: "evt-1",
				recurrenceRule: { frequency: "weekly", interval: 1 },
			}) as never,
		]);

		// Make the recurring event active by returning an instance spanning now
		const { generateRecurrenceInstances } = await import("../domain/event.js");
		const now = new Date();
		vi.mocked(generateRecurrenceInstances).mockReturnValue([
			{
				start: new Date(now.getTime() - 3_600_000),
				end: new Date(now.getTime() + 3_600_000),
			},
		]);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;

		expect(entities[0]).toMatchObject({
			type: "event",
			title: "Trabajar en proyecto X",
		});
		expect(entities[0]).toHaveProperty("recurrence");
		expect((entities[0] as Record<string, unknown>).recurrence).toBe("weekly");
	});

	it("sends chat message when event is link target (bidirectional links)", async () => {
		const { getActiveEventsInProgress } = await import(
			"../db/repositories/event-repository.js"
		);
		vi.mocked(getActiveEventsInProgress).mockResolvedValue([
			makeEvent() as never,
		]);

		const { getLinksFor } = await import(
			"../db/repositories/entity-link-repository.js"
		);
		// Link where event is the TARGET, not the source
		vi.mocked(getLinksFor).mockResolvedValue([
			{
				id: "link-1",
				sourceType: "task",
				sourceId: "task-1",
				targetType: "event",
				targetId: "evt-1",
				relation: "related",
				note: "Tarea vinculada",
				createdAt: new Date(),
			},
		]);

		const { getTaskById } = await import(
			"../db/repositories/task-repository.js"
		);
		vi.mocked(getTaskById).mockResolvedValue({
			id: "task-1",
			title: "Preparar materiales",
			description: null,
			status: "pending",
			priority: "high",
			dueDate: null,
		} as never);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");

		// Text should mention the linked task
		const textCall = vi.mocked(broadcastAuthenticated).mock
			.calls[0][0] as Record<string, unknown>;
		expect(textCall.content).toContain("tarea");

		// Display should include event + linked task
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(2);
		expect(entities[0]).toMatchObject({ type: "event" });
		expect(entities[1]).toMatchObject({
			type: "task",
			title: "Preparar materiales",
		});
	});

	it("handles partial linked entity resolution failure gracefully", async () => {
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
			{
				id: "link-3",
				sourceType: "event",
				sourceId: "evt-1",
				targetType: "objective",
				targetId: "obj-1",
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
		vi.mocked(getItems).mockReturnValue([]);

		// Task resolution throws
		const { getTaskById } = await import(
			"../db/repositories/task-repository.js"
		);
		vi.mocked(getTaskById).mockRejectedValue(new Error("DB connection lost"));

		// Objective resolves fine
		const { getObjectiveById } = await import(
			"../db/repositories/objective-repository.js"
		);
		vi.mocked(getObjectiveById).mockResolvedValue({
			id: "obj-1",
			title: "Meta trimestral",
			description: null,
			status: "active",
			deadline: null,
		} as never);

		const { pollActiveEventsOnce } = await import("./event-alert-worker.js");
		await pollActiveEventsOnce();

		const { broadcastAuthenticated } = await import("../api/ws.js");

		// Should have sent chat message despite partial failure
		expect(vi.mocked(broadcastAuthenticated)).toHaveBeenCalledTimes(2);

		// Display should include event + list + objective (task failed)
		const displayCall = vi.mocked(broadcastAuthenticated).mock
			.calls[1][0] as Record<string, unknown>;
		const entities = displayCall.entities as Array<Record<string, unknown>>;
		expect(entities).toHaveLength(3); // event + list + objective
		expect(entities[0]).toMatchObject({ type: "event" });
		expect(entities[1]).toMatchObject({ type: "list", title: "Compras" });
		expect(entities[2]).toMatchObject({
			type: "objective",
			title: "Meta trimestral",
		});

		// Verify the task error was logged
		const { logger } = await import("../config/logger.js");
		expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
			expect.objectContaining({
				otherType: "task",
				otherId: "task-1",
			}),
			"Error resolving linked entity",
		);
	});
});
