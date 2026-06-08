import { ConversationRole } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { formatCurrentTime } from "../config/current-time.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { addTurn } from "../db/repositories/conversation-repository.js";
import * as deviceRepository from "../db/repositories/device-repository.js";
import { enqueueJob } from "../db/repositories/job-repository.js";
import {
	type InterviewState,
	createInterviewState,
	formatInterviewContext,
	resetInterviewState,
} from "../domain/interview.js";
import {
	type ClientMessage,
	type StartInterviewMessage,
	type StopInterviewMessage,
	VALID_CLIENT_TYPES,
} from "../domain/message.js";
import {
	appendConversation,
	clearConversation,
	formatForPrompt,
} from "../domain/quick-memory.js";
import { LlmError, getFastResponse } from "../llm/fast-lane.js";
import { FAST_LANE_SYSTEM_PROMPT } from "../llm/prompts/fast-lane-system.js";
import { INTERVIEW_FAST_LANE_PROMPT } from "../llm/prompts/interview-fast-lane.js";
import { SttError, transcribeAudio } from "../llm/stt.js";

type ConnectionState = {
	authenticated: boolean;
	sessionId: string | null;
	audioFormat: "mp3" | "pcm" | null;
	socket: WebSocket;
	audioBuffer: Buffer[];
	lastMessageTime: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	interviewState: InterviewState;
};

const connections = new Map<string, ConnectionState>();

function getSessionState(sessionId: string): ConnectionState | undefined {
	for (const state of connections.values()) {
		if (state.sessionId === sessionId) return state;
	}
	return undefined;
}

export function sendToSession(
	sessionId: string,
	msg: Record<string, unknown>,
): boolean {
	const state = getSessionState(sessionId);
	if (!state) return false;
	try {
		state.socket.send(JSON.stringify(msg));
		return true;
	} catch {
		return false;
	}
}

export function broadcastAuthenticated(msg: Record<string, unknown>): number {
	let sent = 0;
	for (const state of connections.values()) {
		if (state.authenticated) {
			try {
				state.socket.send(JSON.stringify(msg));
				sent++;
			} catch {
				// ignore individual send failures
			}
		}
	}
	return sent;
}

export function getInterviewState(sessionId: string): InterviewState | null {
	const state = getSessionState(sessionId);
	return state?.interviewState ?? null;
}

export function getInterviewStateOrThrow(sessionId: string): InterviewState {
	const state = getSessionState(sessionId);
	if (!state) {
		throw new Error(`Session ${sessionId} not found`);
	}
	return state.interviewState;
}

const idCache = new Map<string, { result: unknown; timestamp: number }>();
let idCacheAccessCount = 0;
function cleanIdCache(): void {
	if (idCache.size > env.ID_CACHE_SIZE) {
		const entries = [...idCache.entries()];
		entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
		const toRemove = entries.slice(
			0,
			entries.length - Math.floor(env.ID_CACHE_SIZE * 0.8),
		);
		for (const [key] of toRemove) {
			idCache.delete(key);
		}
	}
	idCacheAccessCount++;
	if (idCacheAccessCount >= 100) {
		idCacheAccessCount = 0;
		for (const [key, value] of idCache.entries()) {
			if (Date.now() - value.timestamp > env.ID_CACHE_TTL_MS) {
				idCache.delete(key);
			}
		}
	}
}

function checkIdempotency(id: string): boolean {
	if (idCache.has(id)) {
		return true;
	}
	idCache.set(id, { result: null, timestamp: Date.now() });
	cleanIdCache();
	return false;
}

function getRateLimitKey(sessionId: string, type: string): string {
	return `${sessionId}:${type}`;
}

