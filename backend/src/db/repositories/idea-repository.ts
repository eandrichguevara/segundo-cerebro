import type { $Enums, Prisma } from "@prisma/client";
import type { IdeaStatus } from "../../domain/idea.js";
import { prisma } from "../index.js";

export type IdeaRecord = {
	id: string;
	title: string;
	description: string | null;
	status: string;
	tags: string[];
	createdAt: Date;
	updatedAt: Date;
};

export async function createIdea(data: {
	title: string;
	description?: string;
	tags?: string[];
}) {
	const idea = await prisma.idea.create({
		data: {
			title: data.title,
			description: data.description ?? null,
			tags: data.tags ?? [],
		},
	});
	return idea as unknown as IdeaRecord;
}

export async function getIdeaById(id: string) {
	const idea = await prisma.idea.findUnique({ where: { id } });
	return idea as unknown as IdeaRecord | null;
}

export async function updateIdea(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		tags?: string[];
	},
) {
	const updateData: Prisma.IdeaUncheckedUpdateInput = {};
	if (data.title !== undefined) updateData.title = data.title;
	if (data.description !== undefined) updateData.description = data.description;
	if (data.tags !== undefined) updateData.tags = data.tags;

	const idea = await prisma.idea.update({
		where: { id },
		data: updateData,
	});
	return idea as unknown as IdeaRecord;
}

export async function transitionIdeaStatus(id: string, status: IdeaStatus) {
	const idea = await prisma.idea.update({
		where: { id },
		data: { status: status as $Enums.IdeaStatus },
	});
	return idea as unknown as IdeaRecord;
}

export async function getActiveIdeas() {
	const ideas = await prisma.idea.findMany({
		where: {
			status: {
				in: ["new_idea", "evaluating", "approved"] as $Enums.IdeaStatus[],
			},
		},
		orderBy: { createdAt: "desc" },
	});
	return ideas as unknown as IdeaRecord[];
}
