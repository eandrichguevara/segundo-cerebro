import type { FastifyInstance } from "fastify";
import { prisma } from "../db/index.js";

async function attachLinks<T extends { id: string }>(items: T[], type: string) {
	if (items.length === 0) return items;
	const ids = items.map(i => i.id);

	const links = await prisma.entityLink.findMany({
		where: {
			OR: [
				{ sourceId: { in: ids }, sourceType: type as any },
				{ targetId: { in: ids }, targetType: type as any }
			]
		}
	});

	if (links.length === 0) {
		return items.map(item => ({ ...item, links: [] }));
	}

	const typeToIds = new Map<string, Set<string>>();
	for (const l of links) {
		if (ids.includes(l.sourceId) && l.sourceType === type) {
			if (!typeToIds.has(l.targetType)) typeToIds.set(l.targetType, new Set());
			typeToIds.get(l.targetType)!.add(l.targetId);
		}
		if (ids.includes(l.targetId) && l.targetType === type) {
			if (!typeToIds.has(l.sourceType)) typeToIds.set(l.sourceType, new Set());
			typeToIds.get(l.sourceType)!.add(l.sourceId);
		}
	}

	const titlesMap = new Map<string, string>();
	const fetchTitles = async (entity: string, model: any) => {
		if (typeToIds.has(entity)) {
			const rows = await model.findMany({
				where: { id: { in: Array.from(typeToIds.get(entity)!) } },
				select: { id: true, title: true }
			});
			rows.forEach((r: any) => titlesMap.set(r.id, r.title));
		}
	};

	await Promise.all([
		fetchTitles("task", prisma.task),
		fetchTitles("objective", prisma.objective),
		fetchTitles("project", prisma.project),
		fetchTitles("idea", prisma.idea),
		fetchTitles("list", prisma.list),
		fetchTitles("event", prisma.event),
	]);

	return items.map(item => {
		const itemLinks = links
			.filter(l => (l.sourceId === item.id && l.sourceType === type) || (l.targetId === item.id && l.targetType === type))
			.map(l => {
				const isSource = l.sourceId === item.id && l.sourceType === type;
				const linkedType = isSource ? l.targetType : l.sourceType;
				const linkedId = isSource ? l.targetId : l.sourceId;
				return {
					id: l.id,
					linkedType,
					linkedId,
					linkedTitle: titlesMap.get(linkedId) ?? "Desconocido",
					relation: l.relation
				};
			});
		return { ...item, links: itemLinks };
	});
}

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

		const mappedData = data.map((t) => ({
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
		}));

		return {
			data: await attachLinks(mappedData, "task"),
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

		const mappedData = data.map((o) => {
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
		});

		return {
			data: await attachLinks(mappedData, "objective"),
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

		const mappedData = data.map((e) => ({
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
		}));

		return {
			data: await attachLinks(mappedData, "event"),
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

		const mappedData = data.map((l) => ({
			id: l.id,
			title: l.title,
			description: l.description,
			type: l.type,
			status: l.status,
			items: l.items,
			createdAt: l.createdAt.toISOString(),
		}));

		return {
			data: await attachLinks(mappedData, "list"),
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

	app.get("/api/db/projects", async (req) => {
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
			prisma.project.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.project.count({ where }),
		]);

		const mappedData = data.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			status: p.status,
			category: p.category,
			deadline: p.deadline?.toISOString() ?? null,
			createdAt: p.createdAt.toISOString(),
			updatedAt: p.updatedAt.toISOString(),
			cancelledAt: p.cancelledAt?.toISOString() ?? null,
		}));

		return {
			data: await attachLinks(mappedData, "project"),
			total,
		};
	});

	app.get("/api/db/ideas", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const status = query.status;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const where: Record<string, unknown> = {};
		if (status) {
			where.status = status;
		} else {
			where.status = { not: "discarded" };
		}

		const [data, total] = await Promise.all([
			prisma.idea.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.idea.count({ where }),
		]);

		const mappedData = data.map((i) => ({
			id: i.id,
			title: i.title,
			description: i.description,
			status: i.status,
			tags: i.tags,
			createdAt: i.createdAt.toISOString(),
			updatedAt: i.updatedAt.toISOString(),
		}));

		return {
			data: await attachLinks(mappedData, "idea"),
			total,
		};
	});

	app.get("/api/db/devices", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const [data, total] = await Promise.all([
			prisma.device.findMany({
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.device.count(),
		]);

		return {
			data: data.map((d) => ({
				id: d.id,
				platform: d.platform,
				fcmToken: d.fcmToken,
				createdAt: d.createdAt.toISOString(),
				updatedAt: d.updatedAt.toISOString(),
			})),
			total,
		};
	});

	app.get("/api/db/entity-links", async (req) => {
		const query = req.query as Record<string, string | undefined>;
		const limit = Math.min(Number(query.limit) || 100, 500);
		const offset = Number(query.offset) || 0;

		const [data, total] = await Promise.all([
			prisma.entityLink.findMany({
				orderBy: { createdAt: "desc" },
				take: limit,
				skip: offset,
			}),
			prisma.entityLink.count(),
		]);

		return {
			data: data.map((e) => ({
				id: e.id,
				sourceType: e.sourceType,
				sourceId: e.sourceId,
				targetType: e.targetType,
				targetId: e.targetId,
				relation: e.relation,
				note: e.note,
				createdAt: e.createdAt.toISOString(),
			})),
			total,
		};
	});
}

