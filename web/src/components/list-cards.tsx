"use client";

import { useState } from "react";
import type { ListRow } from "@/lib/api";

const STATUS_STYLES: Record<string, { border: string; label: string }> = {
	active: { border: "border-l-emerald-500", label: "📋 Activa" },
	completed: { border: "border-l-blue-500", label: "✅ Completada" },
	cancelled: { border: "border-l-muted-foreground/30", label: "❌ Cancelada" },
};

const TYPE_ICONS: Record<string, string> = {
	shopping: "🛒",
	ingredients: "🧑‍🍳",
	general: "📋",
};

export function ListCards({ lists }: { lists: ListRow[] }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{lists.map((list) => {
				const style = STATUS_STYLES[list.status] ?? STATUS_STYLES.active;
				const checkedCount = list.items.filter((i: { checked: boolean }) => i.checked).length;
				const typeIcon = TYPE_ICONS[list.type] ?? "📋";
				return (
					<ListCard
						key={list.id}
						list={list}
						style={style}
						typeIcon={typeIcon}
						checkedCount={checkedCount}
					/>
				);
			})}
		</div>
	);
}

function ListCard({
	list,
	style,
	typeIcon,
	checkedCount,
}: {
	list: ListRow;
	style: { border: string; label: string };
	typeIcon: string;
	checkedCount: number;
}) {
	const [expanded, setExpanded] = useState(false);
	const progress = list.items.length > 0 ? Math.round((checkedCount / list.items.length) * 100) : 0;

	return (
		<div
			className={`rounded-xl border border-border border-l-4 ${style.border} bg-card p-5 transition-colors hover:border-l-primary`}
		>
			<button
				type="button"
				className="flex w-full items-start justify-between gap-2 text-left"
				onClick={() => setExpanded(!expanded)}
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span>{typeIcon}</span>
						<h3 className="truncate font-semibold">{list.title}</h3>
					</div>
					{list.description && (
						<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{list.description}</p>
					)}
				</div>
				<span className="shrink-0 text-xs">{style.label}</span>
			</button>

			{list.items.length > 0 && (
				<>
					<div className="mt-4">
						<div className="flex items-center justify-between text-xs text-muted-foreground">
							<span>{checkedCount} / {list.items.length} items</span>
							<span>{progress}%</span>
						</div>
						<div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
							<div
								className="h-full rounded-full bg-primary transition-all"
								style={{ width: `${progress}%` }}
							/>
						</div>
					</div>

					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="mt-3 text-xs text-muted-foreground hover:text-foreground"
					>
						{expanded ? "▲ Ocultar items" : `▼ ${list.items.length} items`}
					</button>

					{expanded && (
						<ul className="mt-3 space-y-1 border-t border-border pt-3">
							{list.items.map((item: { content: string; quantity?: string; checked: boolean }, i: number) => (
								<li key={i} className="flex items-center gap-2 text-sm">
									<span>{item.checked ? "☑" : "☐"}</span>
									<span className={item.checked ? "text-muted-foreground line-through" : ""}>
										{item.content}
									</span>
									{item.quantity && (
										<span className="text-xs text-muted-foreground">({item.quantity})</span>
									)}
								</li>
							))}
						</ul>
					)}
				</>
			)}

			<p className="mt-3 text-[10px] text-muted-foreground/60">
				{list.type} — creado {new Date(list.createdAt).toLocaleDateString("es-AR", {
					day: "numeric", month: "short",
				})}
			</p>
		</div>
	);
}
