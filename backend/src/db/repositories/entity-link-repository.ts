import type { $Enums } from "@prisma/client";
import { prisma } from "../index.js";

export type EntityLinkRecord = {
	id: string;
	sourceType: string;
	sourceId: string;
	targetType: string;
	targetId: string;
	relation: string;
	note: string | null;
	createdAt: Date;
};

export async function createLink(data: {
	sourceType: string;
	sourceId: string;
	targetType: string;
	targetId: string;
	relation?: string;
	note?: string;
}) {
	const link = await prisma.entityLink.upsert({
		where: {
			sourceType_sourceId_targetType_targetId: {
				sourceType: data.sourceType as $Enums.EntityType,
				sourceId: data.sourceId,
				targetType: data.targetType as $Enums.EntityType,
				targetId: data.targetId,
			},
		},
		create: {
			sourceType: data.sourceType as $Enums.EntityType,
			sourceId: data.sourceId,
			targetType: data.targetType as $Enums.EntityType,
			targetId: data.targetId,
			relation: data.relation ?? "related",
			note: data.note ?? null,
		},
		update: {
			relation: data.relation ?? "related",
			note: data.note ?? null,
		},
	});
	return link as unknown as EntityLinkRecord;
}

export async function removeLink(
	sourceType: string,
	sourceId: string,
	targetType: string,
	targetId: string,
) {
	await prisma.entityLink.deleteMany({
		where: {
			OR: [
				{
					sourceType: sourceType as $Enums.EntityType,
					sourceId,
					targetType: targetType as $Enums.EntityType,
					targetId,
				},
				{
					sourceType: targetType as $Enums.EntityType,
					sourceId: targetId,
					targetType: sourceType as $Enums.EntityType,
					targetId: sourceId,
				},
			],
		},
	});
}

export async function getLinksFor(entityType: string, entityId: string) {
	const links = await prisma.entityLink.findMany({
		where: {
			OR: [
				{
					sourceType: entityType as $Enums.EntityType,
					sourceId: entityId,
				},
				{
					targetType: entityType as $Enums.EntityType,
					targetId: entityId,
				},
			],
		},
		orderBy: { createdAt: "desc" },
	});
	return links as unknown as EntityLinkRecord[];
}

export async function getLinksBetween(
	type1: string,
	id1: string,
	type2: string,
	id2: string,
) {
	const links = await prisma.entityLink.findMany({
		where: {
			OR: [
				{
					sourceType: type1 as $Enums.EntityType,
					sourceId: id1,
					targetType: type2 as $Enums.EntityType,
					targetId: id2,
				},
				{
					sourceType: type2 as $Enums.EntityType,
					sourceId: id2,
					targetType: type1 as $Enums.EntityType,
					targetId: id1,
				},
			],
		},
	});
	return links as unknown as EntityLinkRecord[];
}
