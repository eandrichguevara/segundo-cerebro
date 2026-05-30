export interface QuickMemoryResponse {
	status: "active" | "empty";
	updated_at: string;
	whoAmI: string;
	topData: {
		tasks: string[];
		objectives: string[];
		lists: string[];
		events: string[];
	};
	todayContext: {
		dueToday: string[];
		inProgress: string[];
		recentMentions: string;
	};
	recentTopics: string;
	formattedPrompt: string;
}
