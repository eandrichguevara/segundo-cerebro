import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/index.js", () => ({
	prisma: {
		$queryRaw: vi.fn(),
	},
}));

vi.mock("../db/repositories/job-repository.js", () => ({
	getJobStats: vi.fn(),
}));

describe("GET /health", () => {
	let app: FastifyInstance;

	beforeEach(async () => {
		vi.resetModules();
		const { healthRoutes } = await import("./health.js");
		app = Fastify();
		await app.register(healthRoutes);
	});

	afterEach(async () => {
		await app.close();
		vi.restoreAllMocks();
	});

	it("retorna status ok cuando DB está conectada", async () => {
		const { prisma } = await import("../db/index.js");
		const { getJobStats } = await import(
			"../db/repositories/job-repository.js"
		);
		vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "1": 1 }]);
		vi.mocked(getJobStats).mockResolvedValue({
			pending: 0,
			processing: 0,
			completed: 0,
			failed: 0,
		});

		const response = await app.inject({ method: "GET", url: "/health" });

		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body);
		expect(body.status).toBe("ok");
		expect(body.database).toBe("connected");
		expect(body.jobs).toEqual({
			pending: 0,
			processing: 0,
			completed: 0,
			failed: 0,
		});
		expect(body.timestamp).toBeDefined();
	});

	it("retorna status degraded cuando DB falla", async () => {
		const { prisma } = await import("../db/index.js");
		vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("DB error"));

		const response = await app.inject({ method: "GET", url: "/health" });

		const body = JSON.parse(response.body);
		expect(body.status).toBe("degraded");
		expect(body.database).toBe("disconnected");
	});

	it("retorna jobs null si getJobStats falla", async () => {
		const { prisma } = await import("../db/index.js");
		const { getJobStats } = await import(
			"../db/repositories/job-repository.js"
		);
		vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "1": 1 }]);
		vi.mocked(getJobStats).mockRejectedValue(new Error("Stats error"));

		const response = await app.inject({ method: "GET", url: "/health" });

		const body = JSON.parse(response.body);
		expect(body.status).toBe("ok");
		expect(body.jobs).toBeNull();
	});

	it("retorna timestamp en formato ISO 8601", async () => {
		const { prisma } = await import("../db/index.js");
		vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "1": 1 }]);

		const response = await app.inject({ method: "GET", url: "/health" });

		const body = JSON.parse(response.body);
		expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
	});
});
