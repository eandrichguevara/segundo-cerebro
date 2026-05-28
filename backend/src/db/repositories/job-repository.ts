import type { Prisma } from "@prisma/client";
import { prisma } from "../index.js";

type JobRecord = {
	id: string;
	correlationId: string;
	sessionId: string;
	type: string;
	source: string;
	payload: unknown;
	status: string;
	attempts: number;
	maxAttempts: number;
	runAt: Date;
	lockedAt: Date | null;
	lockedBy: string | null;
	result: unknown;
	createdAt: Date;
	updatedAt: Date;
};

export async function enqueueJob(data: {
	correlationId: string;
	sessionId: string;
	type: string;
	payload: Record<string, unknown>;
}) {
	const job = await prisma.job.create({
		data: {
			correlationId: data.correlationId,
			sessionId: data.sessionId,
			type: data.type,
			payload: data.payload as Prisma.InputJsonValue,
		},
	});
	return job as unknown as JobRecord;
}

export async function claimJob(workerId: string, orphanTimeoutMs = 600_000) {
	const timeoutDate = new Date(Date.now() - orphanTimeoutMs);
	const job = await prisma.$queryRawUnsafe<JobRecord[]>(
		`UPDATE jobs
     SET status = 'processing', locked_at = NOW(), locked_by = $1, updated_at = NOW()
     WHERE id = (
       SELECT id FROM jobs
       WHERE (status = 'pending' AND run_at <= NOW())
            OR (status = 'processing' AND locked_at < $2)
       ORDER BY run_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, correlation_id AS "correlationId", session_id AS "sessionId",
       type, source, payload, status, attempts, max_attempts AS "maxAttempts",
       run_at AS "runAt", locked_at AS "lockedAt", locked_by AS "lockedBy",
       result, created_at AS "createdAt", updated_at AS "updatedAt"`,
		workerId,
		timeoutDate,
	);
	return (job as unknown as JobRecord[])[0] ?? null;
}

export async function completeJob(
	jobId: string,
	result: Record<string, unknown>,
) {
	const job = await prisma.job.update({
		where: { id: jobId },
		data: {
			status: "completed",
			result: result as Prisma.InputJsonValue,
			lockedAt: null,
			lockedBy: null,
		},
	});
	return job as unknown as JobRecord;
}

export function calculateRetryDelay(attempt: number): number {
	const baseDelay = 2000;
	const multiplier = 2;
	const jitter = 0.2;
	const exponentialDelay = baseDelay * multiplier ** (attempt - 1);
	const jitterRange = exponentialDelay * jitter;
	const jitterValue = (Math.random() * 2 - 1) * jitterRange;
	return Math.max(0, exponentialDelay + jitterValue);
}

export async function retryJob(jobId: string, error: Record<string, unknown>) {
	const job = await prisma.job.findUnique({
		where: { id: jobId },
		select: { attempts: true, maxAttempts: true },
	});

	if (!job) {
		return { retried: false, reason: "JOB_NOT_FOUND" as const };
	}

	const nextAttempt = job.attempts + 1;

	if (nextAttempt > job.maxAttempts) {
		await prisma.job.update({
			where: { id: jobId },
			data: {
				status: "failed",
				result: error as Prisma.InputJsonValue,
				lockedAt: null,
				lockedBy: null,
			},
		});
		return { retried: false, reason: "MAX_ATTEMPTS_EXCEEDED" as const };
	}

	const delayMs = calculateRetryDelay(nextAttempt);
	const runAt = new Date(Date.now() + delayMs);

	await prisma.job.update({
		where: { id: jobId },
		data: {
			status: "pending",
			attempts: nextAttempt,
			runAt,
			lockedAt: null,
			lockedBy: null,
			result: error as Prisma.InputJsonValue,
		},
	});

	return { retried: true, nextAttempt, delayMs, runAt };
}

export async function failJob(jobId: string, error: Record<string, unknown>) {
	const job = await prisma.job.update({
		where: { id: jobId },
		data: {
			status: "failed",
			result: error as Prisma.InputJsonValue,
			lockedAt: null,
			lockedBy: null,
		},
	});
	return job as unknown as JobRecord;
}

export async function releaseOrphanedJobs(timeoutMs: number) {
	const timeoutDate = new Date(Date.now() - timeoutMs);
	const result = await prisma.$executeRaw`
    UPDATE jobs
    SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = NOW()
    WHERE status = 'processing'
      AND locked_at < ${timeoutDate}::timestamptz
  `;
	return result;
}

export async function getJobStats() {
	const [pending, processing, completed, failed] = await Promise.all([
		prisma.job.count({ where: { status: "pending" } }),
		prisma.job.count({ where: { status: "processing" } }),
		prisma.job.count({ where: { status: "completed" } }),
		prisma.job.count({ where: { status: "failed" } }),
	]);
	return { pending, processing, completed, failed };
}
