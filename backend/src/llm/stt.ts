import { env } from "../config/env.js";
import { type Result, err, ok } from "../types/result.js";
import { openai } from "./client.js";

export enum SttError {
	TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED",
	AUDIO_TOO_LARGE = "AUDIO_TOO_LARGE",
	TIMEOUT = "STT_TIMEOUT",
}

export async function transcribeAudio(
	audioBuffer: Buffer,
): Promise<Result<string, SttError>> {
	try {
		const extension = env.OPENAI_STT_MODEL === "whisper-1" ? "wav" : "wav";

		const response = await openai.audio.transcriptions.create({
			model: env.OPENAI_STT_MODEL,
			file: new File([audioBuffer], `audio.${extension}`, {
				type: `audio/${extension}`,
			}),
			language: "es",
		});

		return ok(response.text);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		if (errMsg.includes("timeout") || errMsg.includes("TIMEOUT")) {
			return err(SttError.TIMEOUT);
		}
		return err(SttError.TRANSCRIPTION_FAILED);
	}
}
