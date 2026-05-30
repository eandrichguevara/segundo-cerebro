import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		WS_IDLE_TIMEOUT_MS: 300_000,
		WS_MAX_PAYLOAD: 1_048_576,
		RATE_LIMIT_AUDIO: 50,
		RATE_LIMIT_OTHER: 10,
		FAST_LANE_TIMEOUT_MS: 5_000,
		ID_CACHE_SIZE: 1000,
		ID_CACHE_TTL_MS: 300_000,
	},
}));

vi.mock("../config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../db/repositories/conversation-repository.js", () => ({
	addTurn: vi.fn().mockResolvedValue({}),
}));

vi.mock("../db/repositories/job-repository.js", () => ({
	enqueueJob: vi.fn().mockResolvedValue({}),
}));

vi.mock("../llm/stt.js", () => ({
	transcribeAudio: vi.fn(),
	SttError: {},
}));

vi.mock("../llm/fast-lane.js", () => ({
	getFastResponse: vi.fn(),
	LlmError: { TIMEOUT: "TIMEOUT" },
}));

vi.mock("../llm/prompts/fast-lane-system.js", () => ({
	FAST_LANE_SYSTEM_PROMPT: "test prompt",
}));

function createMockSocket() {
	const handlers: Record<string, (...args: unknown[]) => void> = {};
	return {
		send: vi.fn(),
		on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
			handlers[event] = handler;
		}),
		close: vi.fn(),
		readyState: 1,
		handlers,
	};
}

function createMockApp() {
	let storedHandler: ((...args: unknown[]) => void) | null = null;
	return {
		get: vi.fn(
			(
				_path: string,
				_opts: Record<string, unknown>,
				handler: (...args: unknown[]) => void,
			) => {
				storedHandler = handler;
			},
		),
		verifyAuth: vi.fn((token: unknown) => token === "test-token"),
		_getWsHandler: () => storedHandler,
	};
}

describe("sendToSession", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it("retorna false si la sesión no existe", async () => {
		const { sendToSession } = await import("../api/ws.js");
		const result = sendToSession("nonexistent", { type: "test" });
		expect(result).toBe(false);
	});
});

