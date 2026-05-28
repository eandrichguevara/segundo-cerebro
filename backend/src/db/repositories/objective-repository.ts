import type { $Enums, Prisma } from "@prisma/client";
import type { ObjectiveStatus } from "../../domain/objective.js";
import { prisma } from "../index.js";

type ObjectiveRecord = {
	id: string;
	title: string;
	description: string | null;
	deadline: Date | null;
	status: string;
	createdAt: Date;
	updatedAt: Date;
	cancelledAt: Date | null;
};

export async function createObjective(data: {
	title: string;
	description?: string;
	deadline?: string;
}) {
	const objective = await prisma.objective.create({
		data: {
			title: data.title,
			description: data.description ?? null,
			deadline: data.deadline ? new Date(data.deadline) : null,
		},
	});
	return objective as unknown as ObjectiveRecord;
}

export async function getObjectiveById(id: string) {
	const objective = await prisma.objective.findUnique({ where: { id } });
	return objective as unknown as ObjectiveRecord | null;
}

export async function updateObjective(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		deadline?: string | null;
	},
) {
	const updateData: Prisma.ObjectiveUncheckedUpdateInput = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.deadline !== undefined)
		updateData.deadline = data.deadline ? new Date(data.deadline) : null;

	const objective = await prisma.objective.update({
		where: { id },
		data: updateData,
	});
	return objective as unknown as ObjectiveRecord;
}

export async function transitionObjectiveStatus(
	id: string,
	status: ObjectiveStatus,
	cancelledAt?: Date | null,
) {
	const updateData: Prisma.ObjectiveUncheckedUpdateInput = {
		status: status as $Enums.ObjectiveStatus,
	};
	if (cancelledAt !== undefined) {
		updateData.cancelledAt = cancelledAt;
	}
	const objective = await prisma.objective.update({
		where: { id },
		data: updateData,
	});
	return objective as unknown as ObjectiveRecord;
}

export async function getActiveObjectives() {
	const objectives = await prisma.objective.findMany({
		where: {
			status: { in: ["active", "paused"] as $Enums.ObjectiveStatus[] },
		},
		orderBy: { createdAt: "desc" },
	});
	return objectives as unknown as ObjectiveRecord[];
}

export async function getTasksByObjective(objectiveId: string) {
	const tasks = await prisma.task.findMany({
		where: { objectiveId },
	});
	return tasks;
}
