import { fetchDbData, type ListRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { ListCards } from "@/components/list-cards";

export const dynamic = "force-dynamic";

export default async function ListsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;

	let data: ListRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<ListRow>("lists", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="📝" title="Listas" description="Listas de compras, ingredientes y más" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/lists" label="Todas" active={!params.status} />
				<FilterChip href="/lists?status=active" label="📋 Activas" active={params.status === "active"} />
				<FilterChip href="/lists?status=completed" label="✅ Completadas" active={params.status === "completed"} />
				<FilterChip href="/lists?status=cancelled" label="❌ Canceladas" active={params.status === "cancelled"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">No hay listas.</p>
			) : (
				<ListCards lists={data} />
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
