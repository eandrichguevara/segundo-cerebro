import { sendToSession } from "../api/ws.js";
import { logger } from "../config/logger.js";
import * as deviceRepository from "../db/repositories/device-repository.js";
import { sendNotification } from "./fcm.js";

type NotificationPayload = {
	title: string;
	body: string;
	data?: Record<string, string>;
};

export async function notifyUser(
	sessionId: string | null,
	wsMsg: Record<string, unknown>,
	fcmPayload?: NotificationPayload,
): Promise<void> {
	if (sessionId) {
		const sent = sendToSession(sessionId, wsMsg);
		if (sent) return;
		logger.info({ sessionId }, "Sesión no conectada, enviando por FCM");
	}

	if (!fcmPayload) return;

	const tokens = await deviceRepository.getAllTokens();
	if (tokens.length === 0) {
		logger.warn("No hay FCM tokens registrados");
		return;
	}

	for (const token of tokens) {
		const result = await sendNotification(token, fcmPayload);
		if (!result.ok) {
			logger.warn(
				{ fcmToken: token.slice(0, 8) },
				"FCM send failed, removing token",
			);
			await deviceRepository.removeToken(token).catch(() => {});
		}
	}
}