describe("WebSocket handler", () => {
	let mockSocket: ReturnType<typeof createMockSocket>;
	let mockApp: ReturnType<typeof createMockApp>;

	beforeEach(async () => {
		vi.useRealTimers();
		vi.clearAllMocks();
		vi.resetModules();

		mockSocket = createMockSocket();
		mockApp = createMockApp();

		const { wsRoutes } = await import("../api/ws.js");
		await wsRoutes(mockApp as never);

		const handler = mockApp._getWsHandler();
		handler(mockSocket, {});
	});

	function send(msg: Record<string, unknown>): void {
		const handler = mockSocket.handlers.message;
		if (handler) {
			handler(Buffer.from(JSON.stringify(msg)));
		}
	}

	function getMessages(): unknown[] {
		return mockSocket.send.mock.calls.map((call: unknown[]) =>
			JSON.parse(call[0] as string),
		);
	}

	describe("autenticación", () => {
		it("rechaza audio_end sin autenticar con AUTH_FAILED", () => {
			send({ version: "1", type: "audio_end" });

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "AUTH_FAILED",
			});
		});

		it("rechaza audio_chunk sin autenticar con AUTH_FAILED", () => {
			send({ version: "1", type: "audio_chunk", data: "dGVzdA==" });

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "AUTH_FAILED",
			});
		});

		it("autentica con token correcto y responde auth_ok", () => {
			send({
				version: "1",
				type: "auth",
				token: "test-token",
			});

			const messages = getMessages();
			const authOk = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "auth_ok",
			);
			expect(authOk).toBeDefined();
			expect(authOk).toMatchObject({
				version: "1",
				type: "auth_ok",
				audio_format: "mp3",
			});
			expect((authOk as Record<string, unknown>).session_id).toBeDefined();
		});

		it("rechaza auth con token incorrecto", () => {
			send({ version: "1", type: "auth", token: "wrong-token" });

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "AUTH_FAILED",
			});
		});

		it("autentica con audio_format pcm y lo confirma", () => {
			send({
				version: "1",
				type: "auth",
				token: "test-token",
				audio_format: "pcm",
			});

			const messages = getMessages();
			const authOk = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "auth_ok",
			);
			expect(authOk).toMatchObject({ audio_format: "pcm" });
		});

		it("incluye correlation_id en auth_ok si el auth tiene id", () => {
			send({
				version: "1",
				id: "my-corr-id",
				type: "auth",
				token: "test-token",
			});

			const messages = getMessages();
			const authOk = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "auth_ok",
			);
			expect(authOk).toMatchObject({
				correlation_id: "my-corr-id",
			});
		});
	});

	describe("validación de mensajes", () => {
		it("rechaza JSON inválido con INVALID_MESSAGE", () => {
			const handler = mockSocket.handlers.message;
			handler(Buffer.from("not-json"));

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "INVALID_MESSAGE",
			});
		});

		it("rechaza type desconocido con INVALID_MESSAGE", () => {
			send({ version: "1", type: "unknown_type" });

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "INVALID_MESSAGE",
			});
		});
	});

	describe("autenticado", () => {
		beforeEach(() => {
			send({ version: "1", type: "auth", token: "test-token" });
			mockSocket.send.mockClear();
		});

		it("audio_end sin audio_chunks previos responde INVALID_MESSAGE", () => {
			send({ version: "1", type: "audio_end" });

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "INVALID_MESSAGE",
			});
		});

		it("envía RATE_LIMITED después de exceder límite de mensajes", () => {
			const RATE_LIMIT = 10;
			const overLimit = RATE_LIMIT + 1;

			for (let i = 0; i < overLimit; i++) {
				mockSocket.send.mockClear();
				send({ version: "1", type: "audio_end" });
			}

			const messages = getMessages();
			const rateLimited = messages.find(
				(m: unknown) => (m as Record<string, unknown>).code === "RATE_LIMITED",
			);
			expect(rateLimited).toBeDefined();
		});

		it("proceso completo: STT ok, LLM responde, texto enviado, job encolado", async () => {
			const { transcribeAudio } = await import("../llm/stt.js");
			const { getFastResponse } = await import("../llm/fast-lane.js");
			const { addTurn } = await import(
				"../db/repositories/conversation-repository.js"
			);
			const { enqueueJob } = await import(
				"../db/repositories/job-repository.js"
			);

			vi.mocked(transcribeAudio).mockResolvedValue({
				ok: true,
				value: "hola",
			});
			vi.mocked(getFastResponse).mockResolvedValue({
				ok: true,
				value: ["hola cómo estás"],
			});

			// Send valid audio_chunk then audio_end
			send({
				version: "1",
				id: "audio-msg-1",
				type: "audio_chunk",
				data: Buffer.from("fake-pcm-data").toString("base64"),
			});
			mockSocket.send.mockClear();
			send({ version: "1", id: "audio-msg-1", type: "audio_end" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(vi.mocked(transcribeAudio)).toHaveBeenCalled();
			expect(vi.mocked(getFastResponse)).toHaveBeenCalledWith(
				"hola",
				expect.stringContaining("test prompt"),
				expect.any(AbortSignal),
			);
			expect(vi.mocked(addTurn)).toHaveBeenCalledTimes(2);
			expect(vi.mocked(enqueueJob)).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "process_message",
					payload: expect.objectContaining({
						transcribed_text: "hola",
						fast_lane_response: "hola cómo estás",
					}),
				}),
			);

			const messages = getMessages();
			const textMsg = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "text",
			);
			expect(textMsg).toBeDefined();
			expect((textMsg as Record<string, unknown>).content).toBe(
				"hola cómo estás",
			);

			// audio_end is NOT sent by fast lane — slow lane sends it when done
			const audioEndMsg = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "audio_end",
			);
			expect(audioEndMsg).toBeUndefined();
		});

		it("STT falla y envía STT_ERROR", async () => {
			const { transcribeAudio } = await import("../llm/stt.js");
			vi.mocked(transcribeAudio).mockResolvedValue({
				ok: false,
				error: "STT_ERROR",
			});

			send({
				version: "1",
				type: "audio_chunk",
				data: Buffer.from("fake-pcm-data").toString("base64"),
			});
			mockSocket.send.mockClear();
			send({ version: "1", type: "audio_end" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			const messages = getMessages();
			expect(messages[0]).toMatchObject({
				type: "error",
				code: "STT_ERROR",
			});
		});

		it("envía solo texto sin audio_end (fast lane no cierra el turno)", async () => {
			const { transcribeAudio } = await import("../llm/stt.js");
			const { getFastResponse } = await import("../llm/fast-lane.js");

			vi.mocked(transcribeAudio).mockResolvedValue({
				ok: true,
				value: "hola",
			});
			vi.mocked(getFastResponse).mockResolvedValue({
				ok: true,
				value: ["respuesta sin audio"],
			});

			send({
				version: "1",
				type: "audio_chunk",
				data: Buffer.from("fake-pcm-data").toString("base64"),
			});
			mockSocket.send.mockClear();
			send({ version: "1", type: "audio_end" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			const messages = getMessages();
			const textMsg = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "text",
			);
			expect(textMsg).toBeDefined();
			expect((textMsg as Record<string, unknown>).content).toBe(
				"respuesta sin audio",
			);

			const audioChunks = messages.filter(
				(m: unknown) => (m as Record<string, unknown>).type === "audio_chunk",
			);
			expect(audioChunks.length).toBe(0);

			// NO audio_end from fast lane — slow lane sends it
			const audioEndMsg = messages.find(
				(m: unknown) => (m as Record<string, unknown>).type === "audio_end",
			);
			expect(audioEndMsg).toBeUndefined();
		});

		it(
			"LLM timeout envía mensaje genérico sin audio_end",
			{ timeout: 10_000 },
			async () => {
				const { getFastResponse } = await import("../llm/fast-lane.js");
				vi.mocked(getFastResponse).mockReturnValue(new Promise(() => {}));

				const { transcribeAudio } = await import("../llm/stt.js");
				vi.mocked(transcribeAudio).mockResolvedValue({
					ok: true,
					value: "test",
				});

				send({
					version: "1",
					type: "audio_chunk",
					data: Buffer.from("fake-pcm-data").toString("base64"),
				});
				mockSocket.send.mockClear();
				send({ version: "1", type: "audio_end" });

				await new Promise((resolve) => setTimeout(resolve, 6000));
				await new Promise((resolve) => setTimeout(resolve, 0));

				const messages = getMessages();
				const textMsg = messages.find(
					(m: unknown) => (m as Record<string, unknown>).type === "text",
				);
				expect(textMsg).toBeDefined();
				expect((textMsg as Record<string, unknown>).content).toBe(
					"Un momento, estoy procesando...",
				);

				// NO audio_end from fast lane on timeout — slow lane will send it
				const audioEndMsg = messages.find(
					(m: unknown) => (m as Record<string, unknown>).type === "audio_end",
				);
				expect(audioEndMsg).toBeUndefined();
			},
		);

		it("ignora mensaje audio_end duplicado por id", async () => {
			const { transcribeAudio } = await import("../llm/stt.js");
			vi.mocked(transcribeAudio).mockResolvedValue({
				ok: true,
				value: "test",
			});
			const { getFastResponse } = await import("../llm/fast-lane.js");
			vi.mocked(getFastResponse).mockResolvedValue({
				ok: true,
				value: ["ok"],
			});
			const { logger } = await import("../config/logger.js");

			send({
				version: "1",
				type: "audio_chunk",
				data: Buffer.from("data").toString("base64"),
			});
			send({ version: "1", id: "dup-1", type: "audio_end" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			mockSocket.send.mockClear();
			vi.mocked(logger.warn).mockClear();

			send({ version: "1", id: "dup-1", type: "audio_end" });

			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(mockSocket.send).not.toHaveBeenCalled();
			expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
				expect.objectContaining({ id: "dup-1" }),
				expect.stringContaining("duplicado"),
			);
			expect(vi.mocked(transcribeAudio)).toHaveBeenCalledTimes(1);
		});
	});
});
