import type { TaskRow } from "@/lib/api";

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const STATUS_STYLES: Record<string, string> = {
	pending: "border-l-amber-500 bg-amber-500/5",
	in_progress: "border-l-blue-500 bg-blue-500/5",
	completed: "border-l-emerald-500 bg-emerald-500/5",
	postponed: "border-l-orange-500 bg-orange-500/5",
	cancelled: "border-l-muted-foreground/30 bg-muted/30",
};

const STATUS_LABELS: Record<string, string> = {
	pending: "⏳ Pendiente",
	in_progress: "🔄 En progreso",
	completed: "✅ Completada",
	postponed: "⏰ Pospuesta",
	cancelled: "❌ Cancelada",
};

const PRIORITY_LABELS: Record<string, string> = {
	high: "🔴 Alta",
	medium: "🟡 Media",
	low: "🟢 Baja",
};

export function TaskTable({ tasks }: { tasks: TaskRow[] }) {
	const sorted = [...tasks].sort((a, b) => {
		const pa = PRIORITY_ORDER[a.priority] ?? 1;
		const pb = PRIORITY_ORDER[b.priority] ?? 1;
		return pa - pb;
	});

	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-secondary/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Prioridad</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Vencimiento</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Objetivo</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Creada</th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((task) => {
							const borderColor = STATUS_STYLES[task.status] ?? STATUS_STYLES.pending;
							return (
								<tr
									key={task.id}
									className={`border-b border-border border-l-2 ${borderColor} last:border-b-0 hover:bg-secondary/30`}
								>
									<td className="max-w-xs px-4 py-3">
										<div className="font-medium">{task.title}</div>
										{task.description && (
											<div className="mt-0.5 truncate text-xs text-muted-foreground">
												{task.description}
											</div>
										)}
									</td>
									<td className="px-4 py-3">
										<span className="text-xs">{STATUS_LABELS[task.status] ?? task.status}</span>
									</td>
									<td className="px-4 py-3">
										<span className="text-xs">{PRIORITY_LABELS[task.priority] ?? task.priority}</span>
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{task.dueDate ? new Date(task.dueDate).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">
										{task.objectiveTitle ?? "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{new Date(task.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
