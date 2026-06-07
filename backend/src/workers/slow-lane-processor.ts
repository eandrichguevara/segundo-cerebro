import { ConversationRole } from "@prisma/client";
import { getInterviewStateOrThrow, sendToSession } from "../api/ws.js";
import { getStartOfDayInTimezone } from "../config/current-time.js";
import { formatCurrentTime } from "../config/current-time.js";
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
	getRecentMemories,
	getRelevantMemories,
} from "../db/repositories/memory-repository.js";
import { getActiveObjectives } from "../db/repositories/objective-repository.js";
import * as projectRepository from "../db/repositories/project-repository.js";
import { getActiveTasks } from "../db/repositories/task-repository.js";
import {
	type InterviewArea,
	type InterviewExchange,
	type InterviewPlan,
	addExchange,
	formatInterviewContext,
	formatInterviewPlanForScan,
	incrementEntitiesCreated,
	incrementQuestionsAsked,
} from "../domain/interview.js";
import { openai } from "../llm/client.js";
import { generateEmbedding } from "../llm/embeddings.js";
import { INTERVIEW_SCAN_SYSTEM_PROMPT } from "../llm/prompts/interview-scan.js";
import { INTERVIEW_SLOW_LANE_SYSTEM_PROMPT } from "../llm/prompts/interview-slow-lane.js";
import { SLOW_LANE_ACTIONS_PROMPT } from "../llm/prompts/slow-lane-actions.js";
import { SLOW_LANE_SYSTEM_PROMPT } from "../llm/prompts/slow-lane-system.js";
import { type Action, extractActions } from "../llm/slow-lane.js";
import { notifyUser } from "../notifications/notifier.js";
import { getHandler, initializeQuickMemory } from "./action-handlers.js";
import type { ActionResult } from "./action-handlers.js";
import { formatActionResponse } from "./format-response.js";

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;

export function resolveUuidPlaceholder(
	payload: Record<string, unknown>,
	dependsOn: number,
	actionResults: ActionResult[],
	actions: Action[],
): Record<string, unknown> {
	const resolved = { ...payload };
	for (const [key, value] of Object.entries(resolved)) {
		resolved[key] = resolvePayloadValue(
			value,
			dependsOn,
			actionResults,
			actions,
		);
	}
	return resolved;
}

export function resolvePayloadValue(
	value: unknown,
	dependsOn: number,
	actionResults: ActionResult[],
	actions: Action[],
): unknown {
	if (value === "<uuid>") {
		return findCreatedEntityId(dependsOn, actionResults, actions);
	}
	if (Array.isArray(value)) {
		return value.map((item) =>
			resolvePayloadValue(item, dependsOn, actionResults, actions),
		);
	}
	if (value !== null && typeof value === "object") {
		const resolved: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			resolved[k] = resolvePayloadValue(v, dependsOn, actionResults, actions);
		}
		return resolved;
	}
	return value;
}

export function findCreatedEntityId(
	dependsOn: number,
	actionResults: ActionResult[],
	actions: Action[],
	visited = new Set<number>(),
): string | null {
	if (visited.has(dependsOn)) {
		return null;
	}
	visited.add(dependsOn);
	const result = actionResults[dependsOn];
	if (result?.ok && typeof result.payload.id === "string") {
		return result.payload.id;
	}
	const parentDep = actions[dependsOn]?.depends_on;
	if (parentDep !== undefined) {
		return findCreatedEntityId(parentDep, actionResults, actions, visited);
	}
	return null;
}

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
					parts.push(
						`deadline: ${o.deadline.toLocaleDateString("es-AR", { timeZone: env.TIMEZONE })}`,
					);
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
					parts.push(
						`vence: ${t.dueDate.toLocaleDateString("es-AR", { timeZone: env.TIMEZONE })}`,
					);
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
		const { start, end } = getDateRangeForEvents();
		const events = await eventRepository.getEventsByDateRange(start, end);
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
						`- ${e.title} (${e.startTime.toLocaleDateString("es-AR", { timeZone: env.TIMEZONE })} ${e.startTime.toLocaleTimeString("es-AR", { timeZone: env.TIMEZONE, hour: "2-digit", minute: "2-digit" })}${e.endTime ? ` - ${e.endTime.toLocaleTimeString("es-AR", { timeZone: env.TIMEZONE, hour: "2-digit", minute: "2-digit" })}` : ""}, id: ${e.id})`,
				)
				.join("\n") + recurringText
		);
	} catch (error) {
		logger.error({ error }, "Error fetching upcoming events");
		return "";
	}
}

