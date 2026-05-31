import { ConversationRole } from "@prisma/client";
import { sendToSession } from "../api/ws.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
	addTurn,
	getRecentTurns,
} from "../db/repositories/conversation-repository.js";
import * as eventRepository from "../db/repositories/event-repository.js";
import * as ideaRepository from "../db/repositories/idea-repository.js";
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
import * as projectRepository from "../db/repositories/project-repository.js";
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
			.map((o) => {
				const parts = [o.status];
				if (o.deadline)
					parts.push(`deadline: ${o.deadline.toLocaleDateString("es-AR")}`);
				parts.push(`id: ${o.id}`);
				return `- 🎯 ${o.title} (${parts.join(", ")})`;
			})
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
			.map((t) => {
				const priorityEmoji =
					t.priority === "high" ? "🔴" : t.priority === "low" ? "🟢" : "🟡";
				const parts = [t.status, `prioridad: ${t.priority ?? "medium"}`];
				if (t.dueDate)
					parts.push(`vence: ${t.dueDate.toLocaleDateString("es-AR")}`);
				parts.push(`id: ${t.id}`);
				if (t.objectiveId) parts.push(`objective: ${t.objectiveId}`);
				return `- ${priorityEmoji} ${t.title} (${parts.join(", ")})`;
			})
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

async function formatActiveProjects(): Promise<string> {
	try {
		const projects = await projectRepository.getActiveProjects();
		if (projects.length === 0) return "";
		return projects
			.map((p) => {
				const parts = [p.status];
				if (p.category) parts.push(`categoría: ${p.category}`);
				if (p.deadline)
					parts.push(`deadline: ${p.deadline.toLocaleDateString("es-AR")}`);
				parts.push(`id: ${p.id}`);
				return `- 📁 ${p.title} (${parts.join(", ")})`;
			})
			.join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching projects");
		return "";
	}
}

async function formatActiveIdeas(): Promise<string> {
	try {
		const ideas = await ideaRepository.getActiveIdeas();
		if (ideas.length === 0) return "";
		return ideas
			.map((i) => {
				const parts = [i.status];
				if (i.tags.length > 0) parts.push(`tags: ${i.tags.join(", ")}`);
				parts.push(`id: ${i.id}`);
				return `- 💡 ${i.title} (${parts.join(", ")})`;
			})
			.join("\n");
	} catch (error) {
		logger.error({ error }, "Error fetching ideas");
		return "";
	}
}

