import { logger } from "../config/logger.js";

export interface QuickMemoryData {
	whoAmI: string;
	topData: {
		tasks: string[];
		objectives: string[];
		lists: string[];
		events: string[];
		projects: string[];
		ideas: string[];
	};
	todayContext: {
		dueToday: string[];
		inProgress: string[];
		recentMentions: string;
	};
	recentTopics: string;
	recentConversation: string[];
	lastTopics: string;
	updatedAt: Date;
}

let current: QuickMemoryData | null = null;

const MAX_CHARS = 2800;

export function update(data: QuickMemoryData): void {
	current = {
		...data,
		topData: {
			...data.topData,
			projects: data.topData.projects ?? [],
			ideas: data.topData.ideas ?? [],
		},
		recentConversation: data.recentConversation ?? [],
		lastTopics: data.lastTopics ?? "",
		updatedAt: new Date(),
	};
	logger.info({ updatedAt: current.updatedAt }, "Quick memory updated");
}

export function appendConversation(
	userMsg: string,
	assistantMsgs: string[],
): void {
	if (!current) return;
	const exchange = `[usuario] ${userMsg}\n[asistente] ${assistantMsgs.join("\n")}`;
	current.recentConversation.push(exchange);
	if (current.recentConversation.length > 6) {
		current.recentConversation.shift();
	}
}

export function clearConversation(): void {
	if (!current) return;
	current.recentConversation = [];
	current.lastTopics = "";
}

export function updateLastTopics(topics: string): void {
	if (!current) return;
	current.lastTopics = topics;
}

export function get(): QuickMemoryData | null {
	return current;
}

export function isEmpty(): boolean {
	return current === null;
}

export function formatForPrompt(): string {
	if (!current) return "";

	const lines: string[] = [];

	const hasWhoAmI = Boolean(current.whoAmI);

	const topItems: string[] = [];
	const tasks = current.topData.tasks;
	const objectives = current.topData.objectives;
	const lists = current.topData.lists;
	const events = current.topData.events;
	const projects = current.topData.projects ?? [];
	const ideas = current.topData.ideas ?? [];
	if (tasks.length > 0) topItems.push(`Tareas: ${tasks.join(", ")}`);
	if (objectives.length > 0)
		topItems.push(`Objetivos: ${objectives.join(", ")}`);
	if (lists.length > 0) topItems.push(`Listas: ${lists.join(", ")}`);
	if (events.length > 0) topItems.push(`Eventos: ${events.join(", ")}`);
	if (projects.length > 0) topItems.push(`Proyectos: ${projects.join(", ")}`);
	if (ideas.length > 0) topItems.push(`Ideas: ${ideas.join(", ")}`);

	const todayItems: string[] = [];
	const dueToday = current.todayContext.dueToday;
	const inProgress = current.todayContext.inProgress;
	if (dueToday.length > 0) todayItems.push(`Vence hoy: ${dueToday.join(", ")}`);
	if (inProgress.length > 0)
		todayItems.push(`En progreso: ${inProgress.join(", ")}`);
	if (current.todayContext.recentMentions)
		todayItems.push(`Reciente: ${current.todayContext.recentMentions}`);

	const hasRecentTopics = Boolean(current.recentTopics);
	const hasConversation =
		current.recentConversation.length > 0 || Boolean(current.lastTopics);

	const hasContent =
		hasWhoAmI ||
		topItems.length > 0 ||
		todayItems.length > 0 ||
		hasRecentTopics ||
		hasConversation;
	if (!hasContent) return "";

	lines.push("## Contexto rápido");

	if (hasWhoAmI) {
		lines.push(`### Quién soy\n${current.whoAmI}`);
	}

	if (topItems.length > 0) lines.push(`### Data clave\n${topItems.join("\n")}`);

	if (todayItems.length > 0) lines.push(`### Hoy\n${todayItems.join("\n")}`);

	if (hasRecentTopics) {
		lines.push(`### Temas recientes\n${current.recentTopics}`);
	}

	if (hasConversation) {
		const convParts: string[] = [];
		if (current.lastTopics) {
			convParts.push(`Últimos temas: ${current.lastTopics}`);
		}
		convParts.push(...current.recentConversation);
		lines.push(`### Conversación reciente\n${convParts.join("\n")}`);
	}

	let result = lines.join("\n\n");

	if (result.length > MAX_CHARS) {
		result = truncate(result, MAX_CHARS);
	}

	return result;
}

function truncate(text: string, maxChars: number): string {
	const sections = text.split("\n\n### ");

	const essential: string[] = [];
	const nonEssential: string[] = [];

	for (const s of sections) {
		const prefixed = s.startsWith("### ") ? s : `### ${s}`;
		if (
			prefixed.startsWith("### Quién soy") ||
			prefixed.startsWith("### Data clave")
		) {
			essential.push(prefixed);
		} else {
			nonEssential.push(prefixed);
		}
	}

	let combined = essential.join("\n\n");

	for (const s of nonEssential) {
		const candidate = combined ? `${combined}\n\n${s}` : s;
		if (candidate.length <= maxChars) {
			combined = candidate;
		} else {
			const firstLine = s.split("\n")[0] ?? "";
			const withSummary = combined ? `${combined}\n\n${firstLine}` : firstLine;
			if (withSummary.length <= maxChars) {
				combined = withSummary;
			}
			break;
		}
	}

	if (combined.length > maxChars) {
		combined = `${combined.substring(0, maxChars - 3)}...`;
	}

	return combined;
}
