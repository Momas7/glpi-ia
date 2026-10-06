import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { can } from "@/modules/auth";
import { listArticles } from "@/modules/kb";

export const metadata = { title: "Base de conhecimento · Sentinela" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function KbPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (!can(user, "kb:read")) notFound();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim() || undefined;
  const articles = await listArticles(user, { q });
  const manage = can(user, "kb:manage");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Base de conhecimento</h1>
        {manage && (
          <Link href="/kb/new" className={buttonVariants()}>
            Novo artigo
          </Link>
        )}
      </div>
      <form className="flex gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Buscar no título…" aria-label="Buscar artigos" className="max-w-sm" />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Título</TableHead>
            {manage && <TableHead>Estado</TableHead>}
            <TableHead>Atualizado</TableHead>
            <TableHead>Por</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {articles.length === 0 && (
            <TableRow>
              <TableCell colSpan={manage ? 4 : 3} className="text-muted-foreground">
                Nenhum artigo encontrado.
              </TableCell>
            </TableRow>
          )}
          {articles.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link href={`/kb/${a.id}`} className="font-medium hover:underline">
                  {a.title}
                </Link>
              </TableCell>
              {manage && <TableCell>{a.published ? <Badge>Publicado</Badge> : <Badge variant="outline">Rascunho</Badge>}</TableCell>}
              <TableCell>{formatDateTime(a.updatedAt)}</TableCell>
              <TableCell>{a.updatedByName}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
