import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ws.js", () => ({
	sendToSession: vi.fn().mockReturnValue(true),
}));

vi.mock("../config/env.js", () => ({
	env: {
		JOB_MAX_ATTEMPTS: 3,
		JOB_ORPHAN_TIMEOUT_MS: 600_000,
		CONVERSATION_TURNS_LIMIT: 10,
		MEMORY_RETRIEVAL_LIMIT: 5,
		FCM_SERVICE_ACCOUNT: "./test-account.json",
	},
}));

vi.mock("../config/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("../db/repositories/conversation-repository.js", () => ({
	getRecentTurns: vi.fn().mockResolvedValue([]),
	addTurn: vi.fn().mockResolvedValue({}),
}));

vi.mock("../db/repositories/job-repository.js", () => ({
	claimJob: vi.fn().mockResolvedValue(null),
	completeJob: vi.fn().mockResolvedValue({}),
	retryJob: vi.fn().mockResolvedValue({ retried: false, reason: "TEST" }),
	releaseOrphanedJobs: vi.fn().mockResolvedValue(0),
}));

vi.mock("../db/repositories/list-repository.js", () => ({
	getAllActive: vi.fn().mockResolvedValue([]),
	getItems: vi.fn().mockReturnValue([]),
}));

vi.mock("../db/repositories/event-repository.js", () => ({
	getEventsByDateRange: vi.fn().mockResolvedValue([]),
	getRecurringEvents: vi.fn().mockResolvedValue([]),
	getEventExceptions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/memory-repository.js", () => ({
	getRelevantMemories: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/objective-repository.js", () => ({
	getActiveObjectives: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/task-repository.js", () => ({
	getActiveTasks: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/project-repository.js", () => ({
	getActiveProjects: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/repositories/idea-repository.js", () => ({
	getActiveIdeas: vi.fn().mockResolvedValue([]),
}));

vi.mock("../llm/prompts/slow-lane-system.js", () => ({
	SLOW_LANE_SYSTEM_PROMPT: "test prompt",
}));

vi.mock("../llm/slow-lane.js", () => ({
	extractActions: vi.fn(),
}));

vi.mock("../llm/embeddings.js", () => ({
	generateEmbedding: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

vi.mock("./action-handlers.js", () => ({
	getHandler: vi.fn(),
}));

describe("workerLoop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetModules();
	});

	it("retorna una función de cleanup", async () => {
		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();
		expect(typeof stop).toBe("function");
		stop();
	});

	it("no procesa jobs cuando no hay jobs pendientes", async () => {
		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1000);

		const { claimJob } = await import("../db/repositories/job-repository.js");
		expect(vi.mocked(claimJob)).toHaveBeenCalled();

		stop();
	});
});

