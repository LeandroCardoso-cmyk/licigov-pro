import { useState } from "react";
import { Link } from "wouter";
import { LibraryBig, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { PageShell } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageLoader } from "@/components/ui/PageLoader";
import { DOCUMENT_KIND_LABEL, hasRoleAtLeast } from "@/lib/institutionalTemplatesView";

/**
 * Modelos Institucionais — lista. DISTINTO do menu "Templates" pessoal legado (que continua inalterado).
 * Módulo atrás de flag tenant-scoped: sem a flag, só uma explicação (a superfície não é exposta).
 */
export default function InstitutionalTemplates() {
  const utils = trpc.useUtils();
  const caps = trpc.institutionalTemplates.getCapabilities.useQuery();
  const enabled = caps.data?.enabled === true;
  const list = trpc.institutionalTemplates.identities.list.useQuery({}, { enabled });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("tr");
  const [slug, setSlug] = useState("");

  const create = trpc.institutionalTemplates.identities.create.useMutation({
    onSuccess: () => { toast.success("Modelo criado. Crie ou importe a primeira revisão (rascunho)."); utils.institutionalTemplates.identities.list.invalidate(); setOpen(false); setSlug(""); },
    onError: (e) => toast.error(e.message),
  });

  const canCreate = hasRoleAtLeast(caps.data?.role, caps.data?.roleFloors?.draft);

  return (
    <PageShell
      icon={LibraryBig}
      breadcrumbs={[{ label: "Modelos Institucionais" }]}
      title="Modelos Institucionais"
      description="Modelos documentais da organização, com revisões aprovadas e publicadas por decisão humana. Diferente dos templates pessoais."
      actions={enabled && canCreate ? <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Novo modelo</Button> : undefined}
    >
      {caps.isLoading ? <PageLoader /> : !enabled ? (
        <Card>
          <CardHeader><CardTitle>Módulo não habilitado</CardTitle><CardDescription>
            {caps.data?.portsConfigured === false
              ? "O módulo de Modelos Institucionais ainda não está integrado nesta instalação."
              : "Os Modelos Institucionais não estão habilitados para a sua organização. Fale com o administrador."}
          </CardDescription></CardHeader>
        </Card>
      ) : list.isLoading ? <PageLoader /> : (list.data?.length ?? 0) === 0 ? (
        <EmptyState icon={LibraryBig} title="Nenhum modelo institucional" description="Crie um modelo e, em seguida, a primeira revisão (rascunho) ou importe um arquivo Markdown/DOCX."
          action={canCreate ? { label: "Novo modelo", onClick: () => setOpen(true) } : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data!.map((s) => (
            <Card key={s.identity.id}>
              <CardHeader>
                <CardTitle className="text-base">{s.identity.slug}</CardTitle>
                <CardDescription>{DOCUMENT_KIND_LABEL[s.identity.documentKind] ?? s.identity.documentKind}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{s.revisionCount} revisão(ões): {s.statusCounts.DRAFT} rascunho · {s.statusCounts.APPROVED} aprovada(s) · {s.statusCounts.PUBLISHED} publicada(s) · {s.statusCounts.DEPRECATED} depreciada(s)</p>
                <p className="text-muted-foreground">
                  {s.publishedRevisions.length ? `Publicadas: ${s.publishedRevisions.map((r) => `Revisão ${r.revision}`).join(", ")}` : "Nenhuma revisão publicada"} · {s.activeBindingCount} vínculo(s) ativo(s)
                </p>
                <Link href={`/modelos-institucionais/${s.identity.id}`}><Button size="sm" variant="outline">Abrir</Button></Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo modelo institucional</DialogTitle><DialogDescription>Escolha o tipo de documento e um identificador (slug) único dentro da organização.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tpl-kind">Tipo de documento</Label>
              <select id="tpl-kind" className="w-full rounded-md border bg-background p-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
                {(caps.data?.documentKinds ?? []).map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k] ?? k}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-slug">Identificador (slug)</Label>
              <Input id="tpl-slug" value={slug} placeholder="ex.: tr-servicos-continuos" onChange={(e) => setSlug(e.target.value)} />
              <p className="text-xs text-muted-foreground">Minúsculas, números e hífens.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={create.isPending || !slug.trim()} onClick={() => create.mutate({ documentKind: kind as never, slug: slug.trim() })}>Criar modelo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

