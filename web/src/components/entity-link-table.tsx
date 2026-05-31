import type { EntityLinkRow } from "@/lib/api";

export function EntityLinkTable({ entityLinks }: { entityLinks: EntityLinkRow[] }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-secondary/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Origen</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Relación</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Destino</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Nota</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Creado</th>
						</tr>
					</thead>
					<tbody>
						{entityLinks.map((link) => {
							return (
								<tr
									key={link.id}
									className="border-b border-border last:border-b-0 hover:bg-secondary/30"
								>
									<td className="px-4 py-3">
										<div className="flex flex-col">
											<span className="font-semibold uppercase text-xs text-primary">{link.sourceType}</span>
											<span className="font-mono text-[10px] text-muted-foreground">{link.sourceId}</span>
										</div>
									</td>
									<td className="px-4 py-3">
										<span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">{link.relation}</span>
									</td>
									<td className="px-4 py-3">
										<div className="flex flex-col">
											<span className="font-semibold uppercase text-xs text-primary">{link.targetType}</span>
											<span className="font-mono text-[10px] text-muted-foreground">{link.targetId}</span>
										</div>
									</td>
									<td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground">
										{link.note ?? "—"}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{new Date(link.createdAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
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
