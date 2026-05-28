import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		list: {
			create: vi.fn(),
			findUnique: vi.fn(),
			findFirst: vi.fn(),
			update: vi.fn(),
			findMany: vi.fn(),
		},
	},
}));

const mockList = {
	id: "list-1",
	title: "Supermarket",
	description: null,
	type: "shopping",
	status: "active",
	items: [{ content: "Tomatoes", quantity: "2 kg", checked: false }],
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
	cancelledAt: null,
};

describe("list-repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createList", () => {
		it("crea una lista con valores por defecto", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.create).mockResolvedValue(mockList);
			const { createList } = await import("./list-repository.js");

			const result = await createList({ title: "Supermarket" });

			expect(prisma.list.create).toHaveBeenCalledWith({
				data: {
					title: "Supermarket",
					type: "general",
					description: null,
					items: [],
				},
			});
			expect(result).toEqual(mockList);
		});

		it("crea una lista con items y tipo", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.create).mockResolvedValue(mockList);
			const { createList } = await import("./list-repository.js");

			await createList({
				title: "Supermarket",
				type: "shopping",
				description: "Weekly groceries",
				items: [{ content: "Tomatoes", quantity: "2 kg", checked: false }],
			});

			expect(prisma.list.create).toHaveBeenCalledWith({
				data: {
					title: "Supermarket",
					type: "shopping",
					description: "Weekly groceries",
					items: [{ content: "Tomatoes", quantity: "2 kg", checked: false }],
				},
			});
		});
	});

	describe("getListById", () => {
		it("retorna la lista si existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findUnique).mockResolvedValue(mockList);
			const { getListById } = await import("./list-repository.js");

			const result = await getListById("list-1");

			expect(prisma.list.findUnique).toHaveBeenCalledWith({
				where: { id: "list-1" },
			});
			expect(result).toEqual(mockList);
		});

		it("retorna null si no existe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findUnique).mockResolvedValue(null);
			const { getListById } = await import("./list-repository.js");

			const result = await getListById("nonexistent");

			expect(result).toBeNull();
		});
	});

	describe("updateList", () => {
		it("actualiza los campos de la lista", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.update).mockResolvedValue({
				...mockList,
				title: "Updated",
			});
			const { updateList } = await import("./list-repository.js");

			await updateList("list-1", { title: "Updated" });

			expect(prisma.list.update).toHaveBeenCalledWith({
				where: { id: "list-1" },
				data: { title: "Updated" },
			});
		});

		it("actualiza items de la lista", async () => {
			const { prisma } = await import("../index.js");
			const newItems = [
				{ content: "Bread", quantity: "1 unit", checked: true },
			];
			vi.mocked(prisma.list.update).mockResolvedValue({
				...mockList,
				items: newItems,
			});
			const { updateList } = await import("./list-repository.js");

			await updateList("list-1", { items: newItems });

			expect(prisma.list.update).toHaveBeenCalledWith({
				where: { id: "list-1" },
				data: { items: newItems },
			});
		});
	});

	describe("transitionListStatus", () => {
		it("actualiza el estado de la lista", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.update).mockResolvedValue({
				...mockList,
				status: "completed",
			});
			const { transitionListStatus } = await import("./list-repository.js");

			await transitionListStatus("list-1", "completed");

			expect(prisma.list.update).toHaveBeenCalledWith({
				where: { id: "list-1" },
				data: { status: "completed" },
			});
		});

		it("incluye cancelledAt al cancelar", async () => {
			const { prisma } = await import("../index.js");
			const date = new Date();
			vi.mocked(prisma.list.update).mockResolvedValue({
				...mockList,
				status: "cancelled",
				cancelledAt: date,
			});
			const { transitionListStatus } = await import("./list-repository.js");

			await transitionListStatus("list-1", "cancelled", date);

			expect(prisma.list.update).toHaveBeenCalledWith({
				where: { id: "list-1" },
				data: { status: "cancelled", cancelledAt: date },
			});
		});
	});

	describe("getAllActive", () => {
		it("retorna todas las listas activas", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findMany).mockResolvedValue([mockList]);
			const { getAllActive } = await import("./list-repository.js");

			const result = await getAllActive();

			expect(prisma.list.findMany).toHaveBeenCalledWith({
				where: { status: "active" },
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});
	});

	describe("findActiveByTitle", () => {
		it("busca por título con contains insensitive", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findMany).mockResolvedValue([mockList]);
			const { findActiveByTitle } = await import("./list-repository.js");

			const result = await findActiveByTitle("super");

			expect(prisma.list.findMany).toHaveBeenCalledWith({
				where: {
					status: "active",
					title: { contains: "super", mode: "insensitive" },
				},
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});

		it("retorna vacío si no hay coincidencias", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findMany).mockResolvedValue([]);
			const { findActiveByTitle } = await import("./list-repository.js");

			const result = await findActiveByTitle("nonexistent");

			expect(result).toEqual([]);
		});
	});

	describe("findActiveByExactTitle", () => {
		it("busca por título exacto insensitive", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findFirst).mockResolvedValue(mockList);
			const { findActiveByExactTitle } = await import("./list-repository.js");

			const result = await findActiveByExactTitle("supermarket");

			expect(prisma.list.findFirst).toHaveBeenCalledWith({
				where: {
					status: "active",
					title: { equals: "supermarket", mode: "insensitive" },
				},
			});
			expect(result).toEqual(mockList);
		});

		it("retorna null si no hay coincidencia exacta", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.list.findFirst).mockResolvedValue(null);
			const { findActiveByExactTitle } = await import("./list-repository.js");

			const result = await findActiveByExactTitle("other");

			expect(result).toBeNull();
		});
	});

	describe("getItems", () => {
		it("retorna los items parseados de una lista", async () => {
			const { getItems } = await import("./list-repository.js");

			const result = getItems(mockList);

			expect(result).toEqual([
				{ content: "Tomatoes", quantity: "2 kg", checked: false },
			]);
		});

		it("retorna array vacío si items es null", async () => {
			const { getItems } = await import("./list-repository.js");

			const result = getItems({ ...mockList, items: null });

			expect(result).toEqual([]);
		});

		it("retorna array vacío si items no es un array", async () => {
			const { getItems } = await import("./list-repository.js");

			const result = getItems({ ...mockList, items: "invalid" });

			expect(result).toEqual([]);
		});
	});
});
