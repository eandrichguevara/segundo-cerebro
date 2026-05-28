import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./client.js", () => ({
	openai: {
		embeddings: {
			create: vi.fn(),
		},
	},
}));

describe("generateEmbedding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("retorna el embedding exitosamente", async () => {
		const { openai } = await import("./client.js");
		const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
		vi.mocked(openai.embeddings.create).mockResolvedValue({
			data: [{ embedding }],
		});
		const { generateEmbedding } = await import("./embeddings.js");

		const result = await generateEmbedding("Texto de prueba");

		expect(result).toEqual({ ok: true, value: embedding });
	});

	it("retorna array vacío si no hay data", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.embeddings.create).mockResolvedValue({
			data: [],
		});
		const { generateEmbedding } = await import("./embeddings.js");

		const result = await generateEmbedding("Texto sin embedding");

		expect(result).toEqual({ ok: true, value: [] });
	});

	it("retorna GENERATION_FAILED en error de API", async () => {
		const { openai } = await import("./client.js");
		vi.mocked(openai.embeddings.create).mockRejectedValue(
			new Error("API error"),
		);
		const { generateEmbedding } = await import("./embeddings.js");

		const result = await generateEmbedding("Texto fallido");

		expect(result).toEqual({ ok: false, error: "EMBEDDING_GENERATION_FAILED" });
	});
});
