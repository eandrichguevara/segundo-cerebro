export interface AuthMessage {
	version: string;
	type: "auth";
	token: string;
	id?: string;
	audio_format?: "mp3" | "pcm";
}

export interface AudioChunkMessage {
	version: string;
	type: "audio_chunk";
	data: string;
	id?: string;
}

export interface AudioEndMessage {
	version: string;
	type: "audio_end";
	id?: string;
}

export interface RegisterFcmTokenMessage {
	version: string;
	type: "register_fcm_token";
	token: string;
	platform?: string;
	id?: string;
}

export type ClientMessage =
	| AuthMessage
	| AudioChunkMessage
	| AudioEndMessage
	| RegisterFcmTokenMessage;

export const VALID_CLIENT_TYPES = new Set<string>([
	"auth",
	"audio_chunk",
	"audio_end",
	"register_fcm_token",
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
	if (typeof raw !== "object" || raw === null) return null;
	const msg = raw as Record<string, unknown>;
	if (typeof msg.type !== "string" || !VALID_CLIENT_TYPES.has(msg.type))
		return null;
	return msg as unknown as ClientMessage;
}

export interface ServerAuthOk {
	version: "1";
	type: "auth_ok";
	session_id: string;
	audio_format: "mp3" | "pcm";
	correlation_id?: string;
}

export interface ServerAudioChunk {
	version: "1";
	type: "audio_chunk";
	data: string;
	correlation_id?: string;
}

export interface ServerAudioEnd {
	version: "1";
	type: "audio_end";
	correlation_id?: string;
}

export interface ServerText {
	version: "1";
	type: "text";
	content: string;
	correlation_id?: string;
}

export interface ServerActionResult {
	version: "1";
	type: "action_result";
	ok: boolean;
	action: string;
	correlation_id?: string;
	payload: Record<string, unknown>;
}

export interface ServerNotification {
	version: "1";
	type: "notification";
	level: "warning" | "reminder";
	message: string;
	correlation_id?: string;
}

export interface ServerError {
	version: "1";
	type: "error";
	code: string;
	message: string;
	correlation_id?: string;
}

export type ServerMessage =
	| ServerAuthOk
	| ServerAudioChunk
	| ServerAudioEnd
	| ServerText
	| ServerActionResult
	| ServerNotification
	| ServerError;

export type ActionResultPayload = Record<string, unknown>;

export interface ActionResult {
	ok: boolean;
	action: string;
	correlationId: string;
	payload: ActionResultPayload;
}
