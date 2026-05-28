import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { healthRoutes } from "./api/health.js";
import { wsRoutes } from "./api/ws.js";
import { verifyAuth } from "./auth/index.js";
import { env } from "./config/env.js";
import { logger, loggerConfig } from "./config/logger.js";
import { startWorkers, stopWorkers } from "./workers/index.js";

const app = Fastify({
	logger: loggerConfig,
	bodyLimit: env.WS_MAX_PAYLOAD,
});

app.decorate("verifyAuth", verifyAuth);

await app.register(fastifyWebsocket);
await app.register(healthRoutes);
await app.register(wsRoutes);

await startWorkers();

try {
	await app.listen({ port: env.PORT, host: env.HOST });
	logger.info({ port: env.PORT, host: env.HOST }, "Servidor iniciado");
} catch (err) {
	stopWorkers();
	logger.fatal(err, "Error al iniciar servidor");
	process.exit(1);
}

export default app;
