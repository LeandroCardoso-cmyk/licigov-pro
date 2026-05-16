import { type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  Scale,
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Download,
  BookmarkPlus,
  Shield,
  ShieldCheck,
} from "lucide-react";
import type { LegalOpinion } from "./types";

interface Props {
  opinion: LegalOpinion;
  signatureHistoryData: { id: number }[] | undefined;
  isGenerating: boolean;
  exportPDFPending: boolean;
  exportDOCXPending: boolean;
  updatePending: boolean;
  signPending: boolean;
  onGenerate: () => void;
  onApprove: () => void;
  onSignClick: () => void;
  onExportPDF: () => void;
  onExportDOCX: () => void;
  onSaveAsTemplate: () => void;
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
  isGenerating,
  exportPDFPending,
  exportDOCXPending,
  updatePending,
  signPending,
  onGenerate,
  onApprove,
  onSignClick,
  onExportPDF,
  onExportDOCX,
  onSaveAsTemplate,
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
              </>
            )}

            {!opinion.opinion && (
              <Button onClick={onGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando...</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" />Gerar com IA</>
                )}
              </Button>
            )}

            {opinion.status === "in_review" && (
              <Button onClick={onApprove} disabled={updatePending}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Aprovar
              </Button>
            )}

            {opinion.status === "approved" && !opinion.isTemplate && (
              <Button variant="outline" onClick={onSaveAsTemplate} disabled={updatePending}>
                <BookmarkPlus className="h-4 w-4 mr-2" />
                Salvar como Template
              </Button>
            )}

            {opinion.status === "approved" && opinion.opinion && !fullySignd && (
              <Button variant="default" onClick={onSignClick} disabled={signPending}>
                {signPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
                Assinar Digitalmente
              </Button>
            )}

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