describe("findCreatedEntityId", () => {
	it("retorna el id cuando la acción dependiente tiene resultado exitoso con id", async () => {
		const { findCreatedEntityId } = await import("./slow-lane-processor.js");
		const result = findCreatedEntityId(
			0,
			[
				{
					ok: true,
					action: "create_event",
					correlationId: "c1",
					payload: { id: "evt-123" },
				},
			],
			[{ action: "create_event", payload: {} }],
		);
		expect(result).toBe("evt-123");
	});

	it("retorna null cuando el resultado dependiente no es ok", async () => {
		const { findCreatedEntityId } = await import("./slow-lane-processor.js");
		const result = findCreatedEntityId(
			0,
			[
				{
					ok: false,
					action: "create_event",
					correlationId: "c1",
					payload: { error: "INTERNAL_ERROR" },
				},
			],
			[{ action: "create_event", payload: {} }],
		);
		expect(result).toBeNull();
	});

	it("sube por la cadena de dependencias cuando la acción inmediata no tiene id", async () => {
		const { findCreatedEntityId } = await import("./slow-lane-processor.js");
		const result = findCreatedEntityId(
			2,
			[
				{
					ok: true,
					action: "create_task",
					correlationId: "c1",
					payload: { id: "task-1" },
				},
				{
					ok: true,
					action: "start_task",
					correlationId: "c1",
					payload: { status: "in_progress" },
				},
				{
					ok: true,
					action: "complete_task",
					correlationId: "c1",
					payload: { status: "completed" },
				},
			],
			[
				{ action: "create_task", payload: {} },
				{ action: "start_task", payload: { task_id: "<uuid>" }, depends_on: 0 },
				{
					action: "complete_task",
					payload: { task_id: "<uuid>" },
					depends_on: 1,
				},
			],
		);
		expect(result).toBe("task-1");
	});

	it("retorna null cuando no hay id en toda la cadena", async () => {
		const { findCreatedEntityId } = await import("./slow-lane-processor.js");
		const result = findCreatedEntityId(
			1,
			[
				{
					ok: true,
					action: "store_memory",
					correlationId: "c1",
					payload: { content: "ok" },
				},
				{
					ok: true,
					action: "respond",
					correlationId: "c1",
					payload: { messages: ["ok"] },
				},
			],
			[
				{ action: "store_memory", payload: {} },
				{ action: "respond", payload: {}, depends_on: 0 },
			],
		);
		expect(result).toBeNull();
	});

	it("retorna null cuando depends_on index está fuera de rango", async () => {
		const { findCreatedEntityId } = await import("./slow-lane-processor.js");
		const result = findCreatedEntityId(5, [], []);
		expect(result).toBeNull();
	});
});

describe("resolvePayloadValue", () => {
	it("reemplaza <uuid> con el ID encontrado", async () => {
		const { resolvePayloadValue } = await import("./slow-lane-processor.js");
		const result = resolvePayloadValue(
			"<uuid>",
			0,
			[
				{
					ok: true,
					action: "create_event",
					correlationId: "c1",
					payload: { id: "evt-456" },
				},
			],
			[{ action: "create_event", payload: {} }],
		);
		expect(result).toBe("evt-456");
	});

	it("retorna el mismo string si no es <uuid>", async () => {
		const { resolvePayloadValue } = await import("./slow-lane-processor.js");
		const result = resolvePayloadValue("hola-mundo", 0, [], []);
		expect(result).toBe("hola-mundo");
	});

	it("resuelve <uuid> dentro de arrays", async () => {
		const { resolvePayloadValue } = await import("./slow-lane-processor.js");
		const result = resolvePayloadValue(
			["<uuid>", "abc", "<uuid>"],
			0,
			[
				{
					ok: true,
					action: "create_task",
					correlationId: "c1",
					payload: { id: "task-99" },
				},
			],
			[{ action: "create_task", payload: {} }],
		) as string[];
		expect(result).toEqual(["task-99", "abc", "task-99"]);
	});

	it("resuelve <uuid> dentro de objetos anidados", async () => {
		const { resolvePayloadValue } = await import("./slow-lane-processor.js");
		const result = resolvePayloadValue(
			{ source_type: "event", source_id: "<uuid>", target: { id: "<uuid>" } },
			0,
			[
				{
					ok: true,
					action: "create_event",
					correlationId: "c1",
					payload: { id: "evt-789" },
				},
			],
			[{ action: "create_event", payload: {} }],
		) as Record<string, unknown>;
		expect(result).toEqual({
			source_type: "event",
			source_id: "evt-789",
			target: { id: "evt-789" },
		});
	});

	it("retorna valores primitivos sin modificar", async () => {
		const { resolvePayloadValue } = await import("./slow-lane-processor.js");
		expect(resolvePayloadValue(42, 0, [], [])).toBe(42);
		expect(resolvePayloadValue(true, 0, [], [])).toBe(true);
		expect(resolvePayloadValue(null, 0, [], [])).toBeNull();
		expect(resolvePayloadValue(undefined, 0, [], [])).toBeUndefined();
	});
});

