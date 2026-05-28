import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		OPENAI_FAST_MODEL: "gpt-4.1-mini",
		FCM_SERVICE_ACCOUNT: "./test-account.json",
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

describe("FAST_LANE_SYSTEM_PROMPT", () => {
	it("existe y no está vacío", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toBeTruthy();
		expect(FAST_LANE_SYSTEM_PROMPT.length).toBeGreaterThan(100);
	});

	it("prohíbe explícitamente que el LLM niegue capacidades o acceso a datos", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		const prompt = FAST_LANE_SYSTEM_PROMPT.toLowerCase();
		expect(
			prompt.includes("no digas") &&
				(prompt.includes("no guardo") || prompt.includes("no tengo acceso")),
		).toBe(true);
	});

	it("contiene instrucciones de no responder consultas sobre datos", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		const prompt = FAST_LANE_SYSTEM_PROMPT.toLowerCase();
		expect(
			prompt.includes("no intentes responder") ||
				prompt.includes("no te hagas cargo de la solicitud"),
		).toBe(true);
	});

	it("incluye ejemplos de lo que NO debe hacer", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("lo que NO debes hacer");
	});

	it("incluye ejemplos de respuestas dinámicas", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("Voy a revisar tus tareas");
	});
});

describe("getFastResponse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna la respuesta del LLM exitosamente", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: "Respuesta rápida" } }],
		});
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Eres un asistente útil.");

		expect(result).toEqual({ ok: true, value: "Respuesta rápida" });
	});

	it("retorna EMPTY_RESPONSE cuando la respuesta está vacía", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: "" } }],
		});
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Prompt");

		expect(result).toEqual({ ok: false, error: "EMPTY_RESPONSE" });
	});

	it("retorna EMPTY_RESPONSE cuando choices está vacío", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [],
		});
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Prompt");

		expect(result).toEqual({ ok: false, error: "EMPTY_RESPONSE" });
	});

	it("retorna TIMEOUT en AbortError", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockRejectedValue(
			new DOMException("The operation was aborted", "AbortError"),
		);
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Prompt");

		expect(result).toEqual({ ok: false, error: "LLM_TIMEOUT" });
	});

	it("retorna TIMEOUT cuando el error contiene 'timeout'", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockRejectedValue(
			new Error("Connection timeout"),
		);
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Prompt");

		expect(result).toEqual({ ok: false, error: "LLM_TIMEOUT" });
	});

	it("retorna RESPONSE_PARSE_FAILED en error genérico", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockRejectedValue(
			new Error("Network error"),
		);
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Prompt");

		expect(result).toEqual({ ok: false, error: "RESPONSE_PARSE_FAILED" });
	});
});
