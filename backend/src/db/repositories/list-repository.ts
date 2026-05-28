import type { Prisma } from "@prisma/client";
import type { ListItem, ListStatus } from "../../domain/list.js";
import { prisma } from "../index.js";

type ListRecord = {
	id: string;
	title: string;
	description: string | null;
	type: string;
	status: string;
	items: Prisma.JsonValue;
	createdAt: Date;
	updatedAt: Date;
	cancelledAt: Date | null;
};

function parseItems(raw: Prisma.JsonValue): ListItem[] {
	if (!raw || !Array.isArray(raw)) return [];
	return raw as ListItem[];
}

export async function createList(data: {
	title: string;
	type?: string;
	description?: string;
	items?: ListItem[];
}) {
	const list = await prisma.list.create({
		data: {
			title: data.title,
			type: data.type ?? "general",
			description: data.description ?? null,
			items: data.items ?? [],
		},
	});
	return list as ListRecord;
}

export async function getListById(id: string) {
	const list = await prisma.list.findUnique({ where: { id } });
	return list as ListRecord | null;
}

export async function updateList(
	id: string,
	data: {
		title?: string;
		description?: string | null;
		type?: string;
		items?: ListItem[];
	},
) {
	const list = await prisma.list.update({
		where: { id },
		data,
	});
	return list as ListRecord;
}

export async function transitionListStatus(
	id: string,
	status: ListStatus,
	cancelledAt?: Date | null,
) {
	const list = await prisma.list.update({
		where: { id },
		data: {
			status,
			...(cancelledAt !== undefined ? { cancelledAt } : {}),
		},
	});
	return list as ListRecord;
}

export async function getAllActive() {
	const lists = await prisma.list.findMany({
		where: { status: "active" },
		orderBy: { createdAt: "desc" },
	});
	return lists as unknown as ListRecord[];
}

export async function findActiveByTitle(title: string) {
	const lists = await prisma.list.findMany({
		where: {
			status: "active",
			title: { contains: title, mode: "insensitive" },
		},
		orderBy: { createdAt: "desc" },
	});
	return lists as unknown as ListRecord[];
}

export async function findActiveByExactTitle(title: string) {
	const list = await prisma.list.findFirst({
		where: {
			status: "active",
			title: { equals: title, mode: "insensitive" },
		},
	});
	return (list ?? null) as ListRecord | null;
}

export function getItems(list: ListRecord): ListItem[] {
	return parseItems(list.items);
}
