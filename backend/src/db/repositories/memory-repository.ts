import type { Prisma } from "@prisma/client";
import { prisma } from "../index.js";

type MemoryRecord = {
	id: string;
	content: string;
	embedding: number[] | null;
	metadata: unknown;
	createdAt: Date;
	updatedAt: Date;
};

export async function createMemory(data: {
	content: string;
	embedding?: number[];
	metadata?: Record<string, unknown>;
}) {
	const memory = await prisma.$queryRawUnsafe<MemoryRecord[]>(
		`INSERT INTO memories (id, content, embedding, metadata, created_at, updated_at)
		 VALUES (gen_random_uuid(), $1, $2::vector, $3, NOW(), NOW())
		 RETURNING id, content, metadata, created_at AS "createdAt", updated_at AS "updatedAt"`,
		data.content,
		data.embedding ? JSON.stringify(data.embedding) : null,
		(data.metadata ?? {}) as Prisma.InputJsonValue,
	);
	return (memory as unknown as MemoryRecord[])[0] ?? null;
}

export async function searchMemoriesByText(query: string, limit = 5) {
	const memories = await prisma.memory.findMany({
		where: {
			content: { contains: query, mode: "insensitive" },
		},
		take: limit,
		orderBy: { createdAt: "desc" },
	});
	return memories as unknown as MemoryRecord[];
}

export async function getRecentMemories(limit = 5) {
	const memories = await prisma.memory.findMany({
		take: limit,
		orderBy: { createdAt: "desc" },
	});
	return memories as unknown as MemoryRecord[];
}

export async function getRelevantMemories(
	embedding: number[],
	limit = 5,
): Promise<MemoryRecord[]> {
	const embeddingJson = JSON.stringify(embedding);
	const memories = await prisma.$queryRawUnsafe<MemoryRecord[]>(
		`SELECT id, content, metadata, created_at AS "createdAt", updated_at AS "updatedAt"
		 FROM memories
		 WHERE embedding IS NOT NULL
		 ORDER BY embedding <=> $1::vector
		 LIMIT $2`,
		embeddingJson,
		limit,
	);
	return memories as unknown as MemoryRecord[];
}
