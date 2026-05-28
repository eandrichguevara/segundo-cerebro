import { type Result, err, ok } from "../types/result.js";
import { openai } from "./client.js";

export enum EmbeddingError {
	GENERATION_FAILED = "EMBEDDING_GENERATION_FAILED",
}

export async function generateEmbedding(
	text: string,
): Promise<Result<number[], EmbeddingError>> {
	try {
		const response = await openai.embeddings.create({
			model: "text-embedding-3-small",
			input: text,
		});

		return ok(response.data[0]?.embedding ?? []);
	} catch {
		return err(EmbeddingError.GENERATION_FAILED);
	}
}
