import type { messaging } from "firebase-admin";
import { logger } from "../config/logger.js";
import type { Result } from "../types/result.js";
import { getFirebaseApp } from "./client.js";

export enum FcmError {
	SEND_FAILED = "SEND_FAILED",
	INVALID_TOKEN = "INVALID_TOKEN",
	DEVICE_UNREGISTERED = "DEVICE_UNREGISTERED",
	TIMEOUT = "TIMEOUT",
}

const TIMEOUT_MS = 10_000;

type FcmPayload = {
	title: string;
	body: string;
	data?: Record<string, string>;
	sendNotification?: boolean;
};

export async function sendNotification(
	fcmToken: string,
	payload: FcmPayload,
): Promise<Result<void, FcmError>> {
	try {
		const app = getFirebaseApp();
		const message: messaging.Message = {
			token: fcmToken,
			data: payload.data,
			...(payload.sendNotification !== false && payload.title
				? {
						notification: {
							title: payload.title,
							body: payload.body,
						},
					}
				: {}),
		};

		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new DOMException("Timeout", "AbortError")),
				TIMEOUT_MS,
			),
		);

		const result = await Promise.race([
			app.messaging().send(message),
			timeoutPromise,
		]).catch((error) => {
			if (error instanceof DOMException && error.name === "AbortError") {
				return { ok: false as const, error: FcmError.TIMEOUT };
			}
			throw error;
		});

		if (result && typeof result === "object" && "ok" in result && !result.ok) {
			return result;
		}

		logger.info({ fcmToken: maskToken(fcmToken) }, "FCM notification sent");
		return { ok: true, value: undefined };
	} catch (error: unknown) {
		const err = error as { code?: string };
		if (
			err?.code === "messaging/invalid-registration-token" ||
			err?.code === "messaging/invalid-argument"
		) {
			logger.warn({ fcmToken: maskToken(fcmToken) }, "Invalid FCM token");
			return { ok: false, error: FcmError.INVALID_TOKEN };
		}
		if (
			err?.code === "messaging/registration-token-not-registered" ||
			err?.code === "messaging/unregistered"
		) {
			logger.warn({ fcmToken: maskToken(fcmToken) }, "FCM token unregistered");
			return { ok: false, error: FcmError.DEVICE_UNREGISTERED };
		}
		logger.error({ error }, "FCM send failed");
		return { ok: false, error: FcmError.SEND_FAILED };
	}
}

function maskToken(token: string): string {
	if (token.length <= 8) return "****";
	return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
