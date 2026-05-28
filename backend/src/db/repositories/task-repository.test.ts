import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		task: {
			create: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
			findMany: vi.fn(),
		},
	},
}));

const mockTask = {
	id: "task-1",
	title: "Test task",
	description: null,
	status: "pending",
	dueDate: null,
	priority: "medium",
	context: {},
	objectiveId: null,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	cancelledAt: null,
};

describe("task-repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createTask", () => {
		it("crea una tarea con valores por defecto", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.create).mockResolvedValue(mockTask);
			const { createTask } = await import("./task-repository.js");

			const result = await createTask({ title: "Test task" });

			expect(prisma.task.create).toHaveBeenCalledWith({
				data: {
					title: "Test task",
					description: null,
					dueDate: null,
					objectiveId: null,
					priority: "medium",
					context: {},
				},
			});
			expect(result).toEqual(mockTask);
		});

		it("crea una tarea con todos los campos opcionales", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.create).mockResolvedValue({
				...mockTask,
				title: "Full task",
				priority: "high",
			});
			const { createTask } = await import("./task-repository.js");

			await createTask({
				title: "Full task",
				description: "Descripción detallada",
				dueDate: "2026-06-01T00:00:00Z",
				objectiveId: "obj-1",
				priority: "high",
				context: { location: "home" },
			});

			expect(prisma.task.create).toHaveBeenCalledWith({
				data: {
					title: "Full task",
					description: "Descripción detallada",
					dueDate: new Date("2026-06-01T00:00:00Z"),
					objectiveId: "obj-1",
					priority: "high",
					context: { location: "home" },
				},
			});
		});
	});

	describe("getTaskById", () => {
		it("retorna la tarea si existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask);
			const { getTaskById } = await import("./task-repository.js");

			const result = await getTaskById("task-1");

			expect(prisma.task.findUnique).toHaveBeenCalledWith({
				where: { id: "task-1" },
			});
			expect(result).toEqual(mockTask);
		});

		it("retorna null si no existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.findUnique).mockResolvedValue(null);
			const { getTaskById } = await import("./task-repository.js");

			const result = await getTaskById("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("updateTask", () => {
		it("actualiza solo los campos proporcionados (patch semántico)", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.update).mockResolvedValue({
				...mockTask,
				title: "Updated",
			});
			const { updateTask } = await import("./task-repository.js");

			await updateTask("task-1", { title: "Updated" });

			expect(prisma.task.update).toHaveBeenCalledWith({
				where: { id: "task-1" },
				data: { title: "Updated" },
			});
		});

		it("puede limpiar campos opcionales con null", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.update).mockResolvedValue(mockTask);
			const { updateTask } = await import("./task-repository.js");

			await updateTask("task-1", { description: null });

			expect(prisma.task.update).toHaveBeenCalledWith({
				where: { id: "task-1" },
				data: { description: null },
			});
		});
	});

	describe("transitionTaskStatus", () => {
		it("actualiza el status de la tarea", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.update).mockResolvedValue({
				...mockTask,
				status: "completed",
			});
			const { transitionTaskStatus } = await import("./task-repository.js");

			await transitionTaskStatus("task-1", "completed");

			expect(prisma.task.update).toHaveBeenCalledWith({
				where: { id: "task-1" },
				data: { status: "completed" },
			});
		});

		it("incluye cancelledAt cuando se provee", async () => {
			const { prisma } = await import("../index.js");
			const date = new Date();
			vi.mocked(prisma.task.update).mockResolvedValue({
				...mockTask,
				status: "cancelled",
				cancelledAt: date,
			});
			const { transitionTaskStatus } = await import("./task-repository.js");

			await transitionTaskStatus("task-1", "cancelled", date);

			expect(prisma.task.update).toHaveBeenCalledWith({
				where: { id: "task-1" },
				data: { status: "cancelled", cancelledAt: date },
			});
		});

		it("no incluye cancelledAt cuando no se provee", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.update).mockResolvedValue({
				...mockTask,
				status: "in_progress",
			});
			const { transitionTaskStatus } = await import("./task-repository.js");

			await transitionTaskStatus("task-1", "in_progress");

			expect(prisma.task.update).toHaveBeenCalledWith({
				where: { id: "task-1" },
				data: { status: "in_progress" },
			});
		});
	});

	describe("getActiveTasks", () => {
		it("retorna tareas en estados activos", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.findMany).mockResolvedValue([mockTask]);
			const { getActiveTasks } = await import("./task-repository.js");

			const result = await getActiveTasks();

			expect(prisma.task.findMany).toHaveBeenCalledWith({
				where: {
					status: { in: ["pending", "in_progress", "postponed"] },
				},
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});

		it("retorna array vacío si no hay tareas activas", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.findMany).mockResolvedValue([]);
			const { getActiveTasks } = await import("./task-repository.js");

			const result = await getActiveTasks();

			expect(result).toEqual([]);
		});
	});

	describe("getTasksByObjective", () => {
		it("retorna tareas de un objetivo específico", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.task.findMany).mockResolvedValue([mockTask]);
			const { getTasksByObjective } = await import("./task-repository.js");

			const result = await getTasksByObjective("obj-1");

			expect(prisma.task.findMany).toHaveBeenCalledWith({
				where: { objectiveId: "obj-1" },
			});
			expect(result).toHaveLength(1);
		});
	});
});
