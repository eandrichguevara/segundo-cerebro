interface SectionHeaderProps {
	icon: string;
	title: string;
	description?: string;
	total?: number;
}

export function SectionHeader({ icon, title, description, total }: SectionHeaderProps) {
	return (
		<div className="mb-8 flex items-start justify-between">
			<div>
				<div className="flex items-center gap-3">
					<span className="text-2xl">{icon}</span>
					<h1 className="text-2xl font-bold tracking-tight">{title}</h1>
				</div>
				{description && (
					<p className="ml-11 mt-1 text-sm text-muted-foreground">{description}</p>
				)}
			</div>
			{total !== undefined && (
				<div className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
					<span className="font-semibold text-foreground">{total}</span>
					total
				</div>
			)}
		</div>
	);
}
