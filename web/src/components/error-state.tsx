import { Card, CardContent } from "@/components/ui/card";

export function ErrorState({ message }: { message: string }) {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Card className="max-w-md border-destructive/30 text-center">
				<CardContent className="pt-10 pb-10">
					<span className="text-5xl">⚠️</span>
					<h2 className="mt-6 text-xl font-semibold tracking-tight">
						Error de conexión
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						No se pudo conectar con el servidor.
						<br />
						{message}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
