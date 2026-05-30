import type { FastifyInstance } from "fastify";
import { prisma } from "../db/index.js";

export async function dbViewerRoutes(app: FastifyInstance): Promise<void> {
	app.get("/api/db/tasks", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const status = query.status;
		const priority = query.priority;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const where: Record<string, unknown> = {};
		if (status) {
			where.status = status;
		} else {
			where.status = { not: "cancelled" };
		}
		if (priority) where.priority = priority;

		const [data, total] = await Promise.all([
			prisma.task.findMany({
				where,
				include: { objective: { select: { title: true } } },
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.task.count({ where }),
		]);

		return {
			data: data.map((t) => ({
				id: t.id,
				title: t.title,
				description: t.description,
				status: t.status,
				dueDate: t.dueDate?.toISOString() ?? null,
				priority: t.priority,
				objectiveId: t.objectiveId,
				objectiveTitle: (t as unknown as Record<string, unknown>).objective
					? ((t as unknown as Record<string, unknown>).objective as Record<string, string>).title
					: null,
				createdAt: t.createdAt.toISOString(),
				updatedAt: t.updatedAt.toISOString(),
				cancelledAt: t.cancelledAt?.toISOString() ?? null,
			})),
			total,
		};
	});

	app.get("/api/db/objectives", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const status = query.status;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const where: Record<string, unknown> = {};
		if (status) {
			where.status = status;
		} else {
			where.status = { not: "cancelled" };
		}

		const [data, total] = await Promise.all([
			prisma.objective.findMany({
				where,
				include: { tasks: { select: { status: true } } },
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.objective.count({ where }),
		]);

		return {
			data: data.map((o) => {
				const tasks = (o as unknown as Record<string, unknown>).tasks as Array<Record<string, string>>;
				const totalTasks = tasks?.length ?? 0;
				const completedTasks = tasks?.filter((t) => t.status === "completed").length ?? 0;
				return {
					id: o.id,
					title: o.title,
					description: o.description,
					deadline: o.deadline?.toISOString() ?? null,
					status: o.status,
					taskCount: totalTasks,
					completedTasks,
					createdAt: o.createdAt.toISOString(),
				};
			}),
			total,
		};
	});

	app.get("/api/db/events", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const days = Number(query.days) || 30;
		const status = query.status;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const now = new Date();
		const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

		const where: Record<string, unknown> = {
			startTime: { gte: now, lte: end },
		};
		if (status) {
			where.status = status;
		} else {
			where.status = { not: "cancelled" };
		}

		const [data, total] = await Promise.all([
			prisma.event.findMany({
				where,
				orderBy: { startTime: "asc" },
				take: limit,
				skip: offset,
			}),
			prisma.event.count({ where }),
		]);

		return {
			data: data.map((e) => ({
				id: e.id,
				title: e.title,
				description: e.description,
				location: e.location,
				category: e.category,
				startTime: e.startTime.toISOString(),
				endTime: e.endTime?.toISOString() ?? null,
				status: e.status,
				recurrenceRule: e.recurrenceRule,
				isException: e.isException,
				createdAt: e.createdAt.toISOString(),
			})),
			total,
		};
	});

	app.get("/api/db/lists", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const status = query.status;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const where: Record<string, unknown> = {};
		if (status) {
			where.status = status;
		} else {
			where.status = { not: "cancelled" };
		}

		const [data, total] = await Promise.all([
			prisma.list.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.list.count({ where }),
		]);

		return {
			data: data.map((l) => ({
				id: l.id,
				title: l.title,
				description: l.description,
				type: l.type,
				status: l.status,
				items: l.items,
				createdAt: l.createdAt.toISOString(),
			})),
			total,
		};
	});

	app.get("/api/db/memories", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const limit = Math.min(Number(query.limit) || 50, 200);
		const offset = Number(query.offset) || 0;

		const [data, total] = await Promise.all([
			prisma.memory.findMany({
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.memory.count(),
		]);

		return {
			data: data.map((m) => ({
				id: m.id,
				content: m.content,
				metadata: m.metadata,
				createdAt: m.createdAt.toISOString(),
			})),
			total,
		};
	});

	app.get("/api/db/conversations", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const [data, total] = await Promise.all([
			prisma.conversationTurn.findMany({
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.conversationTurn.count(),
		]);

		return {
			data: data.map((c) => ({
				id: c.id,
				sessionId: c.sessionId,
				role: c.role,
				content: c.content,
				createdAt: c.createdAt.toISOString(),
			})),
			total,
		};
	});

	app.get("/api/db/jobs", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const status = query.status;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const where: Record<string, unknown> = {};
		if (status) where.status = status;

		const [data, total] = await Promise.all([
			prisma.job.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.job.count({ where }),
		]);

		return {
			data: data.map((j) => ({
				id: j.id,
				type: j.type,
				source: j.source,
				status: j.status,
				attempts: j.attempts,
				maxAttempts: j.maxAttempts,
				createdAt: j.createdAt.toISOString(),
				updatedAt: j.updatedAt.toISOString(),
			})),
			total,
		};
	});
}
