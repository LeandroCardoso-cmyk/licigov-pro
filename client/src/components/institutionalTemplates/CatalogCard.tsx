import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  BINDING_HEALTH_LABEL, BINDING_STATUS_LABEL, DISPLAY_NAME_SOURCE_LABEL, DOCUMENT_KIND_LABEL, pinnedRevisionLabel, scopeLabel, STATUS_LABEL, STATUS_TONE,
  type CatalogRowView,
} from "@/lib/institutionalTemplatesView";

/**
 * Um modelo do catálogo multi-modelo. Mostra nome de exibição (e a origem do nome), slug, tipo, revisões com status, a
 * aplicabilidade EXPLÍCITA de cada vínculo, a saúde do vínculo e a revisão EXATA fixada — nunca "a última".
 */
export function CatalogCard({ row }: { row: CatalogRowView }) {
  const status = BINDING_STATUS_LABEL[row.bindingStatus];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{row.displayName}</CardTitle>
        <CardDescription>
          <span className="font-mono text-xs">{row.slug}</span> · {DOCUMENT_KIND_LABEL[row.documentKind] ?? row.documentKind}
          {row.templateKey ? <> · <span className="font-mono text-xs">{row.templateKey}</span></> : null}
        </CardDescription>
        <p className="text-xs text-muted-foreground">Nome: {DISPLAY_NAME_SOURCE_LABEL[row.displayNameSource]}</p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="font-medium" data-testid="catalog-headline">{row.headline}</p>
        <div className="flex flex-wrap gap-1" aria-label="Revisões">
          {row.revisions.length === 0 ? <span className="text-muted-foreground">Sem revisões</span> : row.revisions.map((r) => (
            <StatusBadge key={r.id} label={`Rev. ${r.revision} · ${STATUS_LABEL[r.status]}`} tone={STATUS_TONE[r.status]} />
          ))}
        </div>
        <div>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
        {row.bindings.length > 0 ? (
          <ul className="space-y-2" aria-label="Aplicabilidade e vínculos">
            {row.bindings.map((b) => {
              const h = BINDING_HEALTH_LABEL[b.health];
              return (
                <li key={b.bindingId} className="rounded-md border p-2">
                  <p>{b.scopeHeadline}</p>
                  <p className="text-xs text-muted-foreground">{scopeLabel(b.scope)}</p>
                  <p className="text-xs">Revisão exata fixada: <span className="font-medium">{pinnedRevisionLabel(b)}</span> · {b.active ? "ativo" : "inativo"} · desde {b.effectiveFrom}</p>
                  {b.active && <StatusBadge label={h.label} tone={h.tone} />}
                </li>
              );
            })}
          </ul>
        ) : <p className="text-muted-foreground">Nenhum vínculo: este modelo só é usado em geração depois de uma revisão PUBLICADA ser vinculada a um escopo explícito.</p>}
        <Link href={`/modelos-institucionais/${row.identityId}`}><Button size="sm" variant="outline">Abrir</Button></Link>
      </CardContent>
    </Card>
  );
}
