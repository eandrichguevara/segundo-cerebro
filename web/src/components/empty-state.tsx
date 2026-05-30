import { Card, CardContent } from "@/components/ui/card";

export function EmptyState() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Card className="max-w-md border-dashed text-center">
				<CardContent className="pt-10 pb-10">
					<span className="text-5xl">🧠</span>
					<h2 className="mt-6 text-xl font-semibold tracking-tight">
						Memoria vacía
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						La memoria rápida aún no ha sido inicializada.
						<br />
						Interactuá con el asistente de voz para empezar a generar datos.
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
