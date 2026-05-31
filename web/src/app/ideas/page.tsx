import { fetchDbData, type IdeaRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { IdeaTable } from "@/components/idea-table";

export const dynamic = "force-dynamic";

export default async function IdeasPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>;
}) {
	const params = await searchParams;
	const queryParams: Record<string, string | number> = { limit: 200 };
	if (params.status) queryParams.status = params.status;

	let data: IdeaRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<IdeaRow>("ideas", queryParams);
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="💡" title="Ideas" description="Todas las ideas registradas" total={total} />
			<div className="mb-4 flex flex-wrap gap-2">
				<FilterChip href="/ideas" label="Todas" active={!params.status} />
				<FilterChip href="/ideas?status=new_idea" label="💡 Nuevas" active={params.status === "new_idea"} />
				<FilterChip href="/ideas?status=evaluating" label="🔍 Evaluando" active={params.status === "evaluating"} />
				<FilterChip href="/ideas?status=approved" label="✅ Aprobadas" active={params.status === "approved"} />
				<FilterChip href="/ideas?status=converted" label="🔄 Convertidas" active={params.status === "converted"} />
				<FilterChip href="/ideas?status=discarded" label="🗑️ Descartadas" active={params.status === "discarded"} />
			</div>
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					No hay ideas{params.status ? ` con estado "${params.status}"` : ""}.
				</p>
			) : (
				<IdeaTable ideas={data} />
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
