import { type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Scale,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  Printer,
  ShieldCheck,
} from "lucide-react";
import type { LegalOpinion } from "./types";

interface Props {
  opinion: LegalOpinion;
  signatureHistoryData: { id: number }[] | undefined;
  exportPDFPending: boolean;
  exportDOCXPending: boolean;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  onPrint?: () => void;
  printPending?: boolean;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Rascunho", variant: "secondary" },
  in_review: { label: "Em Revisão", variant: "default" },
  approved: { label: "Aprovado", variant: "outline" },
  archived: { label: "Arquivado", variant: "destructive" },
};

const CONCLUSION_ICONS: Record<string, ReactElement> = {
  favorable: <CheckCircle2 className="h-5 w-5 text-green-600" />,
  unfavorable: <XCircle className="h-5 w-5 text-red-600" />,
  with_reservations: <AlertCircle className="h-5 w-5 text-yellow-600" />,
};

const CONCLUSION_LABELS: Record<string, string> = {
  favorable: "Favorável",
  unfavorable: "Desfavorável",
  with_reservations: "Com Ressalvas",
};

export function LegalOpinionHeader({
  opinion,
  signatureHistoryData,
  exportPDFPending,
  exportDOCXPending,
  onExportPDF,
  onExportDOCX,
  onPrint,
  printPending,
}: Props) {
  const statusConfig = STATUS_LABELS[opinion.status] ?? { label: opinion.status, variant: "outline" as const };
  const sigCount = signatureHistoryData?.length ?? 0;
  const fullySignd = sigCount >= opinion.requiredSignatures;

  return (
    <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <BackToDashboard />
            <div>
              <Breadcrumbs
                items={[
                  { label: "Parecer Jurídico", href: "/parecer-juridico" },
                  { label: "Detalhes do Parecer" },
                ]}
                className="mb-1"
              />
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Scale className="h-6 w-6 text-primary" />
                {opinion.title}
              </h1>
              <div className="flex items-center gap-3 mt-2">
                <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                {opinion.conclusion && (
                  <div className="flex items-center gap-2">
                    {CONCLUSION_ICONS[opinion.conclusion]}
                    <span className="text-sm font-medium">
                      {CONCLUSION_LABELS[opinion.conclusion] ?? opinion.conclusion}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            {opinion.opinion && (
              <>
                <Button variant="outline" size="sm" onClick={onExportPDF} disabled={exportPDFPending}>
                  {exportPDFPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  PDF
                </Button>
                <Button variant="outline" size="sm" onClick={onExportDOCX} disabled={exportDOCXPending}>
                  {exportDOCXPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                  DOCX
                </Button>
                {onPrint && (
                  <Button variant="outline" size="sm" onClick={onPrint} disabled={printPending}>
                    {printPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
                    Imprimir
                  </Button>
                )}
              </>
            )}

            {/* R2 / PR-03 (LEG-012): parecer LEGADO é somente leitura — gerar com IA, aprovar, salvar como
                template e assinar foram desligados no servidor (LEGACY_ENDPOINT_DISABLED). Novos pareceres
                e toda decisão jurídica seguem no workspace canônico (/parecer). */}
            <Badge variant="outline">Somente leitura (legado)</Badge>

            {sigCount > 0 && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                <ShieldCheck className="h-4 w-4 mr-1" />
                {fullySignd ? "Totalmente Assinado" : `${sigCount}/${opinion.requiredSignatures} Assinaturas`}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
