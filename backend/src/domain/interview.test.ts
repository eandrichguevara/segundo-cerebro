import { describe, expect, it } from "vitest";
import {
	type InterviewPlan,
	type InterviewState,
	addExchange,
	createInterviewState,
	formatInterviewContext,
	formatInterviewPlanForScan,
	incrementEntitiesCreated,
	incrementQuestionsAsked,
	resetInterviewState,
} from "./interview.js";

describe("createInterviewState", () => {
	it("crea estado vacío por defecto", () => {
		const state = createInterviewState();
		expect(state.active).toBe(false);
		expect(state.plan).toBeNull();
		expect(state.history).toEqual([]);
		expect(state.currentQuestion).toBeNull();
	});
});

describe("resetInterviewState", () => {
	it("resetea todos los campos", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [
					{
						name: "Test",
						priority: "high",
						plannedQuestions: [],
						askedQuestions: [],
						status: "pending",
					},
				],
				startedAt: new Date(),
				totalAsked: 5,
				entitiesCreated: 2,
			},
			history: [{ question: "?", answer: "!", actionsTaken: ["create_task"] }],
			currentQuestion: "¿Qué tal?",
		};

		resetInterviewState(state);

		expect(state.active).toBe(false);
		expect(state.plan).toBeNull();
		expect(state.history).toEqual([]);
		expect(state.currentQuestion).toBeNull();
	});

	it("no falla si ya está vacío", () => {
		const state = createInterviewState();
		resetInterviewState(state);
		expect(state.active).toBe(false);
	});
});

describe("addExchange", () => {
	it("agrega exchange al historial", () => {
		const state = createInterviewState();
		addExchange(state, {
			question: "¿A qué hora trabajai?",
			answer: "De 9 a 6",
			actionsTaken: ["create_event"],
		});

		expect(state.history).toHaveLength(1);
		expect(state.history[0].question).toBe("¿A qué hora trabajai?");
		expect(state.history[0].answer).toBe("De 9 a 6");
		expect(state.history[0].actionsTaken).toEqual(["create_event"]);
	});

	it("trunca el historial si excede MAX_HISTORY (15)", () => {
		const state = createInterviewState();
		for (let i = 0; i < 20; i++) {
			addExchange(state, {
				question: `Q${i}`,
				answer: `A${i}`,
				actionsTaken: [],
			});
		}
		expect(state.history).toHaveLength(15);
		expect(state.history[0].question).toBe("Q5");
		expect(state.history[14].question).toBe("Q19");
	});

	it("permite exchanges con listas vacías", () => {
		const state = createInterviewState();
		addExchange(state, { question: "?", answer: "!", actionsTaken: [] });
		expect(state.history).toHaveLength(1);
		expect(state.history[0].actionsTaken).toEqual([]);
	});

	it("no modifica el historial si no se agrega nada", () => {
		const state = createInterviewState();
		expect(state.history).toHaveLength(0);
	});
});

describe("incrementEntitiesCreated", () => {
	it("incrementa entidades creadas si hay plan", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [],
				startedAt: new Date(),
				totalAsked: 0,
				entitiesCreated: 0,
			},
			history: [],
			currentQuestion: null,
		};

		incrementEntitiesCreated(state);
		expect(state.plan?.entitiesCreated).toBe(1);

		incrementEntitiesCreated(state);
		expect(state.plan?.entitiesCreated).toBe(2);
	});

	it("no incrementa totalAsked", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [],
				startedAt: new Date(),
				totalAsked: 0,
				entitiesCreated: 0,
			},
			history: [],
			currentQuestion: null,
		};

		incrementEntitiesCreated(state);
		expect(state.plan?.totalAsked).toBe(0);
	});

	it("no falla si el plan es null", () => {
		const state = createInterviewState();
		expect(() => incrementEntitiesCreated(state)).not.toThrow();
	});
});

describe("incrementQuestionsAsked", () => {
	it("incrementa totalAsked si hay plan", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [],
				startedAt: new Date(),
				totalAsked: 3,
				entitiesCreated: 1,
			},
			history: [],
			currentQuestion: null,
		};

		incrementQuestionsAsked(state);
		expect(state.plan?.totalAsked).toBe(4);
	});

	it("no incrementa entitiesCreated", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [],
				startedAt: new Date(),
				totalAsked: 0,
				entitiesCreated: 0,
			},
			history: [],
			currentQuestion: null,
		};

		incrementQuestionsAsked(state);
		expect(state.plan?.entitiesCreated).toBe(0);
	});

	it("no falla si el plan es null", () => {
		const state = createInterviewState();
		expect(() => incrementQuestionsAsked(state)).not.toThrow();
	});
});

