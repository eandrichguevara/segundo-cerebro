import type { IdeaRow } from "@/lib/api";

const STATUS_STYLES: Record<string, string> = {
	new_idea: "border-l-blue-500 bg-blue-500/5",
	evaluating: "border-l-amber-500 bg-amber-500/5",
	approved: "border-l-emerald-500 bg-emerald-500/5",
	discarded: "border-l-red-500 bg-red-500/5",
	converted: "border-l-purple-500 bg-purple-500/5",
};

const STATUS_LABELS: Record<string, string> = {
	new_idea: "💡 Nueva",
	evaluating: "🔍 Evaluando",
	approved: "✅ Aprobada",
	discarded: "🗑️ Descartada",
	converted: "🔄 Convertida",
};

export function IdeaTable({ ideas }: { ideas: IdeaRow[] }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-secondary/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Tags</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Enlaces</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Creada</th>
						</tr>
					</thead>
					<tbody>
						{ideas.map((idea) => {
							const borderColor = STATUS_STYLES[idea.status] ?? STATUS_STYLES.new_idea;
							return (
								<tr
									key={idea.id}
									className={`border-b border-border border-l-2 ${borderColor} last:border-b-0 hover:bg-secondary/30`}
								>
									<td className="max-w-xs px-4 py-3">
										<div className="font-medium">{idea.title}</div>
										{idea.description && (
											<div className="mt-0.5 truncate text-xs text-muted-foreground">
												{idea.description}
											</div>
										)}
									</td>
									<td className="px-4 py-3">
										<span className="text-xs">{STATUS_LABELS[idea.status] ?? idea.status}</span>
									</td>
									<td className="px-4 py-3 text-xs">
										{idea.tags && idea.tags.length > 0 ? (
											<div className="flex flex-wrap gap-1">
												{idea.tags.map((tag) => (
													<span key={tag} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
														{tag}
													</span>
												))}
											</div>
										) : "—"}
									</td>
									<td className="px-4 py-3 text-xs">
										{idea.links && idea.links.length > 0 ? (
											<div className="flex flex-col gap-1">
												{idea.links.map((link) => (
													<div key={link.id} className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2 py-1 w-max max-w-[200px]">
														<span className="font-semibold uppercase text-[9px] text-primary">{link.linkedType}</span>
														<span className="truncate text-muted-foreground" title={link.linkedTitle}>{link.linkedTitle}</span>
													</div>
												))}
											</div>
										) : "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{new Date(idea.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
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
