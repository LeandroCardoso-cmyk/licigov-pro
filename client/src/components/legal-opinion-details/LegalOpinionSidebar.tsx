import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tag, User, Calendar, CheckCircle2 } from "lucide-react";
import type { LegalOpinion } from "./types";

const SOURCE_LABELS: Record<string, string> = {
  process: "Processo Licitatório",
  direct_contract: "Contratação Direta",
  contract: "Contrato",
  other: "Outro",
};

interface Props {
  opinion: LegalOpinion;
}

export function LegalOpinionSidebar({ opinion }: Props) {
  const articles = Array.isArray(opinion.citedArticles) ? (opinion.citedArticles as string[]) : [];
  const jurisprudences = Array.isArray(opinion.jurisprudence) ? (opinion.jurisprudence as { court: string; number: string; summary: string }[]) : [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Informações</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3">
            <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Tipo</p>
              <p className="text-sm text-muted-foreground">{SOURCE_LABELS[opinion.sourceType] ?? opinion.sourceType}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Solicitado por</p>
              <p className="text-sm text-muted-foreground">Usuário #{opinion.requestedBy}</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Criado em</p>
              <p className="text-sm text-muted-foreground">
                {new Date(opinion.createdAt).toLocaleDateString("pt-BR")}
              </p>
            </div>
          </div>
          {opinion.reviewedAt && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Revisado em</p>
                <p className="text-sm text-muted-foreground">
                  {new Date(opinion.reviewedAt).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {articles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Artigos Citados</CardTitle>
            <CardDescription>Lei 14.133/2021</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {articles.map((article, index) => (
                <Badge key={index} variant="outline">{article}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {jurisprudences.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Jurisprudências</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {jurisprudences.map((juris, index) => (
              <div key={index} className="border-l-2 border-primary pl-3">
                <p className="text-sm font-medium">{juris.court} - {juris.number}</p>
                <p className="text-xs text-muted-foreground mt-1">{juris.summary}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
