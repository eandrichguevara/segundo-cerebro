import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export function WhoAmICard({ content }: { content: string }) {
	return (
		<Card className="mb-8 border-purple-500/20 bg-gradient-to-br from-purple-950/30 to-transparent">
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-lg font-semibold">
					<span className="text-xl">💭</span>
					¿Quién soy?
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-sm leading-relaxed text-muted-foreground">{content}</p>
			</CardContent>
		</Card>
	);
}
