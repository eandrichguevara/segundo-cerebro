import type { ProjectRow } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
	active: "border-l-blue-500 bg-blue-500/5",
	paused: "border-l-amber-500 bg-amber-500/5",
	completed: "border-l-emerald-500 bg-emerald-500/5",
	cancelled: "border-l-muted-foreground/30 bg-muted/30",
};

const STATUS_LABELS: Record<string, string> = {
	active: "▶️ Activo",
	paused: "⏸️ Pausado",
	completed: "✅ Completado",
	cancelled: "❌ Cancelado",
};

export function ProjectTable({ projects }: { projects: ProjectRow[] }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-secondary/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoría</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Vencimiento</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Enlaces</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Creado</th>
						</tr>
					</thead>
					<tbody>
						{projects.map((project) => {
							const borderColor = STATUS_STYLES[project.status] ?? STATUS_STYLES.active;
							return (
								<tr
									key={project.id}
									className={`border-b border-border border-l-2 ${borderColor} last:border-b-0 hover:bg-secondary/30`}
								>
									<td className="max-w-xs px-4 py-3">
										<div className="font-medium">{project.title}</div>
										{project.description && (
											<div className="mt-0.5 truncate text-xs text-muted-foreground">
												{project.description}
											</div>
										)}
									</td>
									<td className="px-4 py-3">
										<span className="text-xs">{STATUS_LABELS[project.status] ?? project.status}</span>
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground max-w-[120px] truncate">
										{project.category ?? "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{project.deadline ? new Date(project.deadline).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"}
									</td>
									<td className="px-4 py-3 text-xs">
										{project.links && project.links.length > 0 ? (
											<div className="flex flex-col gap-1">
												{project.links.map((link) => (
													<div key={link.id} className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1 w-max max-w-[200px]">
														<span className="font-semibold uppercase text-[9px] text-primary">{link.linkedType}</span>
														<span className="truncate text-muted-foreground" title={link.linkedTitle}>{link.linkedTitle}</span>
													</div>
												))}
											</div>
										) : "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{new Date(project.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
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
