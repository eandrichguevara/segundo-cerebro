import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { QuickMemoryResponse } from "@/types/quick-memory";

export function TodaySection({
	context,
}: {
	context: QuickMemoryResponse["todayContext"];
}) {
	const hasContent =
		context.dueToday.length > 0 ||
		context.inProgress.length > 0 ||
		context.recentMentions.length > 0;

	if (!hasContent) return null;

	return (
		<section className="mb-8">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Hoy
			</h2>
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-lg font-semibold">
						<span className="text-xl">📌</span>
						Resumen del día
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					{context.dueToday.length > 0 && (
						<div className="flex items-start gap-3">
							<span className="mt-0.5 text-base">⏰</span>
							<div>
								<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
									Vence hoy
								</p>
								<ul className="mt-1 space-y-0.5">
									{context.dueToday.map((item, i) => (
										<li key={i} className="text-sm">
											{item}
										</li>
									))}
								</ul>
							</div>
						</div>
					)}
					{context.inProgress.length > 0 && (
						<div className="flex items-start gap-3">
							<span className="mt-0.5 text-base">🔄</span>
							<div>
								<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
									En progreso
								</p>
								<ul className="mt-1 space-y-0.5">
									{context.inProgress.map((item, i) => (
										<li key={i} className="text-sm">
											{item}
										</li>
									))}
								</ul>
							</div>
						</div>
					)}
					{context.recentMentions.length > 0 && (
						<div className="flex items-start gap-3">
							<span className="mt-0.5 text-base">💬</span>
							<div>
								<p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
									Última mención
								</p>
								<p className="mt-1 text-sm italic text-muted-foreground">
									{context.recentMentions}
								</p>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
		</section>
	);
}