describe("formatInterviewContext", () => {
	it("retorna contexto mínimo para estado vacío", () => {
		const state = createInterviewState();
		state.active = true;
		const result = formatInterviewContext(state);
		expect(result).toContain("## Modo Interview Activo");
		expect(result).not.toContain("Pregunta actual");
		expect(result).not.toContain("Áreas activas");
		expect(result).not.toContain("Intercambios recientes");
	});

	it("incluye la pregunta actual si existe", () => {
		const state: InterviewState = {
			active: true,
			plan: null,
			history: [],
			currentQuestion: "¿A qué te dedicai?",
		};
		const result = formatInterviewContext(state);
		expect(result).toContain("¿A qué te dedicai?");
	});

	it("incluye áreas activas si hay plan", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [
					{
						name: "Horarios",
						priority: "high",
						plannedQuestions: [],
						askedQuestions: [],
						status: "exploring",
					},
					{
						name: "Preferencias",
						priority: "medium",
						plannedQuestions: [],
						askedQuestions: [],
						status: "pending",
					},
				],
				startedAt: new Date(),
				totalAsked: 2,
				entitiesCreated: 0,
			},
			history: [],
			currentQuestion: null,
		};
		const result = formatInterviewContext(state);
		expect(result).toContain("Horarios");
		expect(result).toContain("Preferencias");
		expect(result).toContain("Preguntas hechas: 2");
	});

	it("excluye áreas ya cubiertas", () => {
		const state: InterviewState = {
			active: true,
			plan: {
				areas: [
					{
						name: "Horarios",
						priority: "high",
						plannedQuestions: [],
						askedQuestions: [],
						status: "covered",
					},
					{
						name: "Preferencias",
						priority: "medium",
						plannedQuestions: [],
						askedQuestions: [],
						status: "pending",
					},
				],
				startedAt: new Date(),
				totalAsked: 0,
				entitiesCreated: 0,
			},
			history: [],
			currentQuestion: null,
		};
		const result = formatInterviewContext(state);
		expect(result).not.toContain("Horarios");
		expect(result).toContain("Preferencias");
	});

	it("incluye intercambios recientes si hay historial", () => {
		const state: InterviewState = {
			active: true,
			plan: null,
			history: [
				{ question: "Q1", answer: "A1", actionsTaken: [] },
				{ question: "Q2", answer: "A2", actionsTaken: ["create_task"] },
			],
			currentQuestion: null,
		};
		const result = formatInterviewContext(state);
		expect(result).toContain("Q1");
		expect(result).toContain("A1");
		expect(result).toContain("Q2");
		expect(result).toContain("A2");
		expect(result).toContain("Acciones: create_task");
	});

	it("trunca historial a los últimos 5 exchanges", () => {
		const state: InterviewState = {
			active: true,
			plan: null,
			history: Array.from({ length: 10 }, (_, i) => ({
				question: `Q${i}`,
				answer: `A${i}`,
				actionsTaken: [],
			})),
			currentQuestion: null,
		};
		const result = formatInterviewContext(state);
		expect(result).toContain("Q5");
		expect(result).not.toContain("Q0");
		expect(result).toContain("Q9");
	});

	it("no incluye sección de intercambios si el historial está vacío", () => {
		const state = createInterviewState();
		state.active = true;
		const result = formatInterviewContext(state);
		expect(result).not.toContain("Intercambios recientes");
	});
});

describe("formatInterviewPlanForScan", () => {
	it("formatea plan con áreas en distintos estados", () => {
		const plan: InterviewPlan = {
			areas: [
				{
					name: "Horarios",
					priority: "high",
					plannedQuestions: ["¿A qué hora te levantai?"],
					askedQuestions: ["¿Trabajai? (sí)"],
					status: "exploring",
				},
				{
					name: "Preferencias",
					priority: "medium",
					plannedQuestions: [],
					askedQuestions: [],
					status: "covered",
				},
				{
					name: "Reglas",
					priority: "low",
					plannedQuestions: ["¿Domingos sin tareas?"],
					askedQuestions: [],
					status: "pending",
				},
			],
			startedAt: new Date("2026-06-06"),
			totalAsked: 3,
			entitiesCreated: 1,
		};

		const result = formatInterviewPlanForScan(plan);
		expect(result).toContain("Horarios");
		expect(result).toContain("Preferencias");
		expect(result).toContain("Reglas");
		expect(result).toContain("Total preguntas: 3");
		expect(result).toContain("Entidades creadas: 1");
	});

	it("maneja plan sin áreas", () => {
		const plan: InterviewPlan = {
			areas: [],
			startedAt: new Date(),
			totalAsked: 0,
			entitiesCreated: 0,
		};
		const result = formatInterviewPlanForScan(plan);
		expect(result).toContain("Total preguntas: 0");
	});

	it("muestra emojis de estado correctos", () => {
		const plan: InterviewPlan = {
			areas: [
				{
					name: "Cubierta",
					priority: "high",
					plannedQuestions: [],
					askedQuestions: [],
					status: "covered",
				},
				{
					name: "Explorando",
					priority: "medium",
					plannedQuestions: [],
					askedQuestions: [],
					status: "exploring",
				},
				{
					name: "Pendiente",
					priority: "low",
					plannedQuestions: [],
					askedQuestions: [],
					status: "pending",
				},
			],
			startedAt: new Date(),
			totalAsked: 0,
			entitiesCreated: 0,
		};
		const result = formatInterviewPlanForScan(plan);
		expect(result).toContain("✅");
		expect(result).toContain("🔄");
		expect(result).toContain("⏳");
	});
});
