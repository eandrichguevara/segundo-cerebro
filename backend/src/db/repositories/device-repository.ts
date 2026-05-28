import { prisma } from "../index.js";

export async function upsertDevice(
	fcmToken: string,
	platform: string,
): Promise<void> {
	await prisma.device.upsert({
		where: { fcmToken },
		create: { fcmToken, platform },
		update: { platform, updatedAt: new Date() },
	});
}

export async function getAllTokens(): Promise<string[]> {
	const devices = await prisma.device.findMany({
		select: { fcmToken: true },
	});
	return devices.map((d) => d.fcmToken);
}

export async function removeToken(fcmToken: string): Promise<void> {
	await prisma.device.deleteMany({ where: { fcmToken } });
}
