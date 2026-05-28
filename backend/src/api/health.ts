import type { FastifyInstance } from "fastify";
import { prisma } from "../db/index.js";
import { getJobStats } from "../db/repositories/job-repository.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
	app.get("/health", async () => {
		let dbOk = false;
		try {
			await prisma.$queryRaw`SELECT 1`;
			dbOk = true;
		} catch {
			dbOk = false;
		}

		let jobStats: Record<string, number> | null = null;
		try {
			jobStats = await getJobStats();
		} catch {
			jobStats = null;
		}

		return {
			status: dbOk ? "ok" : "degraded",
			timestamp: new Date().toISOString(),
			database: dbOk ? "connected" : "disconnected",
			jobs: jobStats,
		};
	});
}
