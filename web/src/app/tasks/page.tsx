import { fetchDbData, type TaskRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { TaskTable } from "@/components/task-table";

export const dynamic = "force-dynamic";

export default async function TasksPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string; priority?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;
	if (params.priority) queryParams.priority = params.priority;

	let data: TaskRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<TaskRow>("tasks", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="📋" title="Tareas" description="Todas las tareas registradas" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/tasks" label="Todas" active={!params.status && !params.priority} />
				<FilterChip href="/tasks?status=pending" label="⏳ Pendientes" active={params.status === "pending"} />
				<FilterChip href="/tasks?status=in_progress" label="🔄 En progreso" active={params.status === "in_progress"} />
				<FilterChip href="/tasks?status=completed" label="✅ Completadas" active={params.status === "completed"} />
				<FilterChip href="/tasks?status=postponed" label="⏰ Pospuestas" active={params.status === "postponed"} />
				<FilterChip href="/tasks?status=cancelled" label="❌ Canceladas" active={params.status === "cancelled"} />
				<FilterChip href="/tasks?priority=high" label="🔴 Alta" active={params.priority === "high"} />
				<FilterChip href="/tasks?priority=medium" label="🟡 Media" active={params.priority === "medium"} />
				<FilterChip href="/tasks?priority=low" label="🟢 Baja" active={params.priority === "low"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					No hay tareas{params.status ? ` con estado "${params.status}"` : ""}.
				</p>
			) : (
				<TaskTable tasks={data} />
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
