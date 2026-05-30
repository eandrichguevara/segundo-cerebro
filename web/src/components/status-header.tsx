import { Badge } from "@/components/ui/badge";

export function StatusHeader({
	updatedAt,
}: {
	updatedAt: string;
}) {
	const date = new Date(updatedAt);
	const formatted = date.toLocaleString("es-AR", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});

	return (
		<header className="mb-10 flex flex-col gap-1">
			<div className="flex items-center gap-3">
				<span className="text-3xl">🧠</span>
				<h1 className="text-3xl font-bold tracking-tight">Segundo Cerebro</h1>
				<Badge variant="outline" className="ml-auto text-xs font-normal text-muted-foreground">
					{formatted}
				</Badge>
			</div>
			<p className="ml-12 text-sm text-muted-foreground">Memoria Rápida</p>
		</header>
	);
}
