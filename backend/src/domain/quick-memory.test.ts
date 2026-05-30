import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/logger.js", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		trace: vi.fn(),
		child: vi.fn().mockReturnThis(),
	},
}));

import {
	type QuickMemoryData,
	formatForPrompt,
	get,
	isEmpty,
	update,
} from "./quick-memory.js";

describe("quick-memory", () => {
	const sampleData: QuickMemoryData = {
		whoAmI:
			"Emilio, desarrollador fullstack. Valora la eficiencia y la claridad.",
		topData: {
			tasks: ["Revisar presupuesto (high)", "Comprar materiales (medium)"],
			objectives: ["Ahorrar $5000 para vacaciones"],
			lists: ["Supermercado", "Materiales oficina"],
			events: ["Reunión equipo (lun 10:00)", "Daily standup (mar 09:00)"],
		},
		todayContext: {
			dueToday: ["Enviar reporte mensual"],
			inProgress: ["Revisar presupuesto"],
			recentMentions: "Ajuste de gastos hormiga",
		},
		recentTopics: "presupuesto, compras, planificación vacaciones",
		updatedAt: new Date(),
	};

	beforeEach(() => {
		// Reset singleton for pure tests
		update(sampleData);
	});

	afterEach(() => {
		// Reset with empty-ish data via update
		update({
			whoAmI: "Usuario",
			topData: { tasks: [], objectives: [], lists: [], events: [] },
			todayContext: { dueToday: [], inProgress: [], recentMentions: "" },
			recentTopics: "",
			updatedAt: new Date(),
		});
	});

	it("should store and retrieve data", () => {
		const result = get();
		expect(result).not.toBeNull();
		expect(result?.whoAmI).toBe(sampleData.whoAmI);
		expect(result?.topData.tasks).toHaveLength(2);
		expect(result?.topData.events).toHaveLength(2);
		expect(result?.todayContext.dueToday).toContain("Enviar reporte mensual");
		expect(result?.todayContext.inProgress).toContain("Revisar presupuesto");
		expect(result?.recentTopics).toBe(
			"presupuesto, compras, planificación vacaciones",
		);
	});

	it("should not be empty after update", () => {
		expect(isEmpty()).toBe(false);
	});

	it("should be empty initially before any update", () => {
		// Reset to initial state
		update({
			whoAmI: "",
			topData: { tasks: [], objectives: [], lists: [], events: [] },
			todayContext: { dueToday: [], inProgress: [], recentMentions: "" },
			recentTopics: "",
			updatedAt: new Date(),
		});
		expect(isEmpty()).toBe(false); // still has whoAmI default
	});

	it("should format prompt with all sections", () => {
		const formatted = formatForPrompt();
		expect(formatted).toContain("## Contexto rápido");
		expect(formatted).toContain("### Quién soy");
		expect(formatted).toContain("Emilio");
		expect(formatted).toContain("### Data clave");
		expect(formatted).toContain("Revisar presupuesto");
		expect(formatted).toContain("Ahorrar $5000");
		expect(formatted).toContain("Supermercado");
		expect(formatted).toContain("Reunión equipo");
		expect(formatted).toContain("### Hoy");
		expect(formatted).toContain("Vence hoy");
		expect(formatted).toContain("En progreso");
		expect(formatted).toContain("### Temas recientes");
	});

	it("should return empty string when no data", () => {
		update({
			whoAmI: "",
			topData: { tasks: [], objectives: [], lists: [], events: [] },
			todayContext: { dueToday: [], inProgress: [], recentMentions: "" },
			recentTopics: "",
			updatedAt: new Date(),
		});
		expect(formatForPrompt()).toBe("");
	});

	it("should not exceed 2800 characters", () => {
		const longData: QuickMemoryData = {
			whoAmI: "A".repeat(500),
			topData: {
				tasks: Array.from({ length: 10 }, (_, i) => `Task ${i} (high)`),
				objectives: Array.from({ length: 10 }, (_, i) => `Objective ${i}`),
				lists: Array.from({ length: 10 }, (_, i) => `List ${i}`),
				events: Array.from({ length: 10 }, (_, i) => `Event ${i} (date)`),
			},
			todayContext: {
				dueToday: Array.from({ length: 10 }, (_, i) => `Due ${i}`),
				inProgress: Array.from({ length: 10 }, (_, i) => `Progress ${i}`),
				recentMentions: "B".repeat(500),
			},
			recentTopics: "C".repeat(500),
			updatedAt: new Date(),
		};
		update(longData);
		const formatted = formatForPrompt();
		expect(formatted.length).toBeLessThanOrEqual(2800);
	});

	it("should keep whoAmI section even after truncation", () => {
		const longData: QuickMemoryData = {
			whoAmI: "Emilio, desarrollador.",
			topData: {
				tasks: Array.from(
					{ length: 20 },
					(_, i) => `Task ${i} (high priority)`,
				),
				objectives: ["Objective 1"],
				lists: ["List 1"],
				events: ["Event 1"],
			},
			todayContext: {
				dueToday: Array.from({ length: 20 }, (_, i) => `Due ${i}`),
				inProgress: Array.from({ length: 10 }, (_, i) => `Progress ${i}`),
				recentMentions: "X".repeat(1000),
			},
			recentTopics: "Y".repeat(1000),
			updatedAt: new Date(),
		};
		update(longData);
		const formatted = formatForPrompt();
		expect(formatted).toContain("Emilio, desarrollador.");
		expect(formatted.length).toBeLessThanOrEqual(2800);
	});

	it("should format prompt with empty optional sections omitted", () => {
		update({
			whoAmI: "Usuario",
			topData: { tasks: [], objectives: [], lists: [], events: [] },
			todayContext: { dueToday: [], inProgress: [], recentMentions: "" },
			recentTopics: "",
			updatedAt: new Date(),
		});
		const formatted = formatForPrompt();
		expect(formatted).not.toContain("### Data clave");
		expect(formatted).not.toContain("### Hoy");
		expect(formatted).not.toContain("### Temas recientes");
	});
});
