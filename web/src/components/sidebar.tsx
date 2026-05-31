"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
	{ href: "/", label: "Dashboard", icon: "📊" },
	{ href: "/tasks", label: "Tareas", icon: "📋" },
	{ href: "/objectives", label: "Objetivos", icon: "🎯" },
	{ href: "/events", label: "Eventos", icon: "📅" },
	{ href: "/lists", label: "Listas", icon: "📝" },
	{ href: "/memories", label: "Memorias", icon: "🧠" },
	{ href: "/conversations", label: "Conversaciones", icon: "💬" },
	{ href: "/jobs", label: "Jobs", icon: "⚙️" },
	{ href: "/projects", label: "Proyectos", icon: "📁" },
	{ href: "/ideas", label: "Ideas", icon: "💡" },
	{ href: "/devices", label: "Dispositivos", icon: "📱" },
	{ href: "/entity-links", label: "Enlaces", icon: "🔗" },
];

export function Sidebar() {
	const pathname = usePathname();

	return (
		<aside className="flex h-full w-56 flex-col border-r border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-4 py-5">
				<span className="text-xl">🧠</span>
				<div className="flex flex-col leading-tight">
					<span className="text-sm font-bold tracking-tight">Segundo</span>
					<span className="text-sm font-bold tracking-tight">Cerebro</span>
				</div>
			</div>
			<nav className="flex-1 space-y-1 overflow-y-auto p-3">
				{NAV_ITEMS.map((item) => {
					const isActive = item.href === "/"
						? pathname === "/"
						: pathname.startsWith(item.href);
					return (
						<Link
							key={item.href}
							href={item.href}
							className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
								isActive
									? "bg-primary/10 text-primary"
									: "text-muted-foreground hover:bg-secondary hover:text-foreground"
							}`}
						>
							<span className="text-base">{item.icon}</span>
							{item.label}
						</Link>
					);
				})}
			</nav>
			<div className="border-t border-border p-3">
				<p className="text-center text-[10px] text-muted-foreground">
					DB Viewer
				</p>
			</div>
		</aside>
	);
}
