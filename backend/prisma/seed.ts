import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();

function uuid(): string {
	return randomUUID();
}

function d(dateStr: string): Date {
	return new Date(dateStr);
}

async function seed(): Promise<void> {
	console.log("Seeding database...");

	// Clean existing data in FK-safe order
	await prisma.taskEventLink.deleteMany();
	await prisma.conversationTurn.deleteMany();
	await prisma.job.deleteMany();
	await prisma.device.deleteMany();
	await prisma.memory.deleteMany();
	await prisma.event.deleteMany();
	await prisma.task.deleteMany();
	await prisma.list.deleteMany();
	await prisma.objective.deleteMany();

	// ────────────────────────
	// Objectives (5 — todos los status)
	// ────────────────────────
	const objVacaciones = await prisma.objective.create({
		data: {
			id: uuid(),
			title: "Ahorrar $5000 para vacaciones",
			description: "Reducir gastos hormiga y depositar $1000 por mes",
			deadline: d("2026-12-31T23:59:59Z"),
			status: "active",
		},
	});

	const objTypescript = await prisma.objective.create({
		data: {
			id: uuid(),
			title: "Aprender TypeScript avanzado",
			description: "Dominar generics, decorators y utility types",
			status: "active",
		},
	});

	const objCasa = await prisma.objective.create({
		data: {
			id: uuid(),
			title: "Organizar la casa",
			description: "Ordenar y donar cosas que no se usan",
			deadline: d("2026-07-15T23:59:59Z"),
			status: "paused",
		},
	});

	const objLibros = await prisma.objective.create({
		data: {
			id: uuid(),
			title: "Leer 12 libros este año",
			description: "Un libro por mes, arrancando con Clean Code",
			deadline: d("2026-12-31T23:59:59Z"),
			status: "completed",
		},
	});

	const objFreelance = await prisma.objective.create({
		data: {
			id: uuid(),
			title: "Proyecto freelance",
			description: "App de delivery para un cliente",
			status: "cancelled",
			cancelledAt: d("2026-05-01T10:00:00Z"),
		},
	});

	// ────────────────────────
	// Tasks (22 — todas las combos status×priority + edge cases)
	// ────────────────────────

	// Con objetivo activo "Ahorrar para vacaciones"
	const t1 = await prisma.task.create({
		data: { id: uuid(), title: "Comprar pasajes", status: "pending", priority: "high", dueDate: d("2026-07-01T23:59:59Z"), objectiveId: objVacaciones.id },
	});
	const t2 = await prisma.task.create({
		data: { id: uuid(), title: "Reservar hotel", description: "Buscar en Booking y Airbnb", status: "in_progress", priority: "medium", dueDate: d("2026-06-15T23:59:59Z"), objectiveId: objVacaciones.id },
	});
	const t3 = await prisma.task.create({
		data: { id: uuid(), title: "Cambiar dólares", description: "Cotizar en varias casas de cambio", status: "completed", priority: "low", objectiveId: objVacaciones.id },
	});

	// Con objetivo activo "Aprender TypeScript"
	const t4 = await prisma.task.create({
		data: { id: uuid(), title: "Estudiar generics", description: "Advanced types con infer y conditional types", status: "postponed", priority: "high", dueDate: d("2026-05-15T23:59:59Z"), objectiveId: objTypescript.id },
	});
	const t5 = await prisma.task.create({
		data: { id: uuid(), title: "Hacer ejercicio de interfaces", status: "pending", priority: "medium", dueDate: d("2026-06-10T23:59:59Z"), objectiveId: objTypescript.id },
	});
	const t6 = await prisma.task.create({
		data: { id: uuid(), title: "Leer doc de Prisma", status: "in_progress", priority: "low", objectiveId: objTypescript.id },
	});

	// Con objetivo pausado "Organizar la casa"
	const t7 = await prisma.task.create({
		data: { id: uuid(), title: "Ordenar placard", status: "cancelled", priority: "high", objectiveId: objCasa.id, cancelledAt: d("2026-04-20T14:00:00Z") },
	});
	const t8 = await prisma.task.create({
		data: { id: uuid(), title: "Donar ropa", description: "Separar ropa en buen estado para donar", status: "pending", priority: "medium", objectiveId: objCasa.id },
	});

	// Con objetivo completado "Leer 12 libros" — todas las tareas deben estar completed o cancelled
	const t9 = await prisma.task.create({
		data: { id: uuid(), title: "Terminar 'Clean Code'", description: "Capítulos 7 a 12", status: "completed", priority: "medium", objectiveId: objLibros.id },
	});
	const t10 = await prisma.task.create({
		data: { id: uuid(), title: "Leer 'Patterns of Enterprise Application Architecture'", status: "completed", priority: "low", objectiveId: objLibros.id },
	});

	// Con objetivo cancelado "Proyecto freelance" — cascada: todas las tareas cancelled
	const t11 = await prisma.task.create({
		data: { id: uuid(), title: "Desarrollar API REST", status: "cancelled", priority: "high", dueDate: d("2026-04-30T23:59:59Z"), objectiveId: objFreelance.id, cancelledAt: d("2026-05-01T10:00:00Z") },
	});
	const t12 = await prisma.task.create({
		data: { id: uuid(), title: "Diseñar base de datos", status: "cancelled", priority: "medium", objectiveId: objFreelance.id, cancelledAt: d("2026-05-01T10:00:00Z") },
	});

	// Tasks sin objetivo
	const t13 = await prisma.task.create({
		data: { id: uuid(), title: "Comprar leche", status: "pending", priority: "low" },
	});
	const t14 = await prisma.task.create({
		data: { id: uuid(), title: "Llamar al dentista", description: "Sacar turno para control anual", status: "in_progress", priority: "high", dueDate: d("2026-05-20T23:59:59Z") },
	});
	const t15 = await prisma.task.create({
		data: { id: uuid(), title: "Pagar tarjeta de crédito", status: "completed", priority: "high" },
	});
	const t16 = await prisma.task.create({
		data: { id: uuid(), title: "Revisar seguro del auto", status: "postponed", priority: "medium", dueDate: d("2026-06-01T23:59:59Z") },
	});
	const t17 = await prisma.task.create({
		data: { id: uuid(), title: "Planificar cumpleaños", status: "pending", priority: "high" },
	});
	const t18 = await prisma.task.create({
		data: { id: uuid(), title: "Actualizar CV", status: "cancelled", priority: "low", cancelledAt: d("2026-05-10T09:00:00Z") },
	});
	const t19 = await prisma.task.create({
		data: { id: uuid(), title: "Sacar turno para el auto", status: "pending", priority: "low" },
	});

	// Edge cases adicionales
	const t20 = await prisma.task.create({
		data: { id: uuid(), title: "Preparar presentación", status: "pending", priority: "medium", dueDate: d("2026-06-05T23:59:59Z"), context: { location: "oficina", time_of_day: "mañana", device: "laptop" } },
	});
	const t21 = await prisma.task.create({
		data: { id: uuid(), title: "Enviar informe mensual", description: "Completar y enviar por mail a gerencia", status: "in_progress", priority: "high", dueDate: d("2026-05-30T23:59:59Z") },
	});
	const t22 = await prisma.task.create({
		data: { id: uuid(), title: "Comprar regalo cumpleaños", status: "pending", priority: "medium", dueDate: d("2026-07-14T23:59:59Z") },
	});

	// ────────────────────────
	// Lists (6 — todos los status + tipos + edge cases)
	// ────────────────────────
	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Lista del supermercado",
			type: "shopping",
			status: "active",
			items: [
				{ content: "Tomates", quantity: "2 kg", checked: false },
				{ content: "Lechuga", quantity: "1 unidad", checked: true },
				{ content: "Pan", quantity: "1 kg", checked: false },
				{ content: "Huevos", quantity: "12 unidades", checked: true },
				{ content: "Pollo", quantity: "500 g", checked: false },
			],
		},
	});

	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Tareas del hogar",
			type: "general",
			status: "active",
			description: "Pendientes de limpieza de la semana",
			items: [
				{ content: "Limpiar baño", checked: false },
				{ content: "Aspirar sala", checked: true },
				{ content: "Regar plantas", checked: false },
			],
		},
	});

	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Compras semanales",
			type: "shopping",
			status: "completed",
			items: [
				{ content: "Leche", quantity: "2 L", checked: true },
				{ content: "Yogur", quantity: "1 pote", checked: true },
				{ content: "Queso", quantity: "250 g", checked: true },
			],
		},
	});

	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Lista de lecturas",
			type: "general",
			status: "cancelled",
			items: [],
			cancelledAt: d("2026-04-01T12:00:00Z"),
		},
	});

	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Ingredientes para la cena",
			type: "ingredients",
			status: "active",
			items: [
				{ content: "Pasta", quantity: "500 g", checked: false },
				{ content: "Tomate triturado", quantity: "1 lata", checked: false },
				{ content: "Albahaca fresca", quantity: "1 atado", checked: false },
			],
		},
	});

	await prisma.list.create({
		data: {
			id: uuid(),
			title: "Lista vacía",
			type: "general",
			status: "active",
			items: [],
		},
	});

	// ────────────────────────
	// Events (8 — todos los status + recurrencia + excepción)
	// ────────────────────────
	const evReunion = await prisma.event.create({
		data: {
			id: uuid(),
			title: "Reunión de equipo",
			startTime: d("2026-06-01T10:00:00Z"),
			endTime: d("2026-06-01T11:00:00Z"),
			location: "Sala A",
			category: "trabajo",
			status: "active",
		},
	});

	const evCumple = await prisma.event.create({
		data: {
			id: uuid(),
			title: "Cumpleaños de mamá",
			startTime: d("2026-07-15T00:00:00Z"),
			description: "No olvidar comprar regalo",
			category: "personal",
			status: "active",
		},
	});

	await prisma.event.create({
		data: {
			id: uuid(),
			title: "Daily standup",
			startTime: d("2026-05-01T09:00:00Z"),
			endTime: d("2026-05-01T09:15:00Z"),
			category: "trabajo",
			status: "active",
			recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [1, 2, 3, 4, 5] },
		},
	});

	const evYoga = await prisma.event.create({
		data: {
			id: uuid(),
			title: "Clase de yoga",
			startTime: d("2026-06-01T18:00:00Z"),
			endTime: d("2026-06-01T19:00:00Z"),
			category: "salud",
			status: "active",
			recurrenceRule: { frequency: "weekly", interval: 1, daysOfWeek: [1, 3, 5] },
		},
	});

	// Excepción: mover la clase del miércoles 3 de junio al jueves 4
	await prisma.event.create({
		data: {
			id: uuid(),
			title: "Clase de yoga (excepción)",
			startTime: d("2026-06-04T18:00:00Z"),
			endTime: d("2026-06-04T19:00:00Z"),
			category: "salud",
			status: "active",
			parentId: evYoga.id,
			isException: true,
			exceptionDate: d("2026-06-03T18:00:00Z"),
		},
	});

	await prisma.event.create({
		data: {
			id: uuid(),
			title: "Revisión trimestral",
			startTime: d("2026-03-31T14:00:00Z"),
			endTime: d("2026-03-31T15:30:00Z"),
			category: "trabajo",
			status: "completed",
		},
	});

	const evCena = await prisma.event.create({
		data: {
			id: uuid(),
			title: "Cena con amigos",
			startTime: d("2026-06-10T20:00:00Z"),
			location: "La Parolaccia",
			category: "personal",
			status: "cancelled",
			cancelledAt: d("2026-05-28T10:00:00Z"),
		},
	});

	// ────────────────────────
	// TaskEventLinks
	// ────────────────────────
	await prisma.taskEventLink.createMany({
		data: [
			{ taskId: t1.id, eventId: evReunion.id },
			{ taskId: t2.id, eventId: evReunion.id },
			{ taskId: t17.id, eventId: evCumple.id },
		],
	});

	// ────────────────────────
	// Memories (6 — varios interaction_type)
	// ────────────────────────
	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "El usuario prefiere trabajar por la mañana temprano",
			metadata: { interaction_type: "preference_declaration", entities: ["scheduling"], context: "mencionado durante revisión de rutina diaria" },
		},
	});

	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "Al usuario no le gusta cocinar entre semana",
			metadata: { interaction_type: "preference_declaration", entities: ["meal_planning", "cooking"], context: "conversación casual" },
		},
	});

	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "El usuario decidió posponer el proyecto freelance por falta de tiempo",
			metadata: { interaction_type: "decision", entities: ["proyecto freelance", "objectives"], context: "decisión después de evaluar carga horaria" },
		},
	});

	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "El usuario quiere ahorrar $5000 antes de fin de año",
			metadata: { interaction_type: "goal", entities: ["finances", "vacaciones"], context: "objetivo financiero declarado" },
		},
	});

	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "El usuario rinde mejor cuando las tareas tienen deadlines cortos",
			metadata: { interaction_type: "insight", entities: ["productivity", "tasks"], context: "observación del patrón de comportamiento" },
		},
	});

	await prisma.memory.create({
		data: {
			id: uuid(),
			content: "El usuario quiere visitar Japón el próximo año",
			metadata: { interaction_type: "general", entities: ["travel", "Japan"], context: "mencionado durante planeación de vacaciones" },
		},
	});

	// ────────────────────────
	// ConversationTurns (7 — una sesión con varios turns)
	// ────────────────────────
	const sessionId = uuid();
	await prisma.conversationTurn.createMany({
		data: [
			{ id: uuid(), sessionId, role: "user", content: "¿Qué tareas tengo que hacer hoy?", createdAt: d("2026-05-30T08:00:00Z") },
			{ id: uuid(), sessionId, role: "assistant", content: "Tenés que enviar el informe mensual (alta prioridad) y preparar la presentación para el viernes.", createdAt: d("2026-05-30T08:00:05Z") },
			{ id: uuid(), sessionId, role: "user", content: "Acordame comprar el regalo de cumpleaños de mamá", createdAt: d("2026-05-30T08:01:00Z") },
			{ id: uuid(), sessionId, role: "assistant", content: "Listo, ya creé la tarea 'Comprar regalo cumpleaños' con vencimiento 14 de julio. 🎁", createdAt: d("2026-05-30T08:01:05Z") },
			{ id: uuid(), sessionId, role: "system", content: "Quick Memory updated with new task", createdAt: d("2026-05-30T08:01:06Z") },
			{ id: uuid(), sessionId, role: "user", content: "Agregá tomates y lechuga a la lista del supermercado", createdAt: d("2026-05-30T10:00:00Z") },
			{ id: uuid(), sessionId, role: "assistant", content: "Agregué tomates (2 kg) y lechuga (1 unidad) a la lista del supermercado. 📋", createdAt: d("2026-05-30T10:00:05Z") },
		],
	});

	// ────────────────────────
	// Jobs (6 — combinaciones de status × source)
	// ────────────────────────
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "process_message", source: "websocket", payload: { transcribed_text: "¿Qué tareas tengo pendientes?" }, status: "pending" },
	});
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "process_message", source: "scheduled", payload: { transcribed_text: "Recordatorio: revisar seguro del auto" }, status: "processing", lockedAt: d("2026-05-30T08:00:00Z"), lockedBy: "worker-1" },
	});
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "process_message", source: "websocket", payload: { transcribed_text: "Crear tarea para comprar leche" }, status: "completed", result: { ok: true, action: "create_task", title: "Comprar leche" } },
	});
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "consolidate_memories", source: "system", payload: {}, status: "failed", attempts: 3, maxAttempts: 3, result: { ok: false, error: "MEMORY_CONSOLIDATION_FAILED", message: "No se pudieron consolidar las memorias" } },
	});
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "process_message", source: "scheduled", payload: { transcribed_text: "Recordatorio semanal" }, status: "pending", runAt: d("2026-06-06T09:00:00Z") },
	});
	await prisma.job.create({
		data: { id: uuid(), correlationId: uuid(), sessionId, type: "process_message", source: "websocket", payload: { transcribed_text: "Completar tarea de presupuesto" }, status: "completed" },
	});

	// ────────────────────────
	// Devices (2 — iOS + Android)
	// ────────────────────────
	await prisma.device.create({
		data: { id: uuid(), fcmToken: "fcm-token-ios-device", platform: "ios" },
	});
	await prisma.device.create({
		data: { id: uuid(), fcmToken: "fcm-token-android-device", platform: "android" },
	});

	console.log("Seed completed successfully.");
	console.log(`  Objectives: 5 (active×2, paused, completed, cancelled)`);
	console.log(`  Tasks: 22 (5 status × 3 priority + 7 edge cases)`);
	console.log(`  Lists: 6 (active×4, completed, cancelled)`);
  console.log(`  Events: 7 (incl. 1 recurrence exception, active×5, completed, cancelled)`);
	console.log(`  TaskEventLinks: 3`);
	console.log(`  Memories: 6 (preference×2, decision, goal, insight, general)`);
	console.log(`  ConversationTurns: 7 (1 session)`);
	console.log(`  Jobs: 6 (pending×2, processing, completed×2, failed)`);
	console.log(`  Devices: 2 (ios, android)`);
}

seed()
	.catch((err) => {
		console.error("Seed failed:", err);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
