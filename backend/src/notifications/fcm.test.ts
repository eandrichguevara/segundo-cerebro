import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSend = vi.fn();

vi.mock("firebase-admin", () => ({
	default: {
		initializeApp: vi.fn().mockReturnValue({}),
		credential: {
			cert: vi.fn().mockReturnValue({}),
		},
	},
}));

vi.mock("node:fs", () => ({
	readFileSync: vi
		.fn()
		.mockReturnValue(JSON.stringify({ type: "service_account" })),
}));

vi.mock("../config/env.js", () => ({
	env: {
		FCM_SERVICE_ACCOUNT: "./test-account.json",
	},
}));

vi.mock("../config/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("FCM notifications", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("should export FcmError enum", async () => {
		const { FcmError } = await import("./fcm.js");
		expect(FcmError.SEND_FAILED).toBe("SEND_FAILED");
		expect(FcmError.INVALID_TOKEN).toBe("INVALID_TOKEN");
		expect(FcmError.DEVICE_UNREGISTERED).toBe("DEVICE_UNREGISTERED");
		expect(FcmError.TIMEOUT).toBe("TIMEOUT");
	});

	it("should return TIMEOUT on slow response", async () => {
		vi.doMock("firebase-admin", () => ({
			default: {
				initializeApp: vi.fn().mockReturnValue({}),
				credential: { cert: vi.fn().mockReturnValue({}) },
			},
		}));

		const messagingMock = {
			send: vi
				.fn()
				.mockImplementation(
					() =>
						new Promise((resolve) =>
							setTimeout(() => resolve({ messageId: "test" }), 200),
						),
				),
		};

		vi.doMock("./client.js", () => ({
			getFirebaseApp: vi
				.fn()
				.mockReturnValue({ messaging: () => messagingMock }),
		}));

		const fcmModule = await import("./fcm.js");
		const result = await fcmModule.sendNotification("test-token", {
			title: "Test",
			body: "Test body",
		});

		expect(result).toEqual({ ok: true, value: undefined });
	});

	it("should handle send failure with unknown error", async () => {
		vi.doMock("./client.js", () => ({
			getFirebaseApp: vi.fn().mockImplementation(() => {
				throw new Error("Network error");
			}),
		}));

		const fcmModule = await import("./fcm.js");
		const result = await fcmModule.sendNotification("test-token", {
			title: "Test",
			body: "Test body",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBe("SEND_FAILED");
		}
	});
});
