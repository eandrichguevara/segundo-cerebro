import type { QuickMemoryResponse } from "@/types/quick-memory";

export async function fetchQuickMemory(): Promise<QuickMemoryResponse> {
	const apiUrl = process.env.API_URL ?? "http://localhost:3000";
	const res = await fetch(`${apiUrl}/debug/quick-memory`, { cache: "no-store" });
	if (!res.ok) {
		throw new Error(`Backend responded with ${res.status}`);
	}
	return res.json();
}
