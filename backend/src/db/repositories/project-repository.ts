import type { $Enums, Prisma } from "@prisma/client";
import type { ProjectStatus } from "../../domain/project.js";
import { prisma } from "../index.js";

export type ProjectRecord = {
	id: string;
	title: string;
	description: string | null;
	status: string;
	category: string | null;
	deadline: Date | null;
	createdAt: Date;
	updatedAt: Date;
	cancelledAt: Date | null;
};

export async function createProject(data: {
	title: string;
	description?: string;
	category?: string;
	deadline?: string;
}) {
	const project = await prisma.project.create({
		data: {
			title: data.title,
			description: data.description ?? null,
			category: data.category ?? null,
			deadline: data.deadline ? new Date(data.deadline) : null,
		},
	});
	return project as unknown as ProjectRecord;
}

export async function getProjectById(id: string) {
	const project = await prisma.project.findUnique({ where: { id } });
	return project as unknown as ProjectRecord | null;
}

export async function updateProject(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		category?: string | null;
		deadline?: string | null;
	},
) {
	const updateData: Prisma.ProjectUncheckedUpdateInput = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.category !== undefined) updateData.category = data.category;
	if (data.deadline !== undefined)
		updateData.deadline = data.deadline ? new Date(data.deadline) : null;

	const project = await prisma.project.update({
		where: { id },
		data: updateData,
	});
	return project as unknown as ProjectRecord;
}

export async function transitionProjectStatus(
	id: string,
	status: ProjectStatus,
	cancelledAt?: Date | null,
) {
	const updateData: Prisma.ProjectUncheckedUpdateInput = {
		status: status as $Enums.ProjectStatus,
	};
	if (cancelledAt !== undefined) {
		updateData.cancelledAt = cancelledAt;
	}
	const project = await prisma.project.update({
		where: { id },
		data: updateData,
	});
	return project as unknown as ProjectRecord;
}

export async function getActiveProjects() {
	const projects = await prisma.project.findMany({
		where: {
			status: { in: ["active", "paused"] as $Enums.ProjectStatus[] },
		},
		orderBy: { createdAt: "desc" },
	});
	return projects as unknown as ProjectRecord[];
}
