export interface InterviewArea {
	name: string;
	priority: "high" | "medium" | "low";
	plannedQuestions: string[];
	askedQuestions: string[];
	status: "pending" | "exploring" | "covered";
}

export interface InterviewPlan {
	areas: InterviewArea[];
	startedAt: Date;
	totalAsked: number;
	entitiesCreated: number;
}

export interface InterviewExchange {
	question: string;
	answer: string;
	actionsTaken: string[];
}

export interface InterviewState {
	active: boolean;
	plan: InterviewPlan | null;
	history: InterviewExchange[];
	currentQuestion: string | null;
}

const MAX_HISTORY = 15;

export function createInterviewState(): InterviewState {
	return {
		active: false,
		plan: null,
		history: [],
		currentQuestion: null,
	};
}

export function resetInterviewState(state: InterviewState): void {
	state.active = false;
	state.plan = null;
	state.history = [];
	state.currentQuestion = null;
}

export function addExchange(
	state: InterviewState,
	exchange: InterviewExchange,
): void {
	state.history.push(exchange);
	if (state.history.length > MAX_HISTORY) {
		state.history.shift();
	}
}

export function incrementEntitiesCreated(state: InterviewState): void {
	if (state.plan) {
		state.plan.totalAsked++;
		state.plan.entitiesCreated++;
	}
}

export function incrementQuestionsAsked(state: InterviewState): void {
	if (state.plan) {
		state.plan.totalAsked++;
	}
}

export function formatInterviewContext(state: InterviewState): string {
	const lines: string[] = [];
	lines.push("## Modo Interview Activo");

	if (state.currentQuestion) {
		lines.push(`### Pregunta actual\n${state.currentQuestion}`);
	}

	if (state.plan) {
		const activeAreas = state.plan.areas.filter((a) => a.status !== "covered");
		if (activeAreas.length > 0) {
			const areaNames = activeAreas.map((a) => `${a.name} (${a.status})`);
			lines.push(`### Áreas activas\n${areaNames.join(", ")}`);
		}
		lines.push(`### Preguntas hechas: ${state.plan.totalAsked}`);
	}

	if (state.history.length > 0) {
		const recent = state.history.slice(-5);
		const exchanges = recent.map(
			(e) =>
				`P: ${e.question}\nR: ${e.answer}${e.actionsTaken.length > 0 ? `\n   Acciones: ${e.actionsTaken.join(", ")}` : ""}`,
		);
		lines.push(`### Intercambios recientes\n${exchanges.join("\n\n")}`);
	}

	return lines.join("\n\n");
}

export function formatInterviewPlanForScan(plan: InterviewPlan): string {
	const lines: string[] = [];
	lines.push(`Plan iniciado: ${plan.startedAt.toISOString()}`);
	lines.push(`Total preguntas: ${plan.totalAsked}`);
	lines.push(`Entidades creadas: ${plan.entitiesCreated}`);
	lines.push("");
	for (const area of plan.areas) {
		const status =
			area.status === "covered"
				? "✅"
				: area.status === "exploring"
					? "🔄"
					: "⏳";
		lines.push(`${status} ${area.name} (${area.priority})`);
		if (area.askedQuestions.length > 0) {
			lines.push(`   Preguntadas: ${area.askedQuestions.join("; ")}`);
		}
		if (area.plannedQuestions.length > 0) {
			lines.push(`   Pendientes: ${area.plannedQuestions.join("; ")}`);
		}
	}
	return lines.join("\n");
}
