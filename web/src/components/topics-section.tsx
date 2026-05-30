import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export function TopicsSection({ topics }: { topics: string }) {
	const tags = topics
		.split(/[,;.\n]+/)
		.map((t) => t.trim())
		.filter(Boolean);

	if (tags.length === 0) return null;

	return (
		<section>
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Temas recientes
			</h2>
			<Card>
				<CardHeader className="pb-3">
					<CardTitle className="flex items-center gap-2 text-lg font-semibold">
						<span className="text-xl">🔥</span>
						En conversación
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-2">
						{tags.map((tag, i) => (
							<Badge
								key={i}
								variant="secondary"
								className="rounded-full px-3 py-1 text-xs font-normal"
							>
								{tag}
							</Badge>
						))}
					</div>
				</CardContent>
			</Card>
		</section>
	);
}