function getDateRangeForEvents(): { start: Date; end: Date } {
	const now = new Date();
	const start = getStartOfDayInTimezone(now, env.TIMEZONE);
	const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
	return { start, end };
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
					parts.push(
						`deadline: ${p.deadline.toLocaleDateString("es-AR", { timeZone: env.TIMEZONE })}`,
					);
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
			const { start, end } = getDateRangeForEvents();
			const events = await eventRepository.getEventsByDateRange(start, end);
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

	const { id: jobId, correlationId, sessionId, type, payload } = job;
	logger.info({ jobId, correlationId, sessionId, type }, "Procesando job");

	switch (type) {
		case "interview_scan":
			await processInterviewScanJob(jobId, correlationId, sessionId);
			return;
		case "interview_response":
			await processInterviewResponseJob(
				jobId,
				correlationId,
				sessionId,
				payload,
			);
			return;
		case "interview_summary":
			await processInterviewSummaryJob(
				jobId,
				correlationId,
				sessionId,
				payload,
			);
			return;
		default:
			await processNormalJob(jobId, correlationId, sessionId, payload);
			return;
	}
}

async function processNormalJob(
	jobId: string,
	correlationId: string,
	sessionId: string,
	payload: unknown,
): Promise<void> {
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
				const resolvedPayload =
					actionDef.depends_on !== undefined
						? resolveUuidPlaceholder(
								actionDef.payload,
								actionDef.depends_on,
								actionResults,
								actions,
							)
						: actionDef.payload;
				const result = await handler(resolvedPayload, correlationId);
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

async function processInterviewScanJob(
	jobId: string,
	correlationId: string,
	sessionId: string,
): Promise<void> {
	logger.info({ jobId, correlationId, sessionId }, "Procesando interview_scan");

	if (sessionId) {
		sendToSession(sessionId, {
			version: "1",
			type: "processing",
			content: "Analizando tu información...",
			correlation_id: correlationId,
		});
	}

	try {
		// Barrido completo de BD
		const [
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
			activeProjects,
			activeIdeas,
			conversationTurns,
		] = await Promise.all([
			formatActiveObjectives(),
			formatActiveTasks(),
			formatActiveLists(),
			formatUpcomingEvents(),
			formatActiveProjects(),
			formatActiveIdeas(),
			formatConversationTurns(sessionId),
		]);

		// Obtener memorias recientes (limitado por config)
		const recentMemories = await getRecentMemories(
			env.INTERVIEW_SCAN_MAX_MEMORIES,
		);
		const memoriesText =
			recentMemories.length > 0
				? recentMemories.map((m) => `- ${m.content}`).join("\n")
				: "";

		// Construir contexto para el LLM
		const context = [
			"## Objetivos activos",
			activeObjectives || "(ninguno)",
			"",
			"## Tareas activas",
			activeTasks || "(ninguna)",
			"",
			"## Listas activas",
			activeLists || "(ninguna)",
			"",
			"## Eventos próximos",
			upcomingEvents || "(ninguno)",
			"",
			"## Proyectos activos",
			activeProjects || "(ninguno)",
			"",
			"## Ideas activas",
			activeIdeas || "(ninguna)",
			"",
			"## Memorias recientes",
			memoriesText || "(ninguna)",
			"",
			"## Conversación reciente",
			conversationTurns || "(ninguna)",
		].join("\n");

		// Llamar al LLM para generar plan de interview
		const completion = await openai.chat.completions.create(
			{
				model: env.OPENAI_SLOW_MODEL,
				messages: [
					{ role: "system", content: INTERVIEW_SCAN_SYSTEM_PROMPT },
					{ role: "user", content: context },
				],
				response_format: { type: "json_object" },
				max_completion_tokens: env.SLOW_LANE_MAX_TOKENS,
			},
			{ timeout: 30000 },
		);

		const content = completion.choices[0]?.message?.content;
		if (!content) {
			throw new Error("Empty response from LLM");
		}

		const parsed = JSON.parse(content) as {
			areas?: Array<{
				name: string;
				priority?: "high" | "medium" | "low";
				questions?: string[];
			}>;
			first_question?: string;
		};

		// Limitar número de áreas y preguntas según config
		const rawAreas = parsed.areas || [];
		const maxQuestions = env.INTERVIEW_MAX_QUESTIONS;
		let questionCount = 0;
		const areas: InterviewArea[] = [];
		for (const a of rawAreas) {
			if (questionCount >= maxQuestions) break;
			const questions = (a.questions || []).slice(
				0,
				maxQuestions - questionCount,
			);
			questionCount += questions.length;
			areas.push({
				name: a.name,
				priority: a.priority || "medium",
				plannedQuestions: questions,
				askedQuestions: [],
				status: "pending" as const,
			});
		}

		const firstQuestion =
			parsed.first_question || "Contame un poco sobre vos, ¿a qué te dedicás?";

		// Crear plan
		const plan: InterviewPlan = {
			areas,
			startedAt: new Date(),
			totalAsked: 0,
			entitiesCreated: 0,
		};

		// Actualizar interview state
		const interviewState = getInterviewStateOrThrow(sessionId);
		interviewState.plan = plan;
		interviewState.currentQuestion = firstQuestion;

		// Enviar primera pregunta
		sendToSession(sessionId, {
			version: "1",
			type: "text",
			content: firstQuestion,
			correlation_id: correlationId,
		});

		await addTurn({
			sessionId,
			role: "assistant",
			content: firstQuestion,
		});

		sendToSession(sessionId, {
			version: "1",
			type: "audio_end",
			correlation_id: correlationId,
		});

		await completeJob(jobId, { plan, firstQuestion });
		logger.info(
			{ jobId, correlationId, areasCount: areas.length },
			"Interview scan completado",
		);
	} catch (error) {
		logger.error({ error, jobId, correlationId }, "Error en interview_scan");
		const retryResult = await retryJob(jobId, {
			error: "INTERVIEW_SCAN_ERROR",
			message: error instanceof Error ? error.message : String(error),
		});
		if (!retryResult.retried) {
			sendToSession(sessionId, {
				version: "1",
				type: "text",
				content:
					"Tuve un problema para analizar tu información. ¿Querés intentar de nuevo?",
				correlation_id: correlationId,
			});
			sendToSession(sessionId, {
				version: "1",
				type: "audio_end",
				correlation_id: correlationId,
			});
		}
	}
}

async function processInterviewResponseJob(
	jobId: string,
	correlationId: string,
	sessionId: string,
	payload: unknown,
): Promise<void> {
	logger.info(
		{ jobId, correlationId, sessionId },
		"Procesando interview_response",
	);

	if (sessionId) {
		sendToSession(sessionId, {
			version: "1",
			type: "processing",
			content: "Procesando tu respuesta...",
			correlation_id: correlationId,
		});
	}

	try {
		const jobPayload = (payload as Record<string, unknown>) ?? {};
		const userResponse = (jobPayload.transcribed_text as string) ?? "";
		const currentQuestion = (jobPayload.current_question as string) ?? "";
		const interviewHistory =
			(jobPayload.interview_history as InterviewExchange[]) ?? [];
		const interviewPlan = (jobPayload.interview_plan as InterviewPlan) ?? null;

		// Obtener contexto adicional de BD (similar a processNormalJob)
		const [
			activeObjectives,
			activeTasks,
			activeLists,
			upcomingEvents,
			activeProjects,
			activeIdeas,
			recentMemories,
		] = await Promise.all([
			formatActiveObjectives(),
			formatActiveTasks(),
			formatActiveLists(),
			formatUpcomingEvents(),
			formatActiveProjects(),
			formatActiveIdeas(),
			formatRecentMemories(userResponse),
		]);

		// Cachear reference al interview state para evitar búsquedas repetidas
		const interviewState = getInterviewStateOrThrow(sessionId);
		const currentPlan = interviewState.plan ?? interviewPlan;

		// Construir contexto para el LLM
		const context = [
			"## Respuesta del usuario",
			userResponse,
			"",
			"## Pregunta anterior",
			currentQuestion,
			"",
			"## Plan de interview actual",
			currentPlan ? formatInterviewPlanForScan(currentPlan) : "(sin plan)",
			"",
			"## Historial de interview",
			interviewHistory.length > 0
				? interviewHistory
						.map((h) => `P: ${h.question}\nR: ${h.answer}`)
						.join("\n\n")
				: "(vacío)",
			"",
			"## Objetivos activos",
			activeObjectives || "(ninguno)",
			"",
			"## Tareas activas",
			activeTasks || "(ninguna)",
			"",
			"## Listas activas",
			activeLists || "(ninguna)",
			"",
			"## Eventos próximos",
			upcomingEvents || "(ninguno)",
			"",
			"## Proyectos activos",
			activeProjects || "(ninguno)",
			"",
			"## Ideas activas",
			activeIdeas || "(ninguna)",
			"",
			"## Memorias relevantes",
			recentMemories || "(ninguna)",
			"",
			"## Fecha y hora actual",
			formatCurrentTime(),
		].join("\n");

		// Llamar al LLM para procesar respuesta y generar siguiente pregunta
		const completion = await openai.chat.completions.create(
			{
				model: env.OPENAI_SLOW_MODEL,
				messages: [
					{ role: "system", content: INTERVIEW_SLOW_LANE_SYSTEM_PROMPT },
					{ role: "system", content: SLOW_LANE_ACTIONS_PROMPT },
					{ role: "user", content: context },
				],
				response_format: { type: "json_object" },
				max_completion_tokens: env.SLOW_LANE_MAX_TOKENS,
			},
			{ timeout: 30000 },
		);

		const content = completion.choices[0]?.message?.content;
		if (!content) {
			throw new Error("Empty response from LLM");
		}

		const parsed = JSON.parse(content) as {
			actions?: Action[];
			next_question?: string;
			plan_update?: {
				areas?: Array<{
					name: string;
					status: "pending" | "exploring" | "covered";
				}>;
				new_questions?: Array<{ area: string; question: string }>;
			};
		};
		const actions: Action[] = parsed.actions || [];
		const nextQuestion = parsed.next_question ?? "";
		const planUpdate = parsed.plan_update;

		// Ejecutar acciones CRUD
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
				const resolvedPayload =
					actionDef.depends_on !== undefined
						? resolveUuidPlaceholder(
								actionDef.payload,
								actionDef.depends_on,
								actionResults,
								actions,
							)
						: actionDef.payload;
				const result = await handler(resolvedPayload, correlationId);
				actionResults.push(result);
				if (!result.ok) {
					failedIndices.add(i);
				}
				// Contar entidades creadas
				if (
					result.ok &&
					[
						"create_task",
						"create_event",
						"create_objective",
						"create_project",
						"create_idea",
						"create_list",
					].includes(actionDef.action)
				) {
					incrementEntitiesCreated(interviewState);
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

		// Enviar action_results
		for (const result of actionResults) {
			const wsMsg: Record<string, unknown> = {
				version: "1",
				type: "action_result",
				ok: result.ok,
				action: result.action,
				correlation_id: result.correlationId,
				payload: result.payload,
			};
			await notifyUser(sessionId, wsMsg, {
				title: result.ok ? "Acción completada" : "Error",
				body: formatActionResponse(result.action, result.ok, result.payload),
			});
		}

		// Actualizar plan si hay plan_update
		if (planUpdate && currentPlan) {
			if (planUpdate.areas) {
				for (const areaUpdate of planUpdate.areas) {
					const area = interviewState.plan?.areas.find(
						(a) => a.name === areaUpdate.name,
					);
					if (area) {
						area.status = areaUpdate.status;
					}
				}
			}
			if (planUpdate.new_questions) {
				for (const q of planUpdate.new_questions) {
					const area = interviewState.plan?.areas.find(
						(a) => a.name === q.area,
					);
					if (area) {
						area.plannedQuestions.push(q.question);
					}
				}
			}
		}

		// Registrar exchange en historial
		addExchange(interviewState, {
			question: currentQuestion,
			answer: userResponse,
			actionsTaken: actionResults.filter((r) => r.ok).map((r) => r.action),
		});
		incrementQuestionsAsked(interviewState);

		// Registrar pregunta en el área activa
		if (interviewState.plan && currentQuestion) {
			const activeArea = interviewState.plan.areas.find(
				(a) => a.status !== "covered",
			);
			if (activeArea) {
				activeArea.askedQuestions.push(currentQuestion);
			}
		}

		// Enviar siguiente pregunta
		if (nextQuestion) {
			interviewState.currentQuestion = nextQuestion;
			sendToSession(sessionId, {
				version: "1",
				type: "text",
				content: nextQuestion,
				correlation_id: correlationId,
			});
			await addTurn({
				sessionId,
				role: "assistant",
				content: nextQuestion,
			});
		}

		sendToSession(sessionId, {
			version: "1",
			type: "audio_end",
			correlation_id: correlationId,
		});

		await completeJob(jobId, { actions: actionResults, nextQuestion });
		logger.info(
			{ jobId, correlationId, actionCount: actions.length },
			"Interview response completado",
		);
	} catch (error) {
		logger.error(
			{ error, jobId, correlationId },
			"Error en interview_response",
		);
		const retryResult = await retryJob(jobId, {
			error: "INTERVIEW_RESPONSE_ERROR",
			message: error instanceof Error ? error.message : String(error),
		});
		if (!retryResult.retried) {
			sendToSession(sessionId, {
				version: "1",
				type: "text",
				content:
					"Tuve un problema para procesar tu respuesta. ¿Podés repetirla?",
				correlation_id: correlationId,
			});
			sendToSession(sessionId, {
				version: "1",
				type: "audio_end",
				correlation_id: correlationId,
			});
		}
	}
}

async function processInterviewSummaryJob(
	jobId: string,
	correlationId: string,
	sessionId: string,
	payload: unknown,
): Promise<void> {
	logger.info(
		{ jobId, correlationId, sessionId },
		"Procesando interview_summary",
	);

	try {
		const jobPayload = (payload as Record<string, unknown>) ?? {};
		const history = (jobPayload.history as InterviewExchange[]) ?? [];
		const summary = (jobPayload.summary as {
			questions_asked: number;
			areas_covered: string[];
			entities_created: number;
		}) ?? { questions_asked: 0, areas_covered: [], entities_created: 0 };

		// Generar memoria resumen
		if (history.length > 0) {
			const summaryContent = [
				`Resumen de interview: ${summary.questions_asked} preguntas realizadas`,
				`Áreas cubiertas: ${summary.areas_covered.join(", ")}`,
				`Entidades creadas: ${summary.entities_created}`,
				"",
				"Intercambios:",
				...history.map((h) => `- P: ${h.question}\n  R: ${h.answer}`),
			].join("\n");

			await createMemory({
				content: summaryContent,
				metadata: {
					interaction_type: "interview_summary",
					questions_asked: summary.questions_asked,
					areas_covered: summary.areas_covered,
					entities_created: summary.entities_created,
				},
			});

			logger.info(
				{ jobId, correlationId, historyLength: history.length },
				"Memoria de interview creada",
			);
		}

		// Actualizar Quick Memory
		await initializeQuickMemory();

		await completeJob(jobId, { summary });
		logger.info({ jobId, correlationId }, "Interview summary completado");
	} catch (error) {
		logger.error({ error, jobId, correlationId }, "Error en interview_summary");
		await completeJob(jobId, { error: "INTERVIEW_SUMMARY_ERROR" });
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
