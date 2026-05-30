import { fetchDbData, type ConversationRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";

export const dynamic = "force-dynamic";

export default async function ConversationsPage() {
	let data: ConversationRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<ConversationRow>("conversations", { limit: 200 });
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	if (data.length === 0) {
		return (
			<div>
				<SectionHeader icon="💬" title="Conversaciones" description="Historial de interacciones por sesión" total={0} />
				<p className="py-12 text-center text-sm text-muted-foreground">No hay conversaciones.</p>
			</div>
		);
	}

	const grouped = groupBySession(data);

	return (
		<div>
			<SectionHeader icon="💬" title="Conversaciones" description="Historial de interacciones por sesión" total={total} />
			<div className="space-y-8">
				{grouped.map(({ sessionId, turns }) => (
					<div key={sessionId} className="rounded-xl border border-border bg-card p-4">
						<div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
							<span className="text-xs font-mono text-muted-foreground">
								Sesión: {sessionId.slice(0, 8)}…
							</span>
							<span className="text-xs text-muted-foreground">
								{turns.length} mensajes
							</span>
							<span className="ml-auto text-[10px] text-muted-foreground">
								{new Date(turns[0].createdAt).toLocaleDateString("es-AR", {
									day: "numeric", month: "short",
								})}
							</span>
						</div>
						<div className="space-y-3">
							{turns.map((turn) => {
								const isUser = turn.role === "user";
								return (
									<div
										key={turn.id}
										className={`flex ${isUser ? "justify-end" : "justify-start"}`}
									>
										<div
											className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
												isUser
													? "bg-primary text-primary-foreground"
													: turn.role === "system"
														? "bg-secondary/50 text-muted-foreground italic"
														: "bg-secondary text-foreground"
											}`}
										>
											<p className="whitespace-pre-wrap break-words">{turn.content}</p>
											<p className="mt-1 text-[10px] opacity-70">
												{new Date(turn.createdAt).toLocaleTimeString("es-AR", {
													hour: "2-digit", minute: "2-digit",
												})}
											</p>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function groupBySession(turns: ConversationRow[]) {
	const map = new Map<string, ConversationRow[]>();
	for (const turn of turns) {
		if (!map.has(turn.sessionId)) map.set(turn.sessionId, []);
		map.get(turn.sessionId)!.push(turn);
	}
	return Array.from(map.entries())
		.sort(([, a], [, b]) => new Date(b[0].createdAt).getTime() - new Date(a[0].createdAt).getTime())
		.map(([sessionId, items]) => ({
			sessionId,
			turns: items.reverse(),
		}));
}
