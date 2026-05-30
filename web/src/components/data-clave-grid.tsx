import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { QuickMemoryResponse } from "@/types/quick-memory";

const SLOTS: {
	key: keyof QuickMemoryResponse["topData"];
	icon: string;
	label: string;
}[] = [
	{ key: "tasks", icon: "📋", label: "Tareas" },
	{ key: "objectives", icon: "🎯", label: "Objetivos" },
	{ key: "lists", icon: "📝", label: "Listas" },
	{ key: "events", icon: "📅", label: "Eventos" },
];

export function DataClaveGrid({
	data,
}: {
	data: QuickMemoryResponse["topData"];
}) {
	return (
		<section className="mb-8">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Data clave
			</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{SLOTS.map((slot) => {
					const items = data[slot.key];
					return (
						<Card key={slot.key} className="transition-colors hover:border-purple-500/30">
							<CardHeader className="pb-2 pt-4">
								<CardTitle className="flex items-center gap-2 text-sm font-medium">
									<span className="text-lg">{slot.icon}</span>
									{slot.label}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-2xl font-bold tabular-nums tracking-tight">
									{items.length}
								</p>
								<p className="mt-0.5 text-xs text-muted-foreground">
									{items.length === 1 ? "item" : "items"}
								</p>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</section>
	);
}
