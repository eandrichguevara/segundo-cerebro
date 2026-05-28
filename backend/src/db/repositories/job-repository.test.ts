import { beforeEach, describe, expect, it, vi } from "vitest";
import { calculateRetryDelay } from "./job-repository.js";

vi.mock("../index.js", () => ({
	prisma: {
		job: {
			create: vi.fn(),
			findUnique: vi.fn(),
			update: vi.fn(),
			count: vi.fn(),
		},
		$queryRawUnsafe: vi.fn(),
		$executeRaw: vi.fn(),
	},
}));

describe("calculateRetryDelay", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("calcula el delay base correcto para attempt 1 (sin jitter)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = calculateRetryDelay(1);
		expect(delay).toBe(2000);
	});

	it("duplica el delay para attempt 2 (sin jitter)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = calculateRetryDelay(2);
		expect(delay).toBe(4000);
	});

	it("duplica el delay para attempt 3 (sin jitter)", () => {
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const delay = calculateRetryDelay(3);
		expect(delay).toBe(8000);
	});

	it("aplica jitter negativo cuando random es bajo", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const delay = calculateRetryDelay(1);
		expect(delay).toBeLessThan(2000);
	});

	it("aplica jitter positivo cuando random es alto", () => {
		vi.spyOn(Math, "random").mockReturnValue(1);
		const delay = calculateRetryDelay(1);
		expect(delay).toBeGreaterThan(2000);
	});

	it("nunca retorna valores negativos", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		for (let i = 1; i <= 10; i++) {
			expect(calculateRetryDelay(i)).toBeGreaterThanOrEqual(0);
		}
	});

	it("el jitter está dentro del rango de ±20%", () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const minDelay1 = calculateRetryDelay(1);
		expect(minDelay1).toBeGreaterThanOrEqual(1600);
		expect(minDelay1).toBeLessThanOrEqual(2000);

		vi.spyOn(Math, "random").mockReturnValue(1);
		const maxDelay1 = calculateRetryDelay(1);
		expect(maxDelay1).toBeGreaterThanOrEqual(2000);
		expect(maxDelay1).toBeLessThanOrEqual(2400);
	});
});

describe("claimJob", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("usa aliases camelCase en RETURNING para mapeo correcto", async () => {
		const { prisma } = await import("../index.js");
		const mockJob = {
			id: "job-1",
			correlationId: "corr-1",
			sessionId: "sess-1",
			type: "process_message",
			source: "websocket",
			payload: { transcribed_text: "test" },
			status: "processing",
			attempts: 0,
			maxAttempts: 3,
			runAt: new Date(),
			lockedAt: new Date(),
			lockedBy: "worker-1",
			result: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([mockJob]);
		const { claimJob } = await import("./job-repository.js");

		await claimJob("worker-1", 600_000);

		const query = vi.mocked(prisma.$queryRawUnsafe).mock.calls[0][0] as string;
		expect(query).toContain('AS "correlationId"');
		expect(query).toContain('AS "sessionId"');
		expect(query).toContain('AS "maxAttempts"');
		expect(query).toContain('AS "runAt"');
		expect(query).toContain('AS "lockedAt"');
		expect(query).toContain('AS "lockedBy"');
		expect(query).toContain('AS "createdAt"');
		expect(query).toContain('AS "updatedAt"');
	});
});
