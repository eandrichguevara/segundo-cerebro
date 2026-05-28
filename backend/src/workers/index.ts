import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getJobStats } from "../db/repositories/job-repository.js";
import { workerLoop } from "./slow-lane-processor.js";

let workerStop: (() => void) | null = null;
let metricsTimer: ReturnType<typeof setInterval> | null = null;

const METRICS_INTERVAL = 60_000;

function startMetrics(): void {
	metricsTimer = setInterval(async () => {
		try {
			const jobStats = await getJobStats();
			logger.info({ jobs: jobStats }, "Métricas de jobs");
		} catch (error) {
			logger.error({ error }, "Error recolectando métricas");
		}
	}, METRICS_INTERVAL);
}

function stopMetrics(): void {
	if (metricsTimer) {
		clearInterval(metricsTimer);
		metricsTimer = null;
	}
}

export async function startWorkers(): Promise<void> {
	const stop = workerLoop();
	workerStop = stop;
	startMetrics();
	logger.info("Workers iniciados");
}

export function stopWorkers(): void {
	logger.info("Deteniendo workers");
	stopMetrics();
	workerStop?.();
	workerStop = null;
}
