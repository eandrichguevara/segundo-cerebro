import type { ObjectiveRow } from "@/lib/api";

const STATUS_STYLES: Record<string, { border: string; bg: string; label: string }> = {
	active: { border: "border-l-emerald-500", bg: "bg-emerald-500/5", label: "🎯 Activo" },
	paused: { border: "border-l-amber-500", bg: "bg-amber-500/5", label: "⏸️ Pausado" },
	completed: { border: "border-l-blue-500", bg: "bg-blue-500/5", label: "🏆 Completado" },
	cancelled: { border: "border-l-muted-foreground/30", bg: "bg-muted/30", label: "❌ Cancelado" },
};

export function ObjectiveCards({ objectives }: { objectives: ObjectiveRow[] }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{objectives.map((obj) => {
				const style = STATUS_STYLES[obj.status] ?? STATUS_STYLES.active;
				const progress = obj.taskCount > 0 ? Math.round((obj.completedTasks / obj.taskCount) * 100) : 0;
				return (
					<div
						key={obj.id}
						className={`rounded-xl border border-border border-l-4 ${style.border} ${style.bg} p-5 transition-colors hover:border-l-primary`}
					>
						<div className="flex items-start justify-between gap-2">
							<div className="min-w-0 flex-1">
								<h3 className="truncate font-semibold">{obj.title}</h3>
								{obj.description && (
									<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{obj.description}</p>
								)}
							</div>
							<span className="shrink-0 text-xs">{style.label}</span>
						</div>

						{obj.deadline && (
							<p className="mt-3 text-xs text-muted-foreground">
								📅 Vence: {new Date(obj.deadline).toLocaleDateString("es-AR", {
									day: "numeric", month: "long", year: "numeric",
								})}
							</p>
						)}

						<div className="mt-4">
							<div className="flex items-center justify-between text-xs text-muted-foreground">
								<span>{obj.completedTasks} / {obj.taskCount} tareas</span>
								<span>{progress}%</span>
							</div>
							<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
								<div
									className="h-full rounded-full bg-primary transition-all"
									style={{ width: `${progress}%` }}
								/>
							</div>
						</div>

						{obj.links && obj.links.length > 0 && (
							<div className="mt-4 flex flex-wrap gap-1 border-t border-border pt-3">
								{obj.links.map((link) => (
									<div key={link.id} className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1">
										<span className="font-semibold uppercase text-[9px] text-primary">{link.linkedType}</span>
										<span className="truncate text-xs text-muted-foreground" title={link.linkedTitle}>{link.linkedTitle}</span>
									</div>
								))}
							</div>
						)}

						<p className="mt-3 text-[10px] text-muted-foreground/60">
							Creado {new Date(obj.createdAt).toLocaleDateString("es-AR", {
								day: "numeric", month: "short",
							})}
						</p>
					</div>
				);
			})}
		</div>
	);
}
