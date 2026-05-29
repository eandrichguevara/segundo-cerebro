import type { FastifyInstance } from "fastify";
import { formatForPrompt, get } from "../domain/quick-memory.js";

export async function debugRoutes(app: FastifyInstance): Promise<void> {
	app.get("/debug/quick-memory", async () => {
		const data = get();
		if (!data) {
			return {
				status: "empty",
				message: "Quick memory no ha sido inicializada aún",
			};
		}

		return {
			status: "active",
			updated_at: data.updatedAt.toISOString(),
			whoAmI: data.whoAmI,
			topData: data.topData,
			todayContext: data.todayContext,
			recentTopics: data.recentTopics,
			formattedPrompt: formatForPrompt(),
		};
	});
}
