import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		OPENAI_SLOW_MODEL: "gpt-4o",
		FCM_SERVICE_ACCOUNT: "./test-account.json",
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

vi.mock("./client.js", () => ({
	openai: {
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	},
}));

const mockSystemPrompt = "Eres un asistente que extrae acciones.";

describe("extractActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("extrae acciones exitosamente con contexto completo", async () => {
		const { openai } = await import("./client.js");
		const actions = [{ action: "create_task", payload: { title: "Test" } }];
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({ actions }),
					},
				},
			],
		});
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Crear tarea", {
			systemPrompt: mockSystemPrompt,
			conversationTurns: "User: hola\nAssistant: hola",
			recentMemories: "Prefiere trabajar de mañana",
			activeObjectives: "Ahorrar dinero",
			activeTasks: "Revisar presupuesto",
			activeLists: "Compras del mes",
		});

		expect(result).toEqual({ ok: true, value: actions });
	});

	it("incluye el contexto de listas activas en los mensajes", async () => {
		const { openai } = await import("./client.js");
		const actions = [
			{ action: "query_list", payload: { list_title: "supermercado" } },
		];
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({ actions }),
					},
				},
			],
		});
		const { extractActions } = await import("./slow-lane.js");

		await extractActions("revisá la lista del supermercado", {
			systemPrompt: "test prompt",
			activeLists:
				"- Lista del supermercado (shopping, id: abc-123)\n  - Tomates\n  - Lechuga",
		});

		const messages = vi.mocked(openai.chat.completions.create).mock.calls[0][0]
			.messages;
		const listContextMsg = messages.find(
			(m) =>
				m.role === "system" &&
				typeof m.content === "string" &&
				m.content.includes("Lista del supermercado"),
		);
		expect(listContextMsg).toBeDefined();
		expect(listContextMsg?.content).toContain("abc-123");
	});

	it("funciona con contexto mínimo (solo systemPrompt)", async () => {
		const { openai } = await import("./client.js");
		const actions = [{ action: "store_memory", payload: { content: "Algo" } }];
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [
				{
					message: {
						content: JSON.stringify({ actions }),
					},
				},
			],
		});
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Recuerda esto", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: true, value: actions });
	});

	it("retorna INVALID_JSON cuando la respuesta no es JSON válido", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: "no es json" } }],
		});
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Hola", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: false, error: "INVALID_JSON" });
	});

	it("retorna EMPTY_RESPONSE cuando no hay actions array", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: '{"not_actions": []}' } }],
		});
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Hola", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: false, error: "EMPTY_RESPONSE" });
	});

	it("retorna EMPTY_RESPONSE cuando content está vacío", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: "" } }],
		});
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Hola", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: false, error: "EMPTY_RESPONSE" });
	});

	it("retorna TIMEOUT cuando el error contiene 'timeout'", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockRejectedValue(
			new Error("Request timeout"),
		);
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Hola", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: false, error: "LLM_TIMEOUT" });
	});

	it("retorna RESPONSE_PARSE_FAILED en error genérico", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockRejectedValue(
			new Error("Network failure"),
		);
		const { extractActions } = await import("./slow-lane.js");

		const result = await extractActions("Hola", {
			systemPrompt: mockSystemPrompt,
		});

		expect(result).toEqual({ ok: false, error: "RESPONSE_PARSE_FAILED" });
	});
});
