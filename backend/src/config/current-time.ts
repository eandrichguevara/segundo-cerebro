import { env } from "./env.js";

export function formatCurrentTime(): string {
	const now = new Date();
	const formatter = new Intl.DateTimeFormat("es-AR", {
		timeZone: env.TIMEZONE,
		dateStyle: "short",
		timeStyle: "medium",
	});
	return formatter.format(now);
}
