import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
	env: {
		OPENAI_STT_MODEL: "whisper-1",
		FCM_SERVICE_ACCOUNT: "./test-account.json",
	},
}));

vi.mock("./client.js", () => ({
	openai: {
		audio: {
			transcriptions: {
				create: vi.fn(),
			},
		},
	},
}));

describe("transcribeAudio", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna el texto transcrito exitosamente", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.transcriptions.create).mockResolvedValue({
			text: "Hola mundo",
		});
		const { transcribeAudio } = await import("./stt.js");

		const result = await transcribeAudio(Buffer.from("audio data"));

		expect(result).toEqual({ ok: true, value: "Hola mundo" });
	});

	it("retorna TRANSCRIPTION_FAILED en error de API", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.transcriptions.create).mockRejectedValue(
			new Error("API error"),
		);
		const { transcribeAudio } = await import("./stt.js");

		const result = await transcribeAudio(Buffer.from("audio data"));

		expect(result).toEqual({
			ok: false,
			error: "TRANSCRIPTION_FAILED",
		});
	});

	it("retorna STT_TIMEOUT cuando el error contiene 'timeout'", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.audio.transcriptions.create).mockRejectedValue(
			new Error("Request timeout"),
		);
		const { transcribeAudio } = await import("./stt.js");

		const result = await transcribeAudio(Buffer.from("audio data"));

		expect(result).toEqual({
			ok: false,
			error: "STT_TIMEOUT",
		});
	});
});
