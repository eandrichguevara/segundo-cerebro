import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		OPENAI_FAST_MODEL: "gpt-4.1-mini",
		FCM_SERVICE_ACCOUNT: "./test-account.json",
		LOG_LEVEL: "warn",
		NODE_ENV: "test",
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

	it("prohíbe ejecutar lógica de negocio o modificar la BD", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT.toLowerCase()).toContain("no ejecutes");
	});

	it("permite responder preguntas usando contexto rápido", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain(
			"Podes responder preguntas sencillas usando el contexto",
		);
	});

	it("prohíbe inventar información que no esté en el contexto", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("NO inventes información");
	});

	it("incluye ejemplos de respuestas con contexto en formato JSON array", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("Tenes 3 tareas pendientes.");
		expect(FAST_LANE_SYSTEM_PROMPT).toContain('["Tenes 3 tareas pendientes.');
	});

	it("incluye instrucciones para reconocer info personal (nombre, preferencias)", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("información personal");
	});

	it("incluye ejemplo de presentación (nombre del usuario)", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("Me llamo Emilio");
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("Hola Emilio");
	});

	it("incluye ejemplo de preferencia del usuario", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("Prefiero trabajar de mañana");
	});

	it("incluye ejemplo de estado emocional", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("con mucha energía");
	});

	it("tiene tono cálido y conversacional en la descripción", async () => {
		const { FAST_LANE_SYSTEM_PROMPT } = await import(
			"./prompts/fast-lane-system.js"
		);
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("cálida");
		expect(FAST_LANE_SYSTEM_PROMPT).toContain("como si estuvieras charlando");
	});
});

describe("getFastResponse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna la respuesta del LLM exitosamente como array", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.chat.completions.create).mockResolvedValue({
			choices: [{ message: { content: "Respuesta rápida" } }],
		});
		const { getFastResponse } = await import("./fast-lane.js");

		const result = await getFastResponse("Hola", "Eres un asistente útil.");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
			expect(result.value.length).toBeGreaterThan(0);
			expect(result.value[0]).toBe("Respuesta rápida");
		}
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
