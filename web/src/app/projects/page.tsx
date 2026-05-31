import { fetchDbData, type ProjectRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { ProjectTable } from "@/components/project-table";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;

	let data: ProjectRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<ProjectRow>("projects", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="📁" title="Proyectos" description="Todos los proyectos registrados" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/projects" label="Todos" active={!params.status} />
				<FilterChip href="/projects?status=active" label="▶️ Activos" active={params.status === "active"} />
				<FilterChip href="/projects?status=paused" label="⏸️ Pausados" active={params.status === "paused"} />
				<FilterChip href="/projects?status=completed" label="✅ Completados" active={params.status === "completed"} />
				<FilterChip href="/projects?status=cancelled" label="❌ Cancelados" active={params.status === "cancelled"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					No hay proyectos{params.status ? ` con estado "${params.status}"` : ""}.
				</p>
			) : (
				<ProjectTable projects={data} />
			)}
		</div>
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
