import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	rewrites: async () => [
		{
			source: "/api/db/:path*",
			destination: `${process.env.API_URL ?? "http://localhost:3000"}/api/db/:path*`,
		},
	],
};

export default nextConfig;
