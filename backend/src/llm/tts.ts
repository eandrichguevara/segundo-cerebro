import { env } from "../config/env.js";
import { type Result, err, ok } from "../types/result.js";
import { openai } from "./client.js";

export enum TtsError {
	SYNTHESIS_FAILED = "SYNTHESIS_FAILED",
	TIMEOUT = "TTS_TIMEOUT",
}

export async function synthesizeText(
	text: string,
): Promise<Result<Buffer, TtsError>> {
	try {
		const response = await openai.audio.speech.create({
			model: env.OPENAI_TTS_MODEL,
			voice: env.OPENAI_TTS_VOICE,
			input: text,
			response_format: "mp3",
		});

		const buffer = Buffer.from(await response.arrayBuffer());
		return ok(buffer);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		if (errMsg.includes("timeout") || errMsg.includes("TIMEOUT")) {
			return err(TtsError.TIMEOUT);
		}
		return err(TtsError.SYNTHESIS_FAILED);
	}
}
