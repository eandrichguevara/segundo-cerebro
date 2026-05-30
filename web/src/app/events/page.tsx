import { fetchDbData, type EventRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { EventTimeline } from "@/components/event-timeline";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
	let data: EventRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<EventRow>("events", { days: 30, limit: 200 });
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="📅" title="Eventos" description="Eventos próximos (30 días)" total={total} />
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">No hay eventos próximos.</p>
			) : (
				<EventTimeline events={data} />
			)}
		</div>
	);
}
