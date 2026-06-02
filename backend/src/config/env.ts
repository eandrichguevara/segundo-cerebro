import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	PORT: z.coerce.number().int().positive().default(3000),
	HOST: z.string().default("0.0.0.0"),
	LOG_LEVEL: z
		.enum(["trace", "debug", "info", "warn", "error", "fatal"])
		.default("info"),
	DATABASE_URL: z.string().url(),
	AUTH_TOKEN: z.string().min(1),
	OPENAI_API_KEY: z.string().min(1),
	JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
	JOB_ORPHAN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
	WS_MAX_PAYLOAD: z.coerce.number().int().positive().default(1_048_576),
	WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
	RATE_LIMIT_AUDIO: z.coerce.number().int().positive().default(50),
	RATE_LIMIT_OTHER: z.coerce.number().int().positive().default(10),
	FAST_LANE_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
	OPENAI_STT_MODEL: z.string().default("whisper-1"),
	OPENAI_FAST_MODEL: z.string().default("gpt-4.1-mini"),
	OPENAI_SLOW_MODEL: z.string().default("gpt-5-mini"),
	OPENAI_TTS_MODEL: z.string().default("tts-1-hd"),
	OPENAI_TTS_VOICE: z
		.enum(["alloy", "echo", "fable", "onyx", "nova", "shimmer"])
		.default("nova"),
	CONVERSATION_TURNS_LIMIT: z.coerce.number().int().positive().default(10),
	MEMORY_RETRIEVAL_LIMIT: z.coerce.number().int().positive().default(5),
	SLOW_LANE_MAX_TOKENS: z.coerce.number().int().positive().default(4000),
	ID_CACHE_SIZE: z.coerce.number().int().positive().default(1000),
	ID_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),
	TIMEZONE: z.string().default("America/Argentina/Buenos_Aires"),
	FCM_SERVICE_ACCOUNT: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
	console.error(
		"Invalid environment variables:",
		parsed.error.flatten().fieldErrors,
	);
	process.exit(1);
}

export const env = parsed.data;
