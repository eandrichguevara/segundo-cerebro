import type { EventRow } from "@/lib/api";

const CATEGORY_COLORS: Record<string, string> = {
	trabajo: "bg-blue-500/20 text-blue-400",
	personal: "bg-emerald-500/20 text-emerald-400",
	salud: "bg-rose-500/20 text-rose-400",
	ocio: "bg-amber-500/20 text-amber-400",
	familia: "bg-purple-500/20 text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
	active: "🟢 Activo",
	completed: "✅ Completado",
	cancelled: "❌ Cancelado",
};

export function EventTimeline({ events }: { events: EventRow[] }) {
	const grouped = groupByDate(events);

	return (
		<div className="space-y-8">
			{grouped.map(({ date, items }) => (
				<div key={date}>
					<div className="mb-3 flex items-center gap-2">
						<div className="h-2 w-2 rounded-full bg-primary" />
						<h3 className="text-sm font-semibold">
							{formatDateHeading(date)}
						</h3>
					</div>
					<div className="ml-4 space-y-3 border-l-2 border-border pl-4">
						{items.map((event) => {
							const catColor = CATEGORY_COLORS[event.category ?? ""] ?? "bg-secondary text-muted-foreground";
							return (
								<div
									key={event.id}
									className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2">
												<h4 className="truncate font-semibold">{event.title}</h4>
												{event.isException && (
													<span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
														excepción
													</span>
												)}
											</div>
											{event.description && (
												<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
													{event.description}
												</p>
											)}
										</div>
										<span className="shrink-0 text-xs text-muted-foreground">
											{STATUS_LABELS[event.status] ?? event.status}
										</span>
									</div>

									<div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
										<span className="flex items-center gap-1">🕐 {formatTime(event.startTime)}{event.endTime ? ` — ${formatTime(event.endTime)}` : ""}</span>
										{event.location && <span className="flex items-center gap-1">📍 {event.location}</span>}
										{event.category && (
											<span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${catColor}`}>
												{event.category}
											</span>
										)}
										{event.recurrenceRule && (
											<span className="flex items-center gap-1">🔄 Recurrente</span>
										)}
									</div>

									{event.links && event.links.length > 0 && (
										<div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-3">
											{event.links.map((link) => (
												<div key={link.id} className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1">
													<span className="font-semibold uppercase text-[9px] text-primary">{link.linkedType}</span>
													<span className="truncate text-xs text-muted-foreground" title={link.linkedTitle}>{link.linkedTitle}</span>
												</div>
											))}
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

function groupByDate(events: EventRow[]) {
	const map = new Map<string, EventRow[]>();
	for (const event of events) {
		const date = new Date(event.startTime).toLocaleDateString("es-AR", {
			year: "numeric", month: "2-digit", day: "2-digit",
		});
		if (!map.has(date)) map.set(date, []);
		map.get(date)!.push(event);
	}
	return Array.from(map.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, items]) => ({ date, items }));
}

function formatDateHeading(dateStr: string) {
	const [day, month, year] = dateStr.split("/");
	const d = new Date(Number(year), Number(month) - 1, Number(day));
	const today = new Date();
	const tomorrow = new Date(today);
	tomorrow.setDate(today.getDate() + 1);

	if (d.toDateString() === today.toDateString()) return "Hoy";
	if (d.toDateString() === tomorrow.toDateString()) return "Mañana";

	return d.toLocaleDateString("es-AR", {
		weekday: "long", day: "numeric", month: "long",
	});
}

function formatTime(iso: string) {
	return new Date(iso).toLocaleTimeString("es-AR", {
		hour: "2-digit", minute: "2-digit",
	});
}