describe("resolveUuidPlaceholder", () => {
	it("reemplaza todos los <uuid> en un payload plano", async () => {
		const { resolveUuidPlaceholder } = await import("./slow-lane-processor.js");
		const result = resolveUuidPlaceholder(
			{ task_id: "<uuid>", title: "test" },
			0,
			[
				{
					ok: true,
					action: "create_task",
					correlationId: "c1",
					payload: { id: "task-1" },
				},
			],
			[{ action: "create_task", payload: {} }],
		);
		expect(result).toEqual({ task_id: "task-1", title: "test" });
	});

	it("reemplaza <uuid> en objetos anidados", async () => {
		const { resolveUuidPlaceholder } = await import("./slow-lane-processor.js");
		const result = resolveUuidPlaceholder(
			{
				source_type: "event",
				source_id: "<uuid>",
				target_type: "list",
				target_id: "list-uuid-existente",
			},
			0,
			[
				{
					ok: true,
					action: "create_event",
					correlationId: "c1",
					payload: { id: "evt-nuevo" },
				},
			],
			[{ action: "create_event", payload: {} }],
		);
		expect(result).toEqual({
			source_type: "event",
			source_id: "evt-nuevo",
			target_type: "list",
			target_id: "list-uuid-existente",
		});
	});

	it("no modifica payloads sin <uuid>", async () => {
		const { resolveUuidPlaceholder } = await import("./slow-lane-processor.js");
		const payload = { title: "test", priority: "high" };
		const result = resolveUuidPlaceholder(payload, 0, [], []);
		expect(result).toEqual(payload);
		expect(result).not.toBe(payload); // debe ser una copia
	});

	it("no falla cuando depends_on referencia a un resultado no existente", async () => {
		const { resolveUuidPlaceholder } = await import("./slow-lane-processor.js");
		const result = resolveUuidPlaceholder(
			{ task_id: "<uuid>" },
			0,
			[],
			[{ action: "create_task", payload: {} }],
		);
		expect(result).toEqual({ task_id: null });
	});

	it("resuelve <uuid> siguiendo la cadena de depends_on", async () => {
		const { resolveUuidPlaceholder } = await import("./slow-lane-processor.js");
		const result = resolveUuidPlaceholder(
			{ task_id: "<uuid>" },
			2,
			[
				{
					ok: true,
					action: "create_task",
					correlationId: "c1",
					payload: { id: "task-final" },
				},
				{
					ok: true,
					action: "start_task",
					correlationId: "c1",
					payload: { status: "in_progress" },
				},
				{
					ok: true,
					action: "complete_task",
					correlationId: "c1",
					payload: { status: "completed" },
				},
			],
			[
				{ action: "create_task", payload: {} },
				{ action: "start_task", payload: { task_id: "<uuid>" }, depends_on: 0 },
				{
					action: "complete_task",
					payload: { task_id: "<uuid>" },
					depends_on: 1,
				},
			],
		);
		expect(result).toEqual({ task_id: "task-final" });
	});
});

