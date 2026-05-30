import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "Segundo Cerebro — Dashboard",
	description: "Dashboard del asistente personal Segundo Cerebro",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="es"
			className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
		>
			<body className="flex min-h-full">
				<Sidebar />
				<main className="flex-1 overflow-y-auto p-6 sm:p-8 lg:p-10">
					<div className="mx-auto max-w-5xl">{children}</div>
				</main>
			</body>
		</html>
	);
}
