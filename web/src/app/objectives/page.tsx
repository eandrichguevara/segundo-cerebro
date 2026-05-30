import { fetchDbData, type ObjectiveRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { ObjectiveCards } from "@/components/objective-cards";

export const dynamic = "force-dynamic";

export default async function ObjectivesPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;

	let data: ObjectiveRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<ObjectiveRow>("objectives", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="🎯" title="Objetivos" description="Metas a corto, mediano y largo plazo" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/objectives" label="Todos" active={!params.status} />
				<FilterChip href="/objectives?status=active" label="🎯 Activos" active={params.status === "active"} />
				<FilterChip href="/objectives?status=paused" label="⏸️ Pausados" active={params.status === "paused"} />
				<FilterChip href="/objectives?status=completed" label="🏆 Completados" active={params.status === "completed"} />
				<FilterChip href="/objectives?status=cancelled" label="❌ Cancelados" active={params.status === "cancelled"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">No hay objetivos.</p>
			) : (
				<ObjectiveCards objectives={data} />
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
