import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		OPENAI_TTS_MODEL: "tts-1-hd",
		OPENAI_TTS_VOICE: "nova",
		FCM_SERVICE_ACCOUNT: "./test-account.json",
	},
}));

vi.mock("./client.js", () => ({
	openai: {
		audio: {
			speech: {
				create: vi.fn(),
			},
		},
	},
}));

function createMockResponse() {
	return {
		arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1024)),
	};
}

describe("synthesizeText", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna un Buffer con el audio sintetizado", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.speech.create).mockResolvedValue(
			createMockResponse(),
		);
		const { synthesizeText } = await import("./tts.js");

		const result = await synthesizeText("Hola mundo");

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Buffer.isBuffer(result.value)).toBe(true);
			expect(result.value.byteLength).toBe(1024);
		}
	});

	it("retorna SYNTHESIS_FAILED en error de API", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.speech.create).mockRejectedValue(
			new Error("API error"),
		);
		const { synthesizeText } = await import("./tts.js");

		const result = await synthesizeText("Hola mundo");

		expect(result).toEqual({ ok: false, error: "SYNTHESIS_FAILED" });
	});

	it("retorna TTS_TIMEOUT cuando el error contiene 'timeout'", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.speech.create).mockRejectedValue(
			new Error("Socket timeout"),
		);
		const { synthesizeText } = await import("./tts.js");

		const result = await synthesizeText("Hola mundo");

		expect(result).toEqual({ ok: false, error: "TTS_TIMEOUT" });
	});
});
