import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText, Clock, Eye, CheckCircle2, XCircle, AlertCircle, BookmarkCheck,
} from "lucide-react";
import type { ReactElement } from "react";

const STATUS_VARIANTS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "secondary" },
  in_review: { label: "Em Revisão", variant: "default" },
  approved: { label: "Aprovado", variant: "outline" },
  archived: { label: "Arquivado", variant: "destructive" },
};

const CONCLUSION_ICONS: Record<string, ReactElement> = {
  favorable: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  unfavorable: <XCircle className="h-4 w-4 text-red-600" />,
  with_reservations: <AlertCircle className="h-4 w-4 text-yellow-600" />,
};

const CONCLUSION_LABELS: Record<string, string> = {
  favorable: "Favorável",
  unfavorable: "Desfavorável",
  with_reservations: "Com Ressalvas",
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  process: "Processo Licitatório",
  direct_contract: "Contratação Direta",
  contract: "Contrato",
  other: "Outro",
};

interface Opinion {
  id: number;
  title: string;
  description?: string | null;
  legalQuestion?: string | null;
  status: string;
  conclusion?: string | null;
  sourceType: string;
  isTemplate?: boolean | null;
  createdAt: string | Date;
}

interface Props {
  opinion: Opinion;
  onClick: () => void;
}

export function LegalOpinionCard({ opinion, onClick }: Props) {
  const statusCfg = STATUS_VARIANTS[opinion.status] ?? { label: opinion.status, variant: "outline" as const };

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={onClick}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg">{opinion.title}</CardTitle>
              {opinion.isTemplate && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                  <BookmarkCheck className="h-3 w-3 mr-1" />
                  Template
                </Badge>
              )}
            </div>
            <CardDescription className="line-clamp-2">
              {opinion.description || opinion.legalQuestion}
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
            {opinion.conclusion && (
              <div className="flex items-center gap-1 text-sm">
                {CONCLUSION_ICONS[opinion.conclusion]}
                <span>{CONCLUSION_LABELS[opinion.conclusion] ?? opinion.conclusion}</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            {SOURCE_TYPE_LABELS[opinion.sourceType] ?? opinion.sourceType}
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            {new Date(opinion.createdAt).toLocaleDateString("pt-BR")}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
          >
            <Eye className="h-4 w-4 mr-2" />
            Ver Detalhes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
