import { readFileSync } from "node:fs";
import admin from "firebase-admin";
import { env } from "../config/env.js";

let app: admin.app.App | null = null;

export function getFirebaseApp(): admin.app.App {
	if (!app) {
		const serviceAccount = JSON.parse(
			readFileSync(env.FCM_SERVICE_ACCOUNT, "utf-8"),
		);
		app = admin.initializeApp({
			credential: admin.credential.cert(serviceAccount),
		});
	}
	return app;
}
