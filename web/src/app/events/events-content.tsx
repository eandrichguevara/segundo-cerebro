"use client";

import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/section-header";
import { EventTimeline } from "@/components/event-timeline";
import type { EventRow } from "@/lib/api";

export function EventsContent() {
	const [past, setPast] = useState(false);
	const [data, setData] = useState<EventRow[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		const params = new URLSearchParams({ days: "30", limit: "200" });
		if (past) params.set("past", "true");

		fetch(`/api/db/events?${params}`)
			.then((res) => {
				if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
				return res.json();
			})
			.then((json) => {
				if (!cancelled) {
					setData(json.data);
					setTotal(json.total);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setData([]);
					setTotal(0);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [past]);

	const description = past
		? "Eventos pasados (30 días)"
		: "Eventos próximos (30 días)";

	return (
		<div>
			<div className="mb-6 flex items-center justify-between">
				<SectionHeader
					icon="📅"
					title="Eventos"
					description={description}
					total={total}
				/>
				<div className="flex gap-1 rounded-lg bg-secondary p-1 text-sm">
					<button
						type="button"
						onClick={() => setPast(false)}
						className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
							!past
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						Próximos
					</button>
					<button
						type="button"
						onClick={() => setPast(true)}
						className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
							past
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground"
						}`}
					>
						Pasados
					</button>
				</div>
			</div>
			{loading ? (
				<div className="flex items-center justify-center py-16">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
				</div>
			) : data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					{past
						? "No hay eventos en el último mes."
						: "No hay eventos próximos."}
				</p>
			) : (
				<EventTimeline events={data} />
			)}
		</div>
	);
}
