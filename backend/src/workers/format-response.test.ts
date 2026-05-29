import { describe, expect, it } from "vitest";
import { formatActionResponse } from "./format-response.js";

describe("formatActionResponse - error", () => {
	it("usa el mensaje de error del payload", () => {
		const result = formatActionResponse("query_list", false, {
			error: "LIST_NOT_FOUND",
			message: "No encontré una lista con ese nombre",
		});
		expect(result).toBe("No encontré una lista con ese nombre");
	});

	it("fallback si no hay mensaje", () => {
		const result = formatActionResponse("query_list", false, {
			error: "INTERNAL_ERROR",
		});
		expect(result).toBe("algo salió mal");
	});
});

describe("formatActionResponse - query_list", () => {
	it("incluye items con cantidad cuando está disponible", () => {
		const result = formatActionResponse("query_list", true, {
			id: "list-1",
			title: "Lista del supermercado",
			type: "shopping",
			items: [
				{ content: "Tomates", quantity: "2 kg", checked: false },
				{ content: "Lechuga", quantity: "1 unidad", checked: false },
			],
		});
		expect(result).toBe(
			'En la lista "Lista del supermercado" tenés: Tomates (2 kg), Lechuga (1 unidad)',
		);
	});

	it("incluye items sin cantidad", () => {
		const result = formatActionResponse("query_list", true, {
			id: "list-1",
			title: "Lista simple",
			items: [
				{ content: "Pan", checked: false },
				{ content: "Leche", checked: false },
			],
		});
		expect(result).toBe('En la lista "Lista simple" tenés: Pan, Leche');
	});

	it("muestra items checked con ✓", () => {
		const result = formatActionResponse("query_list", true, {
			id: "list-1",
			title: "Compra",
			items: [
				{ content: "Tomates", checked: true },
				{ content: "Lechuga", checked: false },
			],
		});
		expect(result).toBe('En la lista "Compra" tenés: ✓ Tomates, Lechuga');
	});

	it("fallback si falta title o items", () => {
		const result = formatActionResponse("query_list", true, {
			id: "list-1",
		});
		expect(result).toBe("No encontré información de la lista");
	});
});

describe("formatActionResponse - list actions", () => {
	it("create_list con items", () => {
		const result = formatActionResponse("create_list", true, {
			id: "list-1",
			title: "Supermercado",
			items: [{ content: "Pan" }, { content: "Leche" }],
		});
		expect(result).toBe('Creé la lista "Supermercado" con 2 items');
	});

	it("create_list sin items", () => {
		const result = formatActionResponse("create_list", true, {
			id: "list-1",
			title: "Vacía",
			items: [],
		});
		expect(result).toBe('Creé la lista "Vacía"');
	});

	it("add_list_items", () => {
		const result = formatActionResponse("add_list_items", true, {
			id: "list-1",
			items: [{ content: "Pan" }, { content: "Leche" }, { content: "Huevos" }],
		});
		expect(result).toBe("Agregué 3 items a la lista");
	});

	it("check_list_item", () => {
		const result = formatActionResponse("check_list_item", true, {});
		expect(result).toBe("El item fue marcado como completado");
	});

	it("uncheck_list_item", () => {
		const result = formatActionResponse("uncheck_list_item", true, {});
		expect(result).toBe("Desmarqué el item de la lista");
	});

	it("complete_list", () => {
		const result = formatActionResponse("complete_list", true, {});
		expect(result).toBe("La lista fue marcada como completada");
	});

	it("cancel_list", () => {
		const result = formatActionResponse("cancel_list", true, {});
		expect(result).toBe("La lista fue cancelada");
	});
});