const rateLimitCounts = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(sessionId: string, type: string): boolean {
	const key = getRateLimitKey(sessionId, type);
	const now = Date.now();
	const entry = rateLimitCounts.get(key);
	if (!entry || now > entry.resetAt) {
		rateLimitCounts.set(key, { count: 1, resetAt: now + 1000 });
		return true;
	}
	if (type === "audio_chunk" && entry.count >= env.RATE_LIMIT_AUDIO) {
		return false;
	}
	if (type !== "audio_chunk" && entry.count >= env.RATE_LIMIT_OTHER) {
		return false;
	}
	entry.count++;
	return true;
}

function encodePcmToWav(pcmBuffer: Buffer): Buffer {
	const sampleRate = 16000;
	const bitsPerSample = 16;
	const numChannels = 1;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = pcmBuffer.length;
	const headerSize = 44;
	const totalSize = headerSize + dataSize;

	const wav = Buffer.alloc(totalSize);
	wav.write("RIFF", 0);
	wav.writeUInt32LE(totalSize - 8, 4);
	wav.write("WAVE", 8);
	wav.write("fmt ", 12);
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(numChannels, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(byteRate, 28);
	wav.writeUInt16LE(blockAlign, 32);
	wav.writeUInt16LE(bitsPerSample, 34);
	wav.write("data", 36);
	wav.writeUInt32LE(dataSize, 40);
	pcmBuffer.copy(wav, 44);
	return wav;
}

function generateId(): string {
	return crypto.randomUUID();
}

export async function wsRoutes(app: FastifyInstance): Promise<void> {
	app.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
		const connectionId = generateId();
		const state: ConnectionState = {
			authenticated: false,
			sessionId: null,
			audioFormat: null,
			socket,
			audioBuffer: [],
			lastMessageTime: Date.now(),
			idleTimer: null,
			interviewState: createInterviewState(),
		};
		connections.set(connectionId, state);

		function resetIdleTimer(): void {
			if (state.idleTimer) clearTimeout(state.idleTimer);
			state.idleTimer = setTimeout(() => {
				logger.info(
					{ sessionId: state.sessionId },
					"Idle timeout, closing connection",
				);
				socket.close();
			}, env.WS_IDLE_TIMEOUT_MS);
		}

		resetIdleTimer();

		function sendJson(msg: Record<string, unknown>): void {
			try {
				socket.send(JSON.stringify(msg));
			} catch (error) {
				logger.error(
					{ error, sessionId: state.sessionId },
					"Error sending WS message",
				);
			}
		}

		function sendError(
			code: string,
			message: string,
			correlationId?: string,
		): void {
			sendJson({
				version: "1",
				type: "error",
				code,
				message,
				...(correlationId ? { correlation_id: correlationId } : {}),
			});
		}

		socket.on("message", async (raw: Buffer) => {
			let msg: ClientMessage;
			try {
				const parsed = JSON.parse(raw.toString("utf-8"));
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					typeof parsed.type !== "string"
				) {
					sendError("INVALID_MESSAGE", "Formato inválido");
					return;
				}
				if (!VALID_CLIENT_TYPES.has(parsed.type)) {
					sendError(
						"INVALID_MESSAGE",
						`Tipo de mensaje desconocido: ${parsed.type}`,
					);
					return;
				}
				msg = parsed as ClientMessage;
			} catch {
				sendError("INVALID_MESSAGE", "Formato JSON inválido");
				return;
			}

			state.lastMessageTime = Date.now();
			resetIdleTimer();

			if (!state.authenticated) {
				if (msg.type !== "auth") {
					sendError("AUTH_FAILED", "Debe autenticarse primero con auth");
					return;
				}
				await handleAuth(msg);
				return;
			}

			if (!checkRateLimit(state.sessionId ?? connectionId, msg.type)) {
				sendError("RATE_LIMITED", "Demasiados mensajes, intente de nuevo");
				return;
			}

			if (msg.type === "audio_chunk") {
				handleAudioChunk(msg);
			} else if (msg.type === "audio_end") {
				await handleAudioEnd(msg);
			} else if (msg.type === "register_fcm_token") {
				await handleRegisterFcmToken(msg);
			} else if (msg.type === "start_interview") {
				await handleStartInterview(msg);
			} else if (msg.type === "stop_interview") {
				await handleStopInterview(msg);
			}
		});

		socket.on("close", () => {
			logger.info({ sessionId: state.sessionId }, "WebSocket desconectado");
			if (state.idleTimer) clearTimeout(state.idleTimer);
			connections.delete(connectionId);
		});

		async function handleAuth(msg: ClientMessage): Promise<void> {
			if (msg.type !== "auth") return;
			if (!app.verifyAuth(msg.token)) {
				sendError("AUTH_FAILED", "Token inválido");
				return;
			}
			state.authenticated = true;
			state.sessionId = generateId();
			state.audioFormat = msg.audio_format ?? "mp3";
			clearConversation();
			resetInterviewState(state.interviewState);
			const correlationId = msg.id;

			sendJson({
				version: "1",
				type: "auth_ok",
				session_id: state.sessionId,
				audio_format: state.audioFormat,
				...(correlationId ? { correlation_id: correlationId } : {}),
			});
			logger.info(
				{ sessionId: state.sessionId, audioFormat: state.audioFormat },
				"WebSocket autenticado",
			);
		}

		async function handleAudioChunk(msg: ClientMessage): Promise<void> {
			if (msg.type !== "audio_chunk") return;
			try {
				const chunk = Buffer.from(msg.data, "base64");
				state.audioBuffer.push(chunk);
			} catch {
				sendError("INVALID_MESSAGE", "audio_chunk data inválido");
			}
		}

		async function handleRegisterFcmToken(msg: ClientMessage): Promise<void> {
			if (msg.type !== "register_fcm_token") return;
			try {
				await deviceRepository.upsertDevice(
					msg.token,
					msg.platform ?? "unknown",
				);
				logger.info({ sessionId: state.sessionId }, "FCM token registrado");
				sendJson({
					version: "1",
					type: "notification_registered",
					...(msg.id ? { correlation_id: msg.id } : {}),
				});
			} catch (error) {
				logger.error(
					{ error, sessionId: state.sessionId },
					"Error registrando FCM token",
				);
				sendError(
					"INTERNAL_ERROR",
					"Error al registrar token de notificación",
					msg.id,
				);
			}
		}

		async function handleAudioEnd(msg: ClientMessage): Promise<void> {
			if (msg.type !== "audio_end") return;

			const correlationId = msg.id ?? generateId();

			if (msg.id && checkIdempotency(msg.id)) {
				logger.warn({ id: msg.id }, "Mensaje duplicado ignorado");
				return;
			}

			if (state.audioBuffer.length === 0) {
				sendError("INVALID_MESSAGE", "No hay audio para procesar");
				return;
			}

			const pcmBuffer = Buffer.concat(state.audioBuffer);
			state.audioBuffer = [];

			const wavBuffer = encodePcmToWav(pcmBuffer);

			const transcribed = await transcribeAudio(wavBuffer);
			if (!transcribed.ok) {
				sendError(
					"STT_ERROR",
					"No se pudo transcribir el audio",
					correlationId,
				);
				return;
			}

			const userText = transcribed.value;
			logger.info(
				{ correlationId, sessionId: state.sessionId, text: userText },
				"Audio transcrito",
			);

			sendJson({
				version: "1",
				type: "transcription",
				content: userText,
				correlation_id: correlationId,
			});

			if (state.sessionId) {
				await addTurn({
					sessionId: state.sessionId,
					role: ConversationRole.user,
					content: userText,
				}).catch((error) => {
					logger.error(
						{ error, correlationId },
						"Error guardando turno de usuario",
					);
				});
			}

			const quickContext = formatForPrompt();
			const currentTimeStr = `\n\n## Fecha y hora actual\n${formatCurrentTime()}`;

			let fastLanePrompt: string;
			if (state.interviewState.active) {
				const interviewCtx = formatInterviewContext(state.interviewState);
				fastLanePrompt = `${INTERVIEW_FAST_LANE_PROMPT}\n\n${interviewCtx}${currentTimeStr}`;
			} else {
				fastLanePrompt = quickContext
					? `${FAST_LANE_SYSTEM_PROMPT}\n\n${quickContext}${currentTimeStr}`
					: `${FAST_LANE_SYSTEM_PROMPT}\n\n## Contexto rápido\nNo hay contexto disponible en este momento. Respondé de forma breve y neutral, sin especular sobre si existen o no datos del usuario. Si el usuario pregunta por su información, indicá que lo estás verificando.${currentTimeStr}`;
			}
			const abortController = new AbortController();
			const fastResponsePromise = getFastResponse(
				userText,
				fastLanePrompt,
				abortController.signal,
			);

			const timeoutMs = env.FAST_LANE_TIMEOUT_MS;
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new DOMException("Timeout", "AbortError")),
					timeoutMs,
				),
			);

			let fastResult:
				| { ok: true; value: string[] }
				| { ok: false; error: LlmError };

			try {
				fastResult = await Promise.race([
					fastResponsePromise,
					timeoutPromise,
				]).catch((error) => {
					if (error instanceof DOMException && error.name === "AbortError") {
						abortController.abort();
						return { ok: false, error: LlmError.TIMEOUT } as const;
					}
					throw error;
				});
			} catch (error) {
				logger.error(
					{
						error:
							error instanceof Error
								? { message: error.message, name: error.name }
								: { raw: String(error) },
						correlationId,
						sessionId: state.sessionId,
					},
					"Excepción no capturada en vía rápida",
				);
				fastResult = {
					ok: false,
					error: LlmError.RESPONSE_PARSE_FAILED as const,
				};
			}

			let fastLaneResponse: string | undefined;

			if (!fastResult.ok) {
				logger.warn(
					{
						error: fastResult.error,
						correlationId,
						sessionId: state.sessionId,
					},
					"Vía rápida falló, usando fallback",
				);
			}

			if (fastResult.ok) {
				const messages = fastResult.value;
				fastLaneResponse = messages.join("\n");
				for (const msg of messages) {
					sendJson({
						version: "1",
						type: "text",
						content: msg,
						correlation_id: correlationId,
					});
				}
				// NO audio_end — la vía lenta lo envía cuando termine

				if (state.sessionId) {
					for (const msg of messages) {
						await addTurn({
							sessionId: state.sessionId,
							role: ConversationRole.assistant,
							content: msg,
						}).catch((error) => {
							logger.error(
								{ error, correlationId },
								"Error guardando turno assistant",
							);
						});
					}
				}

				appendConversation(userText, messages);
			} else {
				sendJson({
					version: "1",
					type: "text",
					content: "Un momento, estoy procesando...",
					correlation_id: correlationId,
				});
				// NO audio_end — la vía lenta lo envía cuando termine
			}

			if (state.sessionId) {
				try {
					const jobPayload: Record<string, unknown> = {
						transcribed_text: userText,
						audio_format: state.audioFormat ?? "mp3",
						received_at: new Date().toISOString(),
					};
					if (fastLaneResponse) {
						jobPayload.fast_lane_response = fastLaneResponse;
					}

					if (state.interviewState.active) {
						jobPayload.current_question = state.interviewState.currentQuestion;
						jobPayload.interview_history =
							state.interviewState.history.slice(-10);
						jobPayload.interview_plan = state.interviewState.plan;
					}

					const jobType = state.interviewState.active
						? "interview_response"
						: "process_message";

					await enqueueJob({
						correlationId,
						sessionId: state.sessionId,
						type: jobType,
						payload: jobPayload,
					});
					logger.info(
						{ correlationId, jobType },
						"Job encolado para vía lenta",
					);
				} catch (error) {
					logger.error({ error, correlationId }, "Error encolando job");
				}
			}
		}

		async function handleStartInterview(
			msg: StartInterviewMessage,
		): Promise<void> {
			if (msg.type !== "start_interview") return;
			const correlationId = msg.id ?? generateId();

			if (state.interviewState.active) {
				logger.warn(
					{ sessionId: state.sessionId },
					"Interview ya activo, ignorando start",
				);
				return;
			}

			state.interviewState.active = true;
			state.interviewState.plan = null;
			state.interviewState.history = [];
			state.interviewState.currentQuestion = null;

			logger.info({ sessionId: state.sessionId }, "Modo interview activado");

			sendJson({
				version: "1",
				type: "interview_started",
				correlation_id: correlationId,
			});

			sendJson({
				version: "1",
				type: "text",
				content:
					"Ya, vamos a conocernos mejor. Te voy a hacer unas preguntas pa' entender mejor cómo organizarte. Cuando terminés, tocá el botón de nuevo pa' salir del modo preguntas.",
				correlation_id: correlationId,
			});

			if (state.sessionId) {
				try {
					await enqueueJob({
						correlationId,
						sessionId: state.sessionId,
						type: "interview_scan",
						payload: {
							received_at: new Date().toISOString(),
						},
					});
					logger.info({ correlationId }, "Job interview_scan encolado");
				} catch (error) {
					logger.error(
						{ error, correlationId },
						"Error encolando interview_scan",
					);
					sendJson({
						version: "1",
						type: "audio_end",
						correlation_id: correlationId,
					});
				}
			}
		}

		async function handleStopInterview(
			msg: StopInterviewMessage,
		): Promise<void> {
			if (msg.type !== "stop_interview") return;
			const correlationId = msg.id ?? generateId();

			if (!state.interviewState.active) {
				logger.warn(
					{ sessionId: state.sessionId },
					"Interview no activo, ignorando stop",
				);
				return;
			}

			const plan = state.interviewState.plan;
			const history = state.interviewState.history;

			const summary = {
				questions_asked: plan?.totalAsked ?? history.length,
				areas_covered: plan
					? plan.areas.filter((a) => a.status === "covered").map((a) => a.name)
					: [],
				entities_created: plan?.entitiesCreated ?? 0,
			};

			logger.info(
				{ sessionId: state.sessionId, summary },
				"Modo interview desactivado",
			);

			// Primero limpiar estado local
			state.interviewState.active = false;
			state.interviewState.plan = null;
			state.interviewState.history = [];
			state.interviewState.currentQuestion = null;

			// Encolar job de resumen antes de responder al cliente
			if (state.sessionId) {
				try {
					await enqueueJob({
						correlationId,
						sessionId: state.sessionId,
						type: "interview_summary",
						payload: {
							history,
							plan,
							summary,
							received_at: new Date().toISOString(),
						},
					});
					logger.info({ correlationId }, "Job interview_summary encolado");
				} catch (error) {
					logger.error(
						{ error, correlationId },
						"Error encolando interview_summary",
					);
				}
			}

			// Luego responder al cliente
			sendJson({
				version: "1",
				type: "interview_ended",
				summary,
				correlation_id: correlationId,
			});

			if (history.length > 0) {
				sendJson({
					version: "1",
					type: "text",
					content: `Listo, terminamos el interview. Hicimos ${summary.questions_asked} preguntas y cubrimos ${summary.areas_covered.length} áreas.`,
					correlation_id: correlationId,
				});
			} else {
				sendJson({
					version: "1",
					type: "text",
					content: "Listo, salimos del modo preguntas.",
					correlation_id: correlationId,
				});
			}

			if (state.sessionId) {
				try {
					await enqueueJob({
						correlationId,
						sessionId: state.sessionId,
						type: "interview_summary",
						payload: {
							history,
							plan,
							summary,
							received_at: new Date().toISOString(),
						},
					});
					logger.info({ correlationId }, "Job interview_summary encolado");
				} catch (error) {
					logger.error(
						{ error, correlationId },
						"Error encolando interview_summary",
					);
				}
			}

			state.interviewState.active = false;
			state.interviewState.plan = null;
			state.interviewState.history = [];
			state.interviewState.currentQuestion = null;
		}
	});
}
