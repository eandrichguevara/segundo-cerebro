import { fetchDbData, type JobRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";

export const dynamic = "force-dynamic";

export default async function JobsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;

	let data: JobRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<JobRow>("jobs", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="⚙️" title="Jobs" description="Cola de procesamiento de la vía lenta" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/jobs" label="Todos" active={!params.status} />
				<FilterChip href="/jobs?status=pending" label="⏳ Pendientes" active={params.status === "pending"} />
				<FilterChip href="/jobs?status=processing" label="🔄 Procesando" active={params.status === "processing"} />
				<FilterChip href="/jobs?status=completed" label="✅ Completados" active={params.status === "completed"} />
				<FilterChip href="/jobs?status=failed" label="❌ Fallidos" active={params.status === "failed"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">No hay jobs.</p>
			) : (
				<div className="overflow-hidden rounded-xl border border-border">
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-border bg-secondary/50">
									<th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
									<th className="px-4 py-3 text-left font-medium text-muted-foreground">Origen</th>
									<th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
									<th className="px-4 py-3 text-left font-medium text-muted-foreground">Intentos</th>
									<th className="px-4 py-3 text-left font-medium text-muted-foreground">Creado</th>
								</tr>
							</thead>
							<tbody>
								{data.map((job) => (
									<tr
										key={job.id}
										className="border-b border-border last:border-b-0 hover:bg-secondary/30"
									>
										<td className="px-4 py-3 font-mono text-xs">{job.type}</td>
										<td className="px-4 py-3 text-xs text-muted-foreground">{job.source}</td>
										<td className="px-4 py-3">
											<StatusBadge status={job.status} />
										</td>
										<td className="px-4 py-3 text-xs text-muted-foreground">
											{job.attempts}/{job.maxAttempts}
										</td>
										<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
											{new Date(job.createdAt).toLocaleDateString("es-AR", {
												day: "numeric", month: "short",
												hour: "2-digit", minute: "2-digit",
											})}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}

function StatusBadge({ status }: { status: string }) {
	const styles: Record<string, string> = {
		pending: "bg-amber-500/20 text-amber-400",
		processing: "bg-blue-500/20 text-blue-400",
		completed: "bg-emerald-500/20 text-emerald-400",
		failed: "bg-rose-500/20 text-rose-400",
	};
	const labels: Record<string, string> = {
		pending: "⏳ Pendiente",
		processing: "🔄 Procesando",
		completed: "✅ Completado",
		failed: "❌ Fallido",
	};
	return (
		<span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? ""}`}>
			{labels[status] ?? status}
		</span>
	);
}

function FilterChip({
	href,
	label,
	active,
}: {
	href: string;
	label: string;
	active: boolean;
}) {
	return (
		<a
			href={href}
			className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition-colors ${
				active
					? "bg-primary text-primary-foreground"
					: "bg-secondary text-muted-foreground hover:bg-secondary/80"
			}`}
		>
			{label}
		</a>
	);
}
