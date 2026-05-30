import { fetchQuickMemory } from "@/lib/api";
import { StatusHeader } from "@/components/status-header";
import { WhoAmICard } from "@/components/whoami-card";
import { DataClaveGrid } from "@/components/data-clave-grid";
import { TodaySection } from "@/components/today-section";
import { TopicsSection } from "@/components/topics-section";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";

export const dynamic = "force-dynamic";

export default async function Home() {
	let data;
	try {
		data = await fetchQuickMemory();
	} catch (err) {
		const message = err instanceof Error ? err.message : "Error desconocido";
		return <ErrorState message={message} />;
	}

	if (data.status === "empty") {
		return <EmptyState />;
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col px-4 py-10 sm:px-6">
			<StatusHeader updatedAt={data.updated_at} />
			<WhoAmICard content={data.whoAmI} />
			<DataClaveGrid data={data.topData} />
			<TodaySection context={data.todayContext} />
			{data.recentTopics.length > 0 && (
				<TopicsSection topics={data.recentTopics} />
			)}
		</div>
	);
}
