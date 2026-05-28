import { env } from "../config/env.js";
import { type Result, err, ok } from "../types/result.js";
import { openai } from "./client.js";

export enum LlmError {
	TIMEOUT = "LLM_TIMEOUT",
	RESPONSE_PARSE_FAILED = "RESPONSE_PARSE_FAILED",
	EMPTY_RESPONSE = "EMPTY_RESPONSE",
}

export async function getFastResponse(
	text: string,
	systemPrompt: string,
	signal?: AbortSignal,
): Promise<Result<string, LlmError>> {
	try {
		const completion = await openai.chat.completions.create(
			{
				model: env.OPENAI_FAST_MODEL,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: text },
				],
				max_completion_tokens: 150,
				temperature: 0.7,
			},
			{ signal },
		);

		const content = completion.choices[0]?.message?.content;
		if (!content || content.trim().length === 0) {
			return err(LlmError.EMPTY_RESPONSE);
		}

		return ok(content.trim());
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return err(LlmError.TIMEOUT);
		}
		const errMsg = error instanceof Error ? error.message : String(error);
		if (errMsg.includes("timeout") || errMsg.includes("TIMEOUT")) {
			return err(LlmError.TIMEOUT);
		}
		return err(LlmError.RESPONSE_PARSE_FAILED);
	}
}
