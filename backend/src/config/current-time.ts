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

export function formatTimeInTimezone(date: Date): string {
	return date.toLocaleTimeString("es-AR", {
		timeZone: env.TIMEZONE,
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function formatDateInTimezone(date: Date): string {
	return date.toLocaleDateString("es-AR", {
		timeZone: env.TIMEZONE,
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}