describe("placeholder resolution - integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetModules();
	});

	it("resuelve <uuid> en link_entities cuando create_event antecesor tiene id", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const { claimJob } = await import("../db/repositories/job-repository.js");

		const mockJob = {
			id: "job-link-test",
			correlationId: "corr-link",
			sessionId: "sess-link",
			payload: { transcribed_text: "creá evento y vinculalo con lista" },
		};

		vi.mocked(claimJob).mockResolvedValueOnce(mockJob).mockResolvedValue(null);

		const { extractActions } = await import("../llm/slow-lane.js");
		vi.mocked(extractActions).mockResolvedValue({
			ok: true,
			value: [
				{
					action: "create_event",
					payload: { title: "Feria", start_time: "2026-06-08T10:00:00Z" },
				},
				{
					action: "link_entities",
					payload: {
						source_type: "event",
						source_id: "<uuid>",
						target_type: "list",
						target_id: "lista-existente-uuid",
						relation: "related",
					},
					depends_on: 0,
				},
				{ action: "respond", payload: { messages: ["Listo"] } },
			],
		});

		const { getHandler } = await import("./action-handlers.js");
		vi.mocked(getHandler).mockImplementation((action: string) => {
			if (action === "create_event") {
				return vi.fn().mockResolvedValue({
					ok: true,
					action: "create_event",
					correlationId: "corr-link",
					payload: { id: "evt-creado-uuid" },
				});
			}
			if (action === "link_entities") {
				return vi
					.fn()
					.mockImplementation((payload: Record<string, unknown>) => {
						// Verificar que el placeholder fue resuelto antes de llegar al handler
						expect(payload.source_id).toBe("evt-creado-uuid");
						expect(payload.target_id).toBe("lista-existente-uuid");
						return {
							ok: true,
							action: "link_entities",
							correlationId: "corr-link",
							payload: { id: "link-ok" },
						};
					});
			}
			if (action === "respond") {
				return vi.fn().mockResolvedValue({
					ok: true,
					action: "respond",
					correlationId: "corr-link",
					payload: { messages: ["Listo"] },
				});
			}
			return vi.fn().mockResolvedValue({
				ok: false,
				action,
				correlationId: "corr-link",
				payload: {},
			});
		});

		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1500);

		// Verificar que link_entities se ejecutó ok
		const calls = vi.mocked(sendToSession).mock.calls;
		const linkResult = calls.find(
			(c) => (c[1] as Record<string, unknown>).action === "link_entities",
		);
		expect(linkResult).toBeDefined();
		expect((linkResult?.[1] as Record<string, unknown>).ok).toBe(true);

		stop();
	});

	it("no reemplaza <uuid> en acciones sin depends_on", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const { claimJob } = await import("../db/repositories/job-repository.js");

		const mockJob = {
			id: "job-no-dep",
			correlationId: "corr-no-dep",
			sessionId: "sess-no-dep",
			payload: { transcribed_text: "test" },
		};

		vi.mocked(claimJob).mockResolvedValueOnce(mockJob).mockResolvedValue(null);

		const { extractActions } = await import("../llm/slow-lane.js");
		vi.mocked(extractActions).mockResolvedValue({
			ok: true,
			value: [{ action: "cancel_task", payload: { task_id: "<uuid>" } }],
		});

		const { getHandler } = await import("./action-handlers.js");
		vi.mocked(getHandler).mockImplementation((action: string) => {
			if (action === "cancel_task") {
				return vi
					.fn()
					.mockImplementation((payload: Record<string, unknown>) => {
						// Sin depends_on, el placeholder NO se debe resolver
						expect(payload.task_id).toBe("<uuid>");
						return {
							ok: false,
							action: "cancel_task",
							correlationId: "corr-no-dep",
							payload: { error: "TASK_NOT_FOUND" },
						};
					});
			}
			return vi.fn();
		});

		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1500);

		const calls = vi.mocked(sendToSession).mock.calls;
		const cancelResult = calls.find(
			(c) => (c[1] as Record<string, unknown>).action === "cancel_task",
		);
		expect(cancelResult).toBeDefined();

		stop();
	});
});