describe("formatActionResponse - task actions", () => {
	it("create_task con título y prioridad", () => {
		const result = formatActionResponse("create_task", true, {
			id: "task-1",
			title: "Revisar presupuesto",
			priority: "high",
		});
		expect(result).toBe(
			'Creé la tarea "Revisar presupuesto" con prioridad high',
		);
	});

	it("create_task solo título", () => {
		const result = formatActionResponse("create_task", true, {
			id: "task-1",
			title: "Comprar leche",
		});
		expect(result).toBe('Creé la tarea "Comprar leche"');
	});

	it("start_task", () => {
		const result = formatActionResponse("start_task", true, {});
		expect(result).toBe("La tarea fue iniciada");
	});

	it("update_task con título", () => {
		const result = formatActionResponse("update_task", true, {
			id: "task-1",
			title: "Tarea actualizada",
		});
		expect(result).toBe('Actualicé la tarea "Tarea actualizada"');
	});

	it("complete_task con título", () => {
		const result = formatActionResponse("complete_task", true, {
			id: "task-1",
			title: "Revisar presupuesto",
		});
		expect(result).toBe('Marcé "Revisar presupuesto" como completada');
	});

	it("cancel_task", () => {
		const result = formatActionResponse("cancel_task", true, {});
		expect(result).toBe("La tarea fue cancelada");
	});

	it("postpone_task con fecha", () => {
		const result = formatActionResponse("postpone_task", true, {
			id: "task-1",
			due_date: "2026-06-15T23:59:59Z",
		});
		expect(result).toContain("La tarea fue pospuesta para el");
	});
});

describe("formatActionResponse - objective actions", () => {
	it("create_objective", () => {
		const result = formatActionResponse("create_objective", true, {
			id: "obj-1",
			title: "Ahorrar para vacaciones",
		});
		expect(result).toBe('Creé el objetivo "Ahorrar para vacaciones"');
	});

	it("update_objective", () => {
		const result = formatActionResponse("update_objective", true, {
			id: "obj-1",
			title: "Nuevo título",
		});
		expect(result).toBe('Actualicé el objetivo "Nuevo título"');
	});

	it("complete_objective", () => {
		const result = formatActionResponse("complete_objective", true, {});
		expect(result).toBe("El objetivo fue marcado como completado");
	});

	it("cancel_objective con tareas en cascada", () => {
		const result = formatActionResponse("cancel_objective", true, {
			id: "obj-1",
			cancelled_tasks: 3,
		});
		expect(result).toBe(
			"El objetivo fue cancelado junto con 3 tareas pendientes",
		);
	});

	it("pause_objective", () => {
		const result = formatActionResponse("pause_objective", true, {});
		expect(result).toBe("El objetivo fue pausado");
	});

	it("resume_objective", () => {
		const result = formatActionResponse("resume_objective", true, {});
		expect(result).toBe("El objetivo fue reactivado");
	});
});

describe("formatActionResponse - respond", () => {
	it("retorna los mensajes unidos del payload (nuevo formato)", () => {
		const result = formatActionResponse("respond", true, {
			messages: [
				"Tenés 3 tareas pendientes.",
				"La más urgente es revisar el presupuesto.",
			],
		});
		expect(result).toBe(
			"Tenés 3 tareas pendientes.\nLa más urgente es revisar el presupuesto.",
		);
	});

	it("fallback a text si no hay messages (legacy)", () => {
		const result = formatActionResponse("respond", true, {
			text: "Tenés 3 tareas pendientes.",
		});
		expect(result).toBe("Tenés 3 tareas pendientes.");
	});
});

describe("formatActionResponse - query_list all lists", () => {
	it("muestra lista de listas cuando hay múltiples", () => {
		const result = formatActionResponse("query_list", true, {
			lists: [
				{ id: "l1", title: "Supermercado", type: "shopping", items: [] },
				{ id: "l2", title: "Despensa", type: "general", items: [] },
			],
		});
		expect(result).toBe(
			'Tenés 2 listas: "Supermercado" (shopping), "Despensa" (general)',
		);
	});

	it("muestra una sola lista con items", () => {
		const result = formatActionResponse("query_list", true, {
			lists: [
				{
					id: "l1",
					title: "Supermercado",
					type: "shopping",
					items: [
						{ content: "Tomates", quantity: "2 kg", checked: false },
						{ content: "Lechuga", checked: false },
					],
				},
			],
		});
		expect(result).toBe(
			'Tenés una lista: "Supermercado" con: Tomates (2 kg), Lechuga',
		);
	});
});

describe("formatActionResponse - memory", () => {
	it("store_memory", () => {
		const result = formatActionResponse("store_memory", true, {
			id: "mem-1",
			content: "prefiere trabajar de mañana",
		});
		expect(result).toBe("Entendido, lo tengo en cuenta");
	});
});

describe("formatActionResponse - fallback", () => {
	it("acción desconocida retorna mensaje genérico", () => {
		const result = formatActionResponse("unknown_action", true, {});
		expect(result).toBe("Listo, ya está hecho");
	});
});