async function buildDisplayForTypes(
	types: string[],
): Promise<Array<Record<string, unknown>>> {
	const display: Array<Record<string, unknown>> = [];

	for (const type of types) {
		if (type === "task") {
			const tasks = await getActiveTasks();
			for (const t of tasks) {
				display.push({
					type: "task",
					title: t.title,
					priority: t.priority ?? "medium",
					status: t.status,
					...(t.dueDate ? { dueDate: t.dueDate.toISOString() } : {}),
				});
			}
		} else if (type === "objective") {
			const objectives = await getActiveObjectives();
			for (const o of objectives) {
				display.push({
					type: "objective",
					title: o.title,
					status: o.status,
					...(o.deadline ? { deadline: o.deadline.toISOString() } : {}),
				});
			}
		} else if (type === "list") {
			const rawLists = await listRepository.getAllActive();
			for (const l of rawLists) {
				const items = listRepository.getItems(
					l as Parameters<typeof listRepository.getItems>[0],
				);
				display.push({
					type: "list",
					title: l.title,
					items: items.map((i) => ({
						content: i.content,
						quantity: i.quantity,
						checked: i.checked,
					})),
				});
			}
		} else if (type === "event") {
			const now = new Date();
			const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
			const events = await eventRepository.getEventsByDateRange(now, weekEnd);
			for (const e of events) {
				display.push({
					type: "event",
					title: e.title,
					startTime: e.startTime.toISOString(),
					...(e.endTime ? { endTime: e.endTime.toISOString() } : {}),
					...(e.location ? { location: e.location } : {}),
					...(e.category ? { category: e.category } : {}),
				});
			}
		} else if (type === "project") {
			const projects = await projectRepository.getActiveProjects();
			for (const p of projects) {
				display.push({
					type: "project",
					title: p.title,
					status: p.status,
					...(p.category ? { category: p.category } : {}),
					...(p.deadline ? { deadline: p.deadline.toISOString() } : {}),
				});
			}
		} else if (type === "idea") {
			const ideas = await ideaRepository.getActiveIdeas();
			for (const i of ideas) {
				display.push({
					type: "idea",
					title: i.title,
					status: i.status,
					...(i.tags.length > 0 ? { tags: i.tags } : {}),
				});
			}
		}
	}

	return display;
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
		const jobPayload = (payload as Record<string, unknown>) ?? {};
		const transcribedText = (jobPayload.transcribed_text as string) ?? "";
		const fastLaneResponse = jobPayload.fast_lane_response as
			| string
			| undefined;

	const [
			conversationTurns,
			recentMemories,
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
			activeProjects,
			activeIdeas,
		] = await Promise.all([
			formatConversationTurns(sessionId),
			formatRecentMemories(transcribedText),
			formatActiveObjectives(),
			formatActiveTasks(),
			formatActiveLists(),
			formatUpcomingEvents(),
			formatActiveProjects(),
			formatActiveIdeas(),
		]);

		const actionsResult = await extractActions(transcribedText, {
			systemPrompt: SLOW_LANE_SYSTEM_PROMPT,
			conversationTurns,
			recentMemories,
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
			activeProjects,
			activeIdeas,
			fastLaneResponse,
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
						content:
							"Hubo un problema al procesar tu mensaje. Podés intentarlo de nuevo.",
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
				return; // Don't send audio_end — another worker attempt will handle it
			}
			// Send audio_end to release the client from processing state
			if (sessionId) {
				sendToSession(sessionId, {
					version: "1",
					type: "audio_end",
					correlation_id: correlationId,
				});
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
			if (
				actionDef.depends_on !== undefined &&
				failedIndices.has(actionDef.depends_on)
			) {
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

		const respondResults = actionResults.filter(
			(r) => r.action === "respond" && r.ok,
		);
		const otherResults = actionResults.filter(
			(r) => !(r.action === "respond" && r.ok),
		);

		// Send action_result for ALL results (state tracking for client)
		for (const result of actionResults) {
			const wsMsg: Record<string, unknown> = {
				version: "1",
				type: "action_result",
				ok: result.ok,
				action: result.action,
				correlation_id: result.correlationId,
				payload: result.payload,
			};

			const fallbackText = formatActionResponse(
				result.action,
				result.ok,
				result.payload,
			);

			await notifyUser(sessionId, wsMsg, {
				title: result.ok ? "Acción completada" : "Error",
				body: fallbackText,
			});
		}

		// Send user-facing text — prefer respond.messages as granular chat
		const hasCrudActions = otherResults.length > 0;
		const hasRespondWithDisplay = respondResults.some((r) => {
			const display = r.payload.display as
				| Array<Record<string, unknown>>
				| undefined;
			return Array.isArray(display) && display.length > 0;
		});
		const shouldSkipRespond =
			fastLaneResponse !== undefined &&
			!hasCrudActions &&
			respondResults.length > 0;

		if (shouldSkipRespond) {
			logger.info(
				{ jobId, correlationId },
				"Safety net: skipping respond text (fast lane already responded, no CRUD actions)",
			);
			// Still send display data even when skipping text
			for (const rr of respondResults) {
				const display = rr.payload.display as
					| Array<Record<string, unknown>>
					| undefined;
				if (Array.isArray(display) && display.length > 0 && sessionId) {
					sendToSession(sessionId, {
						version: "1",
						type: "display",
						entities: display,
						correlation_id: rr.correlationId,
					});
				}
			}
		} else if (respondResults.length > 0) {
			for (const rr of respondResults) {
				const messages = (rr.payload.messages as string[]) ?? [];
				for (const msg of messages) {
					if (sessionId) {
						sendToSession(sessionId, {
							version: "1",
							type: "text",
							content: msg,
							correlation_id: rr.correlationId,
						});
					}
					await addTurn({
						sessionId,
						role: ConversationRole.assistant,
						content: msg,
					}).catch((error) => {
						logger.error(
							{ error, correlationId },
							"Error guardando turno assistant",
						);
					});
				}

				// Send display data as separate message for native rendering
				const display = rr.payload.display as
					| Array<Record<string, unknown>>
					| undefined;
				if (Array.isArray(display) && display.length > 0 && sessionId) {
					sendToSession(sessionId, {
						version: "1",
						type: "display",
						entities: display,
						correlation_id: rr.correlationId,
					});
				}
			}
		} else {
			// Fallback: send text for all non-respond actions (old behavior)
			for (const result of otherResults) {
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
		}

		// Safety net: supplement display with missing entity types for general info queries
		// If context had multiple data types but LLM only responded with a subset,
		// automatically add missing types to ensure comprehensive response
		const contextTypes = new Set<string>();
		if (activeTasks.trim()) contextTypes.add("task");
		if (activeObjectives.trim()) contextTypes.add("objective");
		if (activeLists.trim()) contextTypes.add("list");
		if (upcomingEvents.trim()) contextTypes.add("event");
		if (activeProjects.trim()) contextTypes.add("project");
		if (activeIdeas.trim()) contextTypes.add("idea");

		const respondedTypes = new Set<string>();
		for (const rr of respondResults) {
			const display = rr.payload.display as
				| Array<Record<string, unknown>>
				| undefined;
			if (Array.isArray(display)) {
				for (const entity of display) {
					if (typeof entity.type === "string") respondedTypes.add(entity.type);
				}
			}
		}

		if (
			!hasCrudActions &&
			contextTypes.size > 1 &&
			respondedTypes.size < contextTypes.size
		) {
			const missingTypes = [...contextTypes].filter(
				(t) => !respondedTypes.has(t),
			);
			logger.info(
				{ jobId, correlationId, missingTypes },
				"Safety net: supplementing display with missing entity types",
			);
			const supplementaryDisplay = await buildDisplayForTypes(missingTypes);
			if (supplementaryDisplay.length > 0 && sessionId) {
				sendToSession(sessionId, {
					version: "1",
					type: "display",
					entities: supplementaryDisplay,
					correlation_id: correlationId,
				});
			}
		}

		// Send audio_end to close the turn (client transitions from processing to idle)
		if (sessionId) {
			sendToSession(sessionId, {
				version: "1",
				type: "audio_end",
				correlation_id: correlationId,
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
					content:
						"Hubo un problema al procesar tu mensaje. Podés intentarlo de nuevo.",
					correlation_id: correlationId,
				});
				sendToSession(sessionId, {
					version: "1",
					type: "audio_end",
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
