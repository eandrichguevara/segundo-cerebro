import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

const ENTITY_CONFIG: Record<string, { icon: string; label: string; href: string; color: string }> = {
	tasks: { icon: "📋", label: "Tareas", href: "/tasks", color: "border-l-purple-500" },
	objectives: { icon: "🎯", label: "Objetivos", href: "/objectives", color: "border-l-emerald-500" },
	events: { icon: "📅", label: "Eventos", href: "/events", color: "border-l-blue-500" },
	lists: { icon: "📝", label: "Listas", href: "/lists", color: "border-l-amber-500" },
	memories: { icon: "🧠", label: "Memorias", href: "/memories", color: "border-l-rose-500" },
	conversations: { icon: "💬", label: "Conversaciones", href: "/conversations", color: "border-l-cyan-500" },
	jobs: { icon: "⚙️", label: "Jobs", href: "/jobs", color: "border-l-slate-500" },
	projects: { icon: "📁", label: "Proyectos", href: "/projects", color: "border-l-indigo-500" },
	ideas: { icon: "💡", label: "Ideas", href: "/ideas", color: "border-l-yellow-500" },
	devices: { icon: "📱", label: "Dispositivos", href: "/devices", color: "border-l-teal-500" },
	"entity-links": { icon: "🔗", label: "Enlaces", href: "/entity-links", color: "border-l-fuchsia-500" },
};

export function SummaryCards({ counts }: { counts: Record<string, number> }) {
	const entries = Object.entries(ENTITY_CONFIG).filter(([key]) => counts[key] !== undefined);
	if (entries.length === 0) return null;

	return (
		<section className="mb-8">
			<h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
				Base de datos
			</h2>
			<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{entries.map(([key, config]) => {
					const count = counts[key] ?? 0;
					return (
						<Link key={key} href={config.href}>
							<Card className={`border-l-4 ${config.color} transition-colors hover:border-l-primary`}>
								<CardContent className="p-4">
									<div className="flex items-center justify-between">
										<span className="text-lg">{config.icon}</span>
										<p className="text-xl font-bold tabular-nums tracking-tight">
											{count}
										</p>
									</div>
									<p className="mt-1 text-xs text-muted-foreground">{config.label}</p>
								</CardContent>
							</Card>
						</Link>
					);
				})}
			</div>
		</section>
	);
}
