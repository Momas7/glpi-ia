import { LazyBackground } from "@/components/LazyBackground";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex flex-1 items-center justify-center p-6">
      <LazyBackground />
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-background/80 p-6 shadow-xl backdrop-blur">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Chamados IA</h1>
        {children}
      </div>
    </main>
  );
}
