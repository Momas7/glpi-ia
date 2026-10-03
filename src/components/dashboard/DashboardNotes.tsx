/** Avisos do rodapé do painel: demonstração (quando houver) e o que os números são. */
export function DashboardNotes({ hasDemoData }: { hasDemoData: boolean }) {
  return (
    <div className="flex flex-col gap-2 text-xs text-muted-foreground">
      {hasDemoData && (
        <p role="note" className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-sm text-foreground">
          Dados de demonstração incluídos: parte dos números de satisfação e de IA vem do seed fictício do projeto, não de uso real.
        </p>
      )}
      <p>Custos e acertos são estimativas: o custo vem de uma tabela de preços por modelo; o aceite mostra o que a equipe decidiu.</p>
    </div>
  );
}
