import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		objective: {
			create: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
			findMany: vi.fn(),
		},
		task: {
			findMany: vi.fn(),
		},
	},
}));

const mockObjective = {
	id: "obj-1",
	title: "Test objective",
	description: null,
	deadline: null,
	status: "active",
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	cancelledAt: null,
};

describe("objective-repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createObjective", () => {
		it("crea un objetivo solo con título", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.create).mockResolvedValue(mockObjective);
			const { createObjective } = await import("./objective-repository.js");

			const result = await createObjective({ title: "Test objective" });

			expect(prisma.objective.create).toHaveBeenCalledWith({
				data: {
					title: "Test objective",
					description: null,
					deadline: null,
				},
			});
			expect(result).toEqual(mockObjective);
		});

		it("crea un objetivo con deadline", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.create).mockResolvedValue(mockObjective);
			const { createObjective } = await import("./objective-repository.js");

			await createObjective({
				title: "Objective",
				description: "Desc",
				deadline: "2026-12-31T23:59:59Z",
			});

			expect(prisma.objective.create).toHaveBeenCalledWith({
				data: {
					title: "Objective",
					description: "Desc",
					deadline: new Date("2026-12-31T23:59:59Z"),
				},
			});
		});
	});

	describe("getObjectiveById", () => {
		it("retorna el objetivo si existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.findUnique).mockResolvedValue(mockObjective);
			const { getObjectiveById } = await import("./objective-repository.js");

			const result = await getObjectiveById("obj-1");

			expect(prisma.objective.findUnique).toHaveBeenCalledWith({
				where: { id: "obj-1" },
			});
			expect(result).toEqual(mockObjective);
		});

		it("retorna null si no existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.findUnique).mockResolvedValue(null);
			const { getObjectiveById } = await import("./objective-repository.js");

			const result = await getObjectiveById("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("updateObjective", () => {
		it("actualiza solo los campos proporcionados", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.update).mockResolvedValue({
				...mockObjective,
				title: "Updated",
			});
			const { updateObjective } = await import("./objective-repository.js");

			await updateObjective("obj-1", { title: "Updated" });

			expect(prisma.objective.update).toHaveBeenCalledWith({
				where: { id: "obj-1" },
				data: { title: "Updated" },
			});
		});

		it("puede limpiar deadline con null", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.update).mockResolvedValue(mockObjective);
			const { updateObjective } = await import("./objective-repository.js");

			await updateObjective("obj-1", { deadline: null });

			expect(prisma.objective.update).toHaveBeenCalledWith({
				where: { id: "obj-1" },
				data: { deadline: null },
			});
		});
	});

	describe("transitionObjectiveStatus", () => {
		it("actualiza el status del objetivo", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.update).mockResolvedValue({
				...mockObjective,
				status: "completed",
			});
			const { transitionObjectiveStatus } = await import(
				"./objective-repository.js"
			);

			await transitionObjectiveStatus("obj-1", "completed");

			expect(prisma.objective.update).toHaveBeenCalledWith({
				where: { id: "obj-1" },
				data: { status: "completed" },
			});
		});

		it("incluye cancelledAt cuando se provee", async () => {
			const { prisma } = await import("../index.js");
			const date = new Date();
			vi.mocked(prisma.objective.update).mockResolvedValue({
				...mockObjective,
				status: "cancelled",
				cancelledAt: date,
			});
			const { transitionObjectiveStatus } = await import(
				"./objective-repository.js"
			);

			await transitionObjectiveStatus("obj-1", "cancelled", date);

			expect(prisma.objective.update).toHaveBeenCalledWith({
				where: { id: "obj-1" },
				data: { status: "cancelled", cancelledAt: date },
			});
		});

		it("no incluye cancelledAt cuando no se provee", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.update).mockResolvedValue({
				...mockObjective,
				status: "paused",
			});
			const { transitionObjectiveStatus } = await import(
				"./objective-repository.js"
			);

			await transitionObjectiveStatus("obj-1", "paused");

			expect(prisma.objective.update).toHaveBeenCalledWith({
				where: { id: "obj-1" },
				data: { status: "paused" },
			});
		});
	});

	describe("getActiveObjectives", () => {
		it("retorna objetivos activos y en pausa", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.objective.findMany).mockResolvedValue([mockObjective]);
			const { getActiveObjectives } = await import("./objective-repository.js");

			const result = await getActiveObjectives();

			expect(prisma.objective.findMany).toHaveBeenCalledWith({
				where: { status: { in: ["active", "paused"] } },
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});
	});

	describe("getTasksByObjective", () => {
		it("retorna las tareas asociadas al objetivo", async () => {
			const { prisma } = await import("../index.js");
			const mockTask = { id: "task-1", title: "Test task" };
			vi.mocked(prisma.task.findMany).mockResolvedValue([mockTask]);
			const { getTasksByObjective } = await import("./objective-repository.js");

			const result = await getTasksByObjective("obj-1");

			expect(prisma.task.findMany).toHaveBeenCalledWith({
				where: { objectiveId: "obj-1" },
			});
			expect(result).toHaveLength(1);
		});
	});
});
