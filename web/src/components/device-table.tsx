import type { DeviceRow } from "@/lib/api";

export function DeviceTable({ devices }: { devices: DeviceRow[] }) {
	return (
		<div className="overflow-hidden rounded-xl border border-border">
			<div className="overflow-x-auto">
				<table className="w-full text-sm">
					<thead>
						<tr className="border-b border-border bg-secondary/50">
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">ID</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Plataforma</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Token FCM</th>
							<th className="px-4 py-3 text-left font-medium text-muted-foreground">Última Actividad</th>
						</tr>
					</thead>
					<tbody>
						{devices.map((device) => {
							return (
								<tr
									key={device.id}
									className="border-b border-border last:border-b-0 hover:bg-secondary/30"
								>
									<td className="px-4 py-3 font-mono text-xs text-muted-foreground">
										{device.id.slice(0, 8)}...
									</td>
									<td className="px-4 py-3">
										<span className="capitalize">{device.platform}</span>
									</td>
									<td className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-muted-foreground">
										{device.fcmToken}
									</td>
									<td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
										{new Date(device.updatedAt).toLocaleString("es-AR")}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
