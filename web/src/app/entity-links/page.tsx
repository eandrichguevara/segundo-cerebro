import { fetchDbData, type EntityLinkRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { EntityLinkTable } from "@/components/entity-link-table";

export const dynamic = "force-dynamic";

export default async function EntityLinksPage() {
	let data: EntityLinkRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<EntityLinkRow>("entity-links", { limit: 200 });
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="🔗" title="Enlaces de Entidades" description="Todas las relaciones entre entidades en el sistema" total={total} />
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					No hay enlaces.
				</p>
			) : (
				<EntityLinkTable entityLinks={data} />
			)}
		</div>
	);
}
