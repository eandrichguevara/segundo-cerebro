import type { $Enums, Prisma } from "@prisma/client";
import type { TaskStatus } from "../../domain/task.js";
import { prisma } from "../index.js";

type TaskRecord = {
	id: string;
	title: string;
	description: string | null;
	status: string;
	dueDate: Date | null;
	priority: string;
	context: Prisma.JsonValue;
	objectiveId: string | null;
	reminderAt: Date | null;
	reminderFiredAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	cancelledAt: Date | null;
};

export async function createTask(data: {
	title: string;
	description?: string;
	dueDate?: string;
	objectiveId?: string;
	priority?: string;
	context?: Record<string, unknown>;
	reminderAt?: string;
}) {
	const task = await prisma.task.create({
		data: {
			title: data.title,
			description: data.description ?? null,
			dueDate: data.dueDate ? new Date(data.dueDate) : null,
			objectiveId: data.objectiveId ?? null,
			priority: (data.priority ?? "medium") as $Enums.TaskPriority,
			context: (data.context ?? {}) as Prisma.InputJsonValue,
			reminderAt: data.reminderAt ? new Date(data.reminderAt) : null,
		},
	});
	return task as unknown as TaskRecord;
}

export async function getTaskById(id: string) {
	const task = await prisma.task.findUnique({ where: { id } });
	return task as unknown as TaskRecord | null;
}

export async function updateTask(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		dueDate?: string | null;
		objectiveId?: string | null;
		priority?: string;
		context?: Record<string, unknown>;
		reminderAt?: string | null;
	},
) {
	const updateData: Prisma.TaskUncheckedUpdateInput = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.dueDate !== undefined)
		updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
	if (data.objectiveId !== undefined) updateData.objectiveId = data.objectiveId;
	if (data.priority !== undefined)
		updateData.priority = data.priority as $Enums.TaskPriority;
	if (data.context !== undefined)
		updateData.context = data.context as Prisma.InputJsonValue;
	if (data.reminderAt !== undefined)
		updateData.reminderAt = data.reminderAt ? new Date(data.reminderAt) : null;

	const task = await prisma.task.update({ where: { id }, data: updateData });
	return task as unknown as TaskRecord;
}

export async function transitionTaskStatus(
	id: string,
	status: TaskStatus,
	cancelledAt?: Date | null,
) {
	const updateData: Prisma.TaskUncheckedUpdateInput = {
		status: status as $Enums.TaskStatus,
	};
	if (cancelledAt !== undefined) {
		updateData.cancelledAt = cancelledAt;
	}
	const task = await prisma.task.update({ where: { id }, data: updateData });
	return task as unknown as TaskRecord;
}

export async function getActiveTasks() {
	const tasks = await prisma.task.findMany({
		where: {
			status: {
				in: ["pending", "in_progress", "postponed"] as $Enums.TaskStatus[],
			},
		},
		orderBy: { createdAt: "desc" },
	});
	return tasks as unknown as TaskRecord[];
}

export async function getTasksByObjective(objectiveId: string) {
	const tasks = await prisma.task.findMany({
		where: { objectiveId },
	});
	return tasks as unknown as TaskRecord[];
}

/**
 * Returns active tasks whose reminder is due and has not been fired yet.
 * Used by the task-reminder-worker poll loop.
 */
export async function getTasksDueForReminder(now: Date) {
	const tasks = await prisma.task.findMany({
		where: {
			reminderAt: { lte: now },
			reminderFiredAt: null,
			status: {
				notIn: ["completed", "cancelled"] as $Enums.TaskStatus[],
			},
		},
		orderBy: { reminderAt: "asc" },
	});
	return tasks as unknown as TaskRecord[];
}

/**
 * Marks a task's reminder as fired (oneshot — prevents re-sending).
 */
export async function markReminderFired(id: string, firedAt: Date) {
	const task = await prisma.task.update({
		where: { id },
		data: { reminderFiredAt: firedAt },
	});
	return task as unknown as TaskRecord;
}