describe("processJob - action cascade", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetModules();
	});

	it("ejecuta acciones sin depends_on aunque una anterior falle", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const { claimJob } = await import("../db/repositories/job-repository.js");

		const mockJob = {
			id: "job-2",
			correlationId: "corr-2",
			sessionId: "sess-2",
			payload: { transcribed_text: "test" },
		};

		vi.mocked(claimJob).mockResolvedValueOnce(mockJob).mockResolvedValue(null);

		const { extractActions } = await import("../llm/slow-lane.js");
		vi.mocked(extractActions).mockResolvedValue({
			ok: true,
			value: [
				{ action: "complete_task", payload: { task_id: "1" } },
				{ action: "cancel_list", payload: { list_id: "2" } },
			],
		});

		const { getHandler } = await import("./action-handlers.js");
		vi.mocked(getHandler).mockImplementation((action: string) => {
			if (action === "complete_task") {
				return vi.fn().mockResolvedValue({
					ok: false,
					action: "complete_task",
					correlationId: "corr-2",
					payload: {
						error: "INVALID_STATE_TRANSITION",
						message: "No se puede completar una tarea en estado pending",
					},
				});
			}
			return vi.fn().mockResolvedValue({
				ok: true,
				action: "cancel_list",
				correlationId: "corr-2",
				payload: { id: "2" },
			});
		});

		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1500);

		const calls = vi.mocked(sendToSession).mock.calls;
		const cancelListCall = calls.find(
			(c) => (c[1] as Record<string, unknown>).action === "cancel_list",
		);
		expect(cancelListCall).toBeDefined();
		expect((cancelListCall?.[1] as Record<string, unknown>).ok).toBe(true);

		stop();
	});

	it("envía texto de fallback cuando action extraction falla permanentemente", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const { claimJob } = await import("../db/repositories/job-repository.js");

		const mockJob = {
			id: "job-fallback",
			correlationId: "corr-fallback",
			sessionId: "sess-fallback",
			payload: { transcribed_text: "test" },
		};

		vi.mocked(claimJob).mockResolvedValueOnce(mockJob).mockResolvedValue(null);

		const { extractActions } = await import("../llm/slow-lane.js");
		vi.mocked(extractActions).mockResolvedValue({
			ok: false,
			error: "RESPONSE_PARSE_FAILED",
		});

		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1500);

		const calls = vi.mocked(sendToSession).mock.calls;
		const fallbackCall = calls.find(
			(c) =>
				typeof c[1] === "object" &&
				(c[1] as Record<string, unknown>).type === "text" &&
				typeof (c[1] as Record<string, unknown>).content === "string" &&
				((c[1] as Record<string, unknown>).content as string).includes(
					"Hubo un problema",
				),
		);
		expect(fallbackCall).toBeDefined();

		stop();
	});

	it("envía PREVIOUS_ACTION_FAILED solo si depends_on referencia una fallida", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const { claimJob } = await import("../db/repositories/job-repository.js");

		const mockJob = {
			id: "job-3",
			correlationId: "corr-3",
			sessionId: "sess-3",
			payload: { transcribed_text: "test" },
		};

		vi.mocked(claimJob).mockResolvedValueOnce(mockJob).mockResolvedValue(null);

		const { extractActions } = await import("../llm/slow-lane.js");
		vi.mocked(extractActions).mockResolvedValue({
			ok: true,
			value: [
				{ action: "create_task", payload: { title: "test" } },
				{ action: "start_task", payload: { task_id: "1" }, depends_on: 0 },
			],
		});

		const { getHandler } = await import("./action-handlers.js");
		vi.mocked(getHandler).mockImplementation((action: string) => {
			if (action === "create_task") {
				return vi.fn().mockResolvedValue({
					ok: false,
					action: "create_task",
					correlationId: "corr-3",
					payload: {
						error: "MISSING_REQUIRED_FIELD",
						message: "title required",
					},
				});
			}
			return vi.fn();
		});

		const { workerLoop } = await import("./slow-lane-processor.js");
		const stop = workerLoop();

		await vi.advanceTimersByTimeAsync(1500);

		const calls = vi.mocked(sendToSession).mock.calls;
		const secondCall = calls.find(
			(c) => (c[1] as Record<string, unknown>).action === "start_task",
		);
		expect(secondCall).toBeDefined();
		expect((secondCall?.[1] as Record<string, unknown>).ok).toBe(false);
		expect((secondCall?.[1] as Record<string, unknown>).payload).toMatchObject({
			error: "PREVIOUS_ACTION_FAILED",
		});

		stop();
	});
});
