import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		memory: {
			findMany: vi.fn(),
		},
		$queryRawUnsafe: vi.fn(),
	},
}));

const mockMemory = {
	id: "mem-1",
	content: "Test memory",
	embedding: [0.1, 0.2, 0.3],
	metadata: { type: "preference" },
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-01"),
};

describe("memory-repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createMemory", () => {
		it("inserta una memoria usando $queryRawUnsafe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockMemory]);
			const { createMemory } = await import("./memory-repository.js");

			const result = await createMemory({ content: "Test memory" });

			expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO memories"),
				"Test memory",
				null,
				{},
			);
			expect(result).toEqual(mockMemory);
		});

		it("inserta una memoria con embedding y metadata", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockMemory]);
			const { createMemory } = await import("./memory-repository.js");

			await createMemory({
				content: "Memory with embedding",
				embedding: [0.5, 0.6],
				metadata: { type: "decision", entities: ["task"] },
			});

			expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
				expect.stringContaining("INSERT INTO memories"),
				"Memory with embedding",
				JSON.stringify([0.5, 0.6]),
				{ type: "decision", entities: ["task"] },
			);
		});

		it("usa aliases camelCase en RETURNING para evitar problemas de mapeo", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockMemory]);
			const { createMemory } = await import("./memory-repository.js");

			await createMemory({ content: "Test" });

			const query = vi.mocked(prisma.$queryRawUnsafe).mock
				.calls[0][0] as string;
			expect(query).toContain('AS "createdAt"');
			expect(query).toContain('AS "updatedAt"');
		});

		it("retorna null si $queryRawUnsafe retorna array vacío", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([]);
			const { createMemory } = await import("./memory-repository.js");

			const result = await createMemory({ content: "Test" });

			expect(result).toBeNull();
		});
	});

	describe("searchMemoriesByText", () => {
		it("busca memorias por contenido con case-insensitive", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.memory.findMany).mockResolvedValue([mockMemory]);
			const { searchMemoriesByText } = await import("./memory-repository.js");

			const result = await searchMemoriesByText("test", 3);

			expect(prisma.memory.findMany).toHaveBeenCalledWith({
				where: { content: { contains: "test", mode: "insensitive" } },
				take: 3,
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});

		it("usa limit default de 5", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.memory.findMany).mockResolvedValue([]);
			const { searchMemoriesByText } = await import("./memory-repository.js");

			await searchMemoriesByText("query");

			expect(prisma.memory.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 5 }),
			);
		});
	});

	describe("getRecentMemories", () => {
		it("retorna las memorias más recientes", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.memory.findMany).mockResolvedValue([mockMemory]);
			const { getRecentMemories } = await import("./memory-repository.js");

			const result = await getRecentMemories(3);

			expect(prisma.memory.findMany).toHaveBeenCalledWith({
				take: 3,
				orderBy: { createdAt: "desc" },
			});
			expect(result).toHaveLength(1);
		});
	});

	describe("getRelevantMemories", () => {
		it("busca memorias por similitud vectorial con $queryRawUnsafe", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockMemory]);
			const { getRelevantMemories } = await import("./memory-repository.js");

			const result = await getRelevantMemories([0.1, 0.2, 0.3], 5);

			expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
				expect.stringContaining("ORDER BY embedding <=>"),
				JSON.stringify([0.1, 0.2, 0.3]),
				5,
			);
			expect(result).toHaveLength(1);
		});

		it("no selecciona la columna embedding para evitar error P2010", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockMemory]);
			const { getRelevantMemories } = await import("./memory-repository.js");

			await getRelevantMemories([0.1, 0.2, 0.3], 5);

			const query = vi.mocked(prisma.$queryRawUnsafe).mock
				.calls[0][0] as string;
			expect(query).toContain('AS "createdAt"');
			expect(query).toContain('AS "updatedAt"');
			expect(query).not.toContain("SELECT id, content, embedding");
		});
	});
});
