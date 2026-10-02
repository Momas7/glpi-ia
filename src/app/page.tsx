import { LazyBackground } from "@/components/LazyBackground";

export default function Home() {
  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <LazyBackground />
      <h1 className="text-4xl font-semibold tracking-tight">Chamados IA</h1>
      <p className="text-muted-foreground">Sistema de chamados com triagem e sugestões por IA.</p>
    </main>
  );
}
