import type { ConversationRole } from "@prisma/client";

import { prisma } from "../index.js";

type ConversationTurnRecord = {
	id: string;
	sessionId: string;
	role: string;
	content: string;
	createdAt: Date;
};

export async function addTurn(data: {
	sessionId: string;
	role: ConversationRole;
	content: string;
}) {
	const turn = await prisma.conversationTurn.create({
		data: {
			sessionId: data.sessionId,
			role: data.role,
			content: data.content,
		},
	});
	return turn as unknown as ConversationTurnRecord;
}

export async function getRecentTurns(sessionId: string, limit = 10) {
	const turns = await prisma.conversationTurn.findMany({
		where: { sessionId },
		orderBy: { createdAt: "desc" },
		take: limit,
	});
	return (turns as unknown as ConversationTurnRecord[]).reverse();
}
