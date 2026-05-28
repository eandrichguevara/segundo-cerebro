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
