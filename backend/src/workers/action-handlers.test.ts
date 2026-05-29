import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../db/repositories/list-repository.js", () => ({
	findActiveByExactTitle: vi.fn(),
	findActiveByTitle: vi.fn(),
	getItems: vi.fn(),
	getAllActive: vi.fn(),
	createList: vi.fn(),
	getListById: vi.fn(),
	updateList: vi.fn(),
	transitionListStatus: vi.fn(),
}));

vi.mock("../db/repositories/memory-repository.js", () => ({
	createMemory: vi.fn(),
}));

vi.mock("../db/repositories/objective-repository.js", () => ({
	createObjective: vi.fn(),
	getObjectiveById: vi.fn(),
	updateObjective: vi.fn(),
	transitionObjectiveStatus: vi.fn(),
	getTasksByObjective: vi.fn(),
}));

vi.mock("../db/repositories/task-repository.js", () => ({
	createTask: vi.fn(),
	getTaskById: vi.fn(),
	updateTask: vi.fn(),
	transitionTaskStatus: vi.fn(),
}));

vi.mock("../domain/list.js", () => ({
	ListStatus: {
		ACTIVE: "active",
		COMPLETED: "completed",
		CANCELLED: "cancelled",
	},
	transitionStatus: vi.fn(),
	validateCompleteList: vi.fn(),
	validateItemIndex: vi.fn(),
	validateCreateList: vi.fn(),
}));

vi.mock("../domain/objective.js", () => ({
	ObjectiveStatus: {
		ACTIVE: "active",
		PAUSED: "paused",
		COMPLETED: "completed",
		CANCELLED: "cancelled",
	},
	transitionStatus: vi.fn(),
}));

vi.mock("../domain/task.js", () => ({
	TaskStatus: {
		PENDING: "pending",
		IN_PROGRESS: "in_progress",
		COMPLETED: "completed",
		POSTPONED: "postponed",
		CANCELLED: "cancelled",
	},
	transitionStatus: vi.fn(),
}));

vi.mock("../llm/embeddings.js", () => ({
	generateEmbedding: vi.fn(),
}));

vi.mock("../types/result.js", () => ({
	ok: vi.fn((v) => ({ ok: true, value: v })),
	err: vi.fn((e) => ({ ok: false, error: e })),
}));

const mockItems = [
	{ content: "Tomates", quantity: "2 kg", checked: false },
	{ content: "Lechuga", quantity: "1 unidad", checked: false },
];

const mockList = {
	id: "list-123",
	title: "Lista del supermercado",
	type: "shopping",
	items: mockItems,
};

describe("handleQueryList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna todas las listas activas cuando no hay list_title", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.getAllActive).mockResolvedValue([mockList]);
		vi.mocked(listRepo.getItems).mockReturnValue(mockItems);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList({}, "corr-1");

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			lists: [
				{ id: "list-123", title: "Lista del supermercado", type: "shopping" },
			],
		});
	});

	it("retorna LIST_NOT_FOUND cuando no hay list_title y no hay listas activas", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.getAllActive).mockResolvedValue([]);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList({}, "corr-1");

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "LIST_NOT_FOUND",
		});
	});

	it("retorna todas las listas cuando list_title es string vacío", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.getAllActive).mockResolvedValue([mockList]);
		vi.mocked(listRepo.getItems).mockReturnValue(mockItems);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList({ list_title: "   " }, "corr-1");

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			lists: [
				{ id: "list-123", title: "Lista del supermercado", type: "shopping" },
			],
		});
	});

	it("encuentra lista por título exacto", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.findActiveByExactTitle).mockResolvedValue(mockList);
		vi.mocked(listRepo.getItems).mockReturnValue(mockItems);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList(
			{ list_title: "Lista del supermercado" },
			"corr-1",
		);

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			id: "list-123",
			title: "Lista del supermercado",
			items: mockItems,
		});
	});

	it("encuentra lista por coincidencia parcial cuando hay un solo match", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.findActiveByExactTitle).mockResolvedValue(null);
		vi.mocked(listRepo.findActiveByTitle).mockResolvedValue([mockList]);
		vi.mocked(listRepo.getItems).mockReturnValue(mockItems);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList(
			{ list_title: "supermercado" },
			"corr-1",
		);

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			id: "list-123",
			title: "Lista del supermercado",
		});
	});

	it("retorna LIST_NOT_FOUND si no hay coincidencias", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.findActiveByExactTitle).mockResolvedValue(null);
		vi.mocked(listRepo.findActiveByTitle).mockResolvedValue([]);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList(
			{ list_title: "ferretería" },
			"corr-1",
		);

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "LIST_NOT_FOUND",
		});
	});

	it("retorna AMBIGUOUS_MATCH si hay múltiples coincidencias", async () => {
		const listRepo = await import("../db/repositories/list-repository.js");
		vi.mocked(listRepo.findActiveByExactTitle).mockResolvedValue(null);
		vi.mocked(listRepo.findActiveByTitle).mockResolvedValue([
			mockList,
			{ ...mockList, id: "list-456", title: "Lista del supermercado 2" },
		]);
		vi.mocked(listRepo.getItems).mockReturnValue([]);
		const { handleQueryList } = await import("./action-handlers.js");

		const result = await handleQueryList(
			{ list_title: "supermercado" },
			"corr-1",
		);

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "AMBIGUOUS_MATCH",
		});
	});
});

describe("handleRespond", () => {
	it("retorna los mensajes proporcionados", async () => {
		const { handleRespond } = await import("./action-handlers.js");

		const result = await handleRespond(
			{
				messages: [
					"Tenés 3 tareas pendientes.",
					"La más urgente es revisar el presupuesto.",
				],
			},
			"corr-1",
		);

		expect(result.ok).toBe(true);
		expect(result.payload).toMatchObject({
			messages: [
				"Tenés 3 tareas pendientes.",
				"La más urgente es revisar el presupuesto.",
			],
		});
	});

	it("retorna error si falta messages", async () => {
		const { handleRespond } = await import("./action-handlers.js");

		const result = await handleRespond({}, "corr-1");

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "MISSING_REQUIRED_FIELD",
		});
	});

	it("retorna error si messages es array vacío", async () => {
		const { handleRespond } = await import("./action-handlers.js");

		const result = await handleRespond({ messages: [] }, "corr-1");

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "MISSING_REQUIRED_FIELD",
		});
	});

	it("retorna error si messages tiene solo strings vacíos", async () => {
		const { handleRespond } = await import("./action-handlers.js");

		const result = await handleRespond({ messages: ["   ", ""] }, "corr-1");

		expect(result.ok).toBe(false);
		expect(result.payload).toMatchObject({
			error: "MISSING_REQUIRED_FIELD",
		});
	});
});
