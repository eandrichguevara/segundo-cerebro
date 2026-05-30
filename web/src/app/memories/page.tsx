import { fetchDbData, type MemoryRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function MemoriesPage() {
	let data: MemoryRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<MemoryRow>("memories", { limit: 100 });
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="🧠" title="Memorias" description="Interacciones significativas almacenadas" total={total} />
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">No hay memorias.</p>
			) : (
				<div className="space-y-3">
					{data.map((mem) => {
						const meta = mem.metadata as Record<string, unknown> | null;
						const interactionType = meta?.interaction_type as string | undefined;
						const entitiesRaw = meta?.entities;
						const entities: string[] = Array.isArray(entitiesRaw)
							? entitiesRaw.map((e) => String(e))
							: [];
						return (
							<Card key={mem.id} className="transition-colors hover:border-primary/30">
								<CardContent className="p-4">
									<p className="text-sm italic leading-relaxed text-foreground/90">
										&ldquo;{mem.content}&rdquo;
									</p>
									<div className="mt-3 flex flex-wrap items-center gap-2">
										<span className="text-[10px] text-muted-foreground">
											{new Date(mem.createdAt).toLocaleDateString("es-AR", {
												day: "numeric", month: "short", year: "numeric",
												hour: "2-digit", minute: "2-digit",
											})}
										</span>
										{interactionType && (
											<span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
												{interactionType.replace(/_/g, " ")}
											</span>
										)}
										{entities.map((e, i) => (
											<span
												key={i}
												className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
											>
												{e}
											</span>
										))}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
		</div>
	);
}
