import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { type Result, err, ok } from "../types/result.js";
import { openai } from "./client.js";
import { SLOW_LANE_ACTIONS_PROMPT } from "./prompts/slow-lane-actions.js";

export enum LlmError {
	TIMEOUT = "LLM_TIMEOUT",
	RESPONSE_PARSE_FAILED = "RESPONSE_PARSE_FAILED",
	EMPTY_RESPONSE = "EMPTY_RESPONSE",
	INVALID_JSON = "INVALID_JSON",
}

export interface SlowLaneContext {
	systemPrompt: string;
	conversationTurns?: string;
	recentMemories?: string;
	activeObjectives?: string;
	activeTasks?: string;
	activeLists?: string;
	upcomingEvents?: string;
	fastLaneResponse?: string;
}

export interface Action {
	action: string;
	payload: Record<string, unknown>;
	depends_on?: number;
}

export async function extractActions(
	text: string,
	context: SlowLaneContext,
): Promise<Result<Action[], LlmError>> {
	try {
		const messages: Array<{
			role: "system" | "user" | "assistant";
			content: string;
		}> = [
			{ role: "system", content: context.systemPrompt },
			{ role: "system", content: SLOW_LANE_ACTIONS_PROMPT },
		];

		if (context.conversationTurns) {
			messages.push({
				role: "system",
				content: `## Conversación reciente\n${context.conversationTurns}`,
			});
		}
		if (context.recentMemories) {
			messages.push({
				role: "system",
				content: `## Memorias relevantes\n${context.recentMemories}`,
			});
		}
		if (context.activeObjectives) {
			messages.push({
				role: "system",
				content: `## Objetivos activos\n${context.activeObjectives}`,
			});
		}
		if (context.activeTasks) {
			messages.push({
				role: "system",
				content: `## Tareas activas\n${context.activeTasks}`,
			});
		}
		if (context.activeLists) {
			messages.push({
				role: "system",
				content: `## Listas activas\n${context.activeLists}`,
			});
		}
		if (context.upcomingEvents) {
			messages.push({
				role: "system",
				content: `## Eventos próximos\n${context.upcomingEvents}`,
			});
		}
		if (context.fastLaneResponse) {
			messages.push({
				role: "system",
				content: `## Respuesta anterior (vía rápida)\n"${context.fastLaneResponse}"`,
			});
		}

		messages.push({ role: "user", content: text });

		const completion = await openai.chat.completions.create(
			{
				model: env.OPENAI_SLOW_MODEL,
				messages,
				max_completion_tokens: env.SLOW_LANE_MAX_TOKENS,
				reasoning_effort: "low",
				response_format: { type: "json_object" },
			},
			{ timeout: 30_000 },
		);

		const choice = completion.choices[0];
		const content = choice?.message?.content;
		if (!content || content.trim().length === 0) {
			logger.warn(
				{
					finishReason: choice?.finish_reason,
					model: completion.model,
					usage: completion.usage,
					choiceCount: completion.choices.length,
					rawContent: content,
				},
				"Empty LLM response",
			);
			return err(LlmError.EMPTY_RESPONSE);
		}

		let parsed: { actions?: Action[] };
		try {
			parsed = JSON.parse(content.trim()) as { actions?: Action[] };
		} catch {
			logger.debug(
				{ rawContent: content },
				"Failed to parse LLM response as JSON",
			);
			return err(LlmError.INVALID_JSON);
		}

		if (
			!parsed.actions ||
			!Array.isArray(parsed.actions) ||
			parsed.actions.length === 0
		) {
			return err(LlmError.EMPTY_RESPONSE);
		}

		return ok(parsed.actions);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		logger.error(
			{ error: errMsg },
			"LLM action extraction failed with exception",
		);
		const lowerMsg = errMsg.toLowerCase();
		if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
			return err(LlmError.TIMEOUT);
		}
		return err(LlmError.RESPONSE_PARSE_FAILED);
	}
}
