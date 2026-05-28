import { ConversationRole } from "@prisma/client";
import { sendToSession } from "../api/ws.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
	addTurn,
	getRecentTurns,
} from "../db/repositories/conversation-repository.js";
import * as eventRepository from "../db/repositories/event-repository.js";
import {
	claimJob,
	completeJob,
	releaseOrphanedJobs,
	retryJob,
} from "../db/repositories/job-repository.js";
import * as listRepository from "../db/repositories/list-repository.js";
import {
	createMemory,
	getRelevantMemories,
} from "../db/repositories/memory-repository.js";
import { getActiveObjectives } from "../db/repositories/objective-repository.js";
import { getActiveTasks } from "../db/repositories/task-repository.js";
import { generateEmbedding } from "../llm/embeddings.js";
import { SLOW_LANE_SYSTEM_PROMPT } from "../llm/prompts/slow-lane-system.js";
import { extractActions } from "../llm/slow-lane.js";
import { notifyUser } from "../notifications/notifier.js";
import { getHandler } from "./action-handlers.js";
import type { ActionResult } from "./action-handlers.js";
import { formatActionResponse } from "./format-response.js";

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;

async function formatConversationTurns(sessionId: string): Promise<string> {
	try {
		const turns = await getRecentTurns(sessionId, env.CONVERSATION_TURNS_LIMIT);
		if (turns.length === 0) return "";
		return turns.map((t) => `[${t.role}] ${t.content}`).join("\n");
	} catch (error) {
		logger.error({ error, sessionId }, "Error fetching conversation turns");
		return "";
	}
}

async function formatRecentMemories(queryText: string): Promise<string> {
	try {
		const embeddingResult = await generateEmbedding(queryText);
		if (!embeddingResult.ok) {
			logger.warn("Embedding generation failed for memory retrieval");
			return "";
		}
		const memories = await getRelevantMemories(
			embeddingResult.value,
			env.MEMORY_RETRIEVAL_LIMIT,
		);
		if (memories.length === 0) return "";
		return memories.map((m) => `- ${m.content}`).join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching relevant memories");
		return "";
	}
}

async function formatActiveObjectives(): Promise<string> {
	try {
		const objectives = await getActiveObjectives();
		if (objectives.length === 0) return "";
		return objectives
			.map((o) => `- ${o.title} (${o.status}, id: ${o.id})`)
			.join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching objectives");
		return "";
	}
}

async function formatActiveTasks(): Promise<string> {
	try {
		const tasks = await getActiveTasks();
		if (tasks.length === 0) return "";
		return tasks
			.map(
				(t) =>
					`- ${t.title} (${t.status}, id: ${t.id}${t.objectiveId ? `, objective: ${t.objectiveId}` : ""})`,
			)
			.join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching tasks");
		return "";
	}
}

