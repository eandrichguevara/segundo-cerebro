import { env } from "../config/env.js";

export function verifyAuth(token: unknown): boolean {
	return (
		typeof token === "string" && token.length > 0 && token === env.AUTH_TOKEN
	);
}
