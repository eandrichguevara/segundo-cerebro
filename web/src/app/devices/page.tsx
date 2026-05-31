import { fetchDbData, type DeviceRow } from "@/lib/api";
import { SectionHeader } from "@/components/section-header";
import { DeviceTable } from "@/components/device-table";

export const dynamic = "force-dynamic";

export default async function DevicesPage() {
	let data: DeviceRow[] = [];
	let total = 0;
	try {
		const res = await fetchDbData<DeviceRow>("devices", { limit: 200 });
		data = res.data;
		total = res.total;
	} catch {
		// data stays empty
	}

	return (
		<div>
			<SectionHeader icon="📱" title="Dispositivos" description="Todos los dispositivos registrados" total={total} />
			{data.length === 0 ? (
				<p className="py-12 text-center text-sm text-muted-foreground">
					No hay dispositivos.
				</p>
			) : (
				<DeviceTable devices={data} />
			)}
		</div>
	);
}
