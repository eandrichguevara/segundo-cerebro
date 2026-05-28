import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index.js", () => ({
	prisma: {
		conversationTurn: {
			create: vi.fn(),
			findMany: vi.fn(),
		},
	},
}));

const mockTurn = {
	id: "turn-1",
	sessionId: "sess-1",
	role: "user",
	content: "Hello",
	createdAt: new Date("2026-01-01"),
};

const mockAssistantTurn = {
	id: "turn-2",
	sessionId: "sess-1",
	role: "assistant",
	content: "Hi there!",
	createdAt: new Date("2026-01-02"),
};

describe("conversation-repository", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("addTurn", () => {
		it("crea un conversation turn con user role", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.conversationTurn.create).mockResolvedValue(mockTurn);
			const { addTurn } = await import("./conversation-repository.js");

			const result = await addTurn({
				sessionId: "sess-1",
				role: "user",
				content: "Hello",
			});

			expect(prisma.conversationTurn.create).toHaveBeenCalledWith({
				data: {
					sessionId: "sess-1",
					role: "user",
					content: "Hello",
				},
			});
			expect(result).toEqual(mockTurn);
		});

		it("crea un conversation turn con assistant role", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.conversationTurn.create).mockResolvedValue(
				mockAssistantTurn,
			);
			const { addTurn } = await import("./conversation-repository.js");

			const result = await addTurn({
				sessionId: "sess-1",
				role: "assistant",
				content: "Hi there!",
			});

			expect(prisma.conversationTurn.create).toHaveBeenCalledWith({
				data: {
					sessionId: "sess-1",
					role: "assistant",
					content: "Hi there!",
				},
			});
			expect(result).toEqual(mockAssistantTurn);
		});
	});

	describe("getRecentTurns", () => {
		it("retorna los últimos N turns ordenados cronológicamente", async () => {
			const { prisma } = await import("../index.js");
			const turnsFromDb = [
				{ ...mockTurn, createdAt: new Date("2026-01-02") },
				{ ...mockTurn, createdAt: new Date("2026-01-01") },
			];
			vi.mocked(prisma.conversationTurn.findMany).mockResolvedValue(
				turnsFromDb,
			);
			const { getRecentTurns } = await import("./conversation-repository.js");

			const result = await getRecentTurns("sess-1", 5);

			expect(prisma.conversationTurn.findMany).toHaveBeenCalledWith({
				where: { sessionId: "sess-1" },
				orderBy: { createdAt: "desc" },
				take: 5,
			});
			expect(result).toHaveLength(2);
			expect(result[0]?.createdAt < result[1]?.createdAt).toBe(true);
		});

		it("usa limit default de 10", async () => {
			const { prisma } = await import("../index.js");
			vi.mocked(prisma.conversationTurn.findMany).mockResolvedValue([]);
			const { getRecentTurns } = await import("./conversation-repository.js");

			await getRecentTurns("sess-1");

			expect(prisma.conversationTurn.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ take: 10 }),
			);
		});
	});
});
