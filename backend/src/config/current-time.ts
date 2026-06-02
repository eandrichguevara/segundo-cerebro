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

export function getStartOfDayInTimezone(date: Date, timezone: string): Date {
	const dateStr = date.toLocaleDateString("en-CA", { timeZone: timezone });
	const parts = dateStr.split("-").map(Number);
	const y = parts[0] ?? 0;
	const m = parts[1] ?? 1;
	const d = parts[2] ?? 1;
	const refDate = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
	const localHour = Number.parseInt(
		refDate.toLocaleString("en-US", {
			timeZone: timezone,
			hour: "numeric",
			hourCycle: "h23",
		}),
	);
	const offsetMs = (12 - localHour) * 3600 * 1000;
	const baseUtc = Date.UTC(y, m - 1, d);
	const result = new Date(baseUtc + offsetMs);

	const resultDate = result.toLocaleDateString("en-CA", {
		timeZone: timezone,
	});
	const resultHour = Number.parseInt(
		result.toLocaleString("en-US", {
			timeZone: timezone,
			hour: "numeric",
			hourCycle: "h23",
		}),
	);

	if (resultDate !== dateStr || resultHour !== 0) {
		const diffMs = resultHour * 3600 * 1000;
		return new Date(result.getTime() - diffMs);
	}

	return result;
}

export function getEndOfDayInTimezone(date: Date, timezone: string): Date {
	const start = getStartOfDayInTimezone(date, timezone);
	return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

export function getDateRange(
	days: number,
	timezone: string,
): { start: Date; end: Date } {
	const now = new Date();
	const start = getStartOfDayInTimezone(now, timezone);
	const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
	return { start, end };
}
