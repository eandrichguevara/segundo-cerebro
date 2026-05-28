import pino from "pino";
import { env } from "./env.js";

export const loggerConfig = {
	level: env.LOG_LEVEL,
	transport:
		env.NODE_ENV === "development"
			? {
					target: "pino-pretty",
					options: { colorize: true, translateTime: "HH:MM:ss.l" },
				}
			: undefined,
	redact: {
		paths: [
			"req.headers.authorization",
			"req.headers.cookie",
			"token",
			"AUTH_TOKEN",
		],
		censor: "[REDACTED]",
	},
};

export const logger = pino(loggerConfig);