async function formatUpcomingEvents(): Promise<string> {
	try {
		const now = new Date();
		const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
		const events = await eventRepository.getEventsByDateRange(now, weekEnd);
		if (events.length === 0) return "";

		const recurring = await eventRepository.getRecurringEvents();
		const recurringText =
			recurring.length > 0
				? `\nEventos recurrentes activos: ${recurring.map((e) => e.title).join(", ")}`
				: "";

		return (
			events
				.map(
					(e) =>
						`- ${e.title} (${e.startTime.toLocaleDateString("es-AR")} ${e.startTime.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}${e.endTime ? ` - ${e.endTime.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}, id: ${e.id})`,
				)
				.join("\n") + recurringText
		);
	} catch (error) {
		logger.error({ error }, "Error fetching upcoming events");
		return "";
	}
}

async function formatActiveLists(): Promise<string> {
	try {
		const rawLists = await listRepository.getAllActive();
		if (rawLists.length === 0) return "";
		return rawLists
			.map((l: { id: string; title: string; type: string; items: unknown }) => {
				const items = listRepository.getItems(
					l as Parameters<typeof listRepository.getItems>[0],
				);
				const itemSummary = items
					.map((i) => `  - ${i.content}${i.checked ? " ✓" : ""}`)
					.join("\n");
				return `- ${l.title} (${l.type}, id: ${l.id})\n${itemSummary}`;
			})
			.join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching lists");
		return "";
	}
}

async function processJob(): Promise<void> {
	const job = await claimJob(WORKER_ID, env.JOB_ORPHAN_TIMEOUT_MS);
	if (!job) return;

	const { id: jobId, correlationId, sessionId, payload } = job;
	logger.info({ jobId, correlationId, sessionId }, "Procesando job");

	if (sessionId) {
		sendToSession(sessionId, {
			version: "1",
			type: "processing",
			content: "Buscando...",
			correlation_id: correlationId,
		});
	}

	try {
		const transcribedText =
			((payload as Record<string, unknown>)?.transcribed_text as string) ?? "";

		const [
			conversationTurns,
			recentMemories,
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
		] = await Promise.all([
			formatConversationTurns(sessionId),
			formatRecentMemories(transcribedText),
			formatActiveObjectives(),
			formatActiveTasks(),
			formatActiveLists(),
			formatUpcomingEvents(),
		]);

		const actionsResult = await extractActions(transcribedText, {
			systemPrompt: SLOW_LANE_SYSTEM_PROMPT,
			conversationTurns,
			recentMemories,
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
		});

		if (!actionsResult.ok) {
			logger.error(
				{ jobId, correlationId, error: actionsResult.error },
				"Action extraction failed",
			);
			const retryResult = await retryJob(jobId, {
				error: actionsResult.error,
				message: "No se pudo extraer acciones del mensaje",
			});
			if (!retryResult.retried) {
				logger.warn(
					{ jobId, reason: retryResult.reason },
					"Job marcado como failed (max attempts)",
				);
				if (sessionId) {
					sendToSession(sessionId, {
						version: "1",
						type: "text",
						content: "Hubo un problema al procesar tu mensaje. Podés intentarlo de nuevo.",
						correlation_id: correlationId,
					});
				}
			} else {
				logger.info(
					{
						jobId,
						attempt: retryResult.nextAttempt,
						delayMs: retryResult.delayMs,
					},
					"Job reencolado para retry",
				);
			}
			return;
		}

		const actions = actionsResult.value;
		logger.info(
			{ jobId, correlationId, actionCount: actions.length },
			"Acciones extraídas",
		);

		const actionResults: ActionResult[] = [];
		const failedIndices = new Set<number>();

		for (const [i, actionDef] of actions.entries()) {
			if (actionDef.depends_on !== undefined && failedIndices.has(actionDef.depends_on)) {
				actionResults.push({
					ok: false,
					action: actionDef.action,
					correlationId,
					payload: {
						error: "PREVIOUS_ACTION_FAILED",
						message: "Una acción anterior falló; esta no se ejecutó",
					},
				});
				failedIndices.add(i);
				continue;
			}

			const handler = getHandler(actionDef.action);
			if (!handler) {
				actionResults.push({
					ok: false,
					action: actionDef.action,
					correlationId,
					payload: {
						error: "UNKNOWN_ACTION",
						message: `Acción desconocida: ${actionDef.action}`,
					},
				});
				failedIndices.add(i);
				continue;
			}

			try {
				const result = await handler(actionDef.payload, correlationId);
				actionResults.push(result);
				if (!result.ok) {
					failedIndices.add(i);
				}
			} catch (error) {
				logger.error(
					{ error, jobId, action: actionDef.action },
					"Handler error",
				);
				actionResults.push({
					ok: false,
					action: actionDef.action,
					correlationId,
					payload: {
						error: "INTERNAL_ERROR",
						message: "Error interno al ejecutar la acción",
					},
				});
				failedIndices.add(i);
			}
		}

		for (const result of actionResults) {
			const wsMsg: Record<string, unknown> = {
				version: "1",
				type: "action_result",
				ok: result.ok,
				action: result.action,
				correlation_id: result.correlationId,
				payload: result.payload,
			};

			const assistantText = formatActionResponse(
				result.action,
				result.ok,
				result.payload,
			);

			if (sessionId) {
				sendToSession(sessionId, {
					version: "1",
					type: "text",
					content: assistantText,
					correlation_id: result.correlationId,
				});
			}

			await notifyUser(sessionId, wsMsg, {
				title: result.ok ? "Acción completada" : "Error",
				body: assistantText,
			});

			await addTurn({
				sessionId,
				role: ConversationRole.assistant,
				content: assistantText,
			}).catch((error) => {
				logger.error(
					{ error, correlationId },
					"Error guardando turno assistant",
				);
			});
		}

		await completeJob(jobId, { actions: actionResults });
		logger.info(
			{ jobId, correlationId, actionCount: actions.length },
			"Job completado",
		);
	} catch (error) {
		logger.error(
			{ error, jobId, correlationId },
			"Error inesperado procesando job",
		);
		const retryResult = await retryJob(jobId, {
			error: "INTERNAL_ERROR",
			message: "Error inesperado en el worker",
		});
		if (!retryResult.retried) {
			logger.warn(
				{ jobId, reason: retryResult.reason },
				"Job marcado como failed (max attempts)",
			);
			if (sessionId) {
				sendToSession(sessionId, {
					version: "1",
					type: "text",
					content: "Hubo un problema al procesar tu mensaje. Podés intentarlo de nuevo.",
					correlation_id: correlationId,
				});
			}
		} else {
			logger.info(
				{
					jobId,
					attempt: retryResult.nextAttempt,
					delayMs: retryResult.delayMs,
				},
				"Job reencolado para retry",
			);
		}
	}
}

export function workerLoop(): () => void {
	logger.info({ workerId: WORKER_ID }, "Worker iniciado");

	const orphanInterval = setInterval(
		async () => {
			try {
				await releaseOrphanedJobs(env.JOB_ORPHAN_TIMEOUT_MS);
			} catch (error) {
				logger.error({ error }, "Error releasing orphaned jobs");
			}
		},
		5 * 60 * 1000,
	);

	const pollingInterval = setInterval(async () => {
		try {
			await processJob();
		} catch (error) {
			logger.error({ error }, "Error en ciclo de worker");
		}
	}, 1000);

	logger.info(
		{ workerId: WORKER_ID },
		"Worker polling cada 1s, cleanup cada 5min",
	);

	return () => {
		clearInterval(orphanInterval);
		clearInterval(pollingInterval);
		logger.info({ workerId: WORKER_ID }, "Worker detenido");
	};
}
