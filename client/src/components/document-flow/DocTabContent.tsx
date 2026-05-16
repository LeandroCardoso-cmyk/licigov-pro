import { FileText, Upload, Loader2, Lock, Sparkles, RefreshCw, Download, Edit, UploadCloud, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Streamdown } from "streamdown";
import { DocumentEditor } from "@/components/DocumentEditor";
import { CommentsSection } from "@/components/CommentsSection";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { StepBadge } from "./StepBadge";
import type { DocType, StepStatus, ProcessDocument, DocumentActions } from "./types";
import { DOC_LABELS, PREREQUISITES } from "./types";

const formatDate = (date: Date) =>
  new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface DocActionsProps {
  docType: DocType;
  doc: ProcessDocument;
  actions: DocumentActions;
}

function DocActions({ docType, doc, actions }: DocActionsProps) {
  const isGenerating = actions.generatingDoc === docType;
  const isUploading = actions.uploadingDoc === docType;

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => actions.onGenerate(docType)} disabled={isGenerating || isUploading}>
        {isGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
        Regenerar com IA
      </Button>

      <Button variant="outline" size="sm" onClick={() => actions.onUploadClick(docType)} disabled={isGenerating || isUploading}>
        {isUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
        Nova versão
      </Button>

      {doc.content && (
        <>
          <Button variant="outline" size="sm" onClick={() => actions.onDownloadPdf(doc.id)} disabled={actions.downloadingPdf}>
            {actions.downloadingPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => actions.onDownloadDocx(doc.id)} disabled={actions.downloadingDocx}>
            {actions.downloadingDocx ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            DOCX
          </Button>
          <Button variant="outline" size="sm" onClick={() => actions.onEdit(doc.id, doc.content!)}>
            <Edit className="mr-1.5 h-3.5 w-3.5" />
            Editar
          </Button>
        </>
      )}

      {doc.s3Key && (
        <Button variant="outline" size="sm" onClick={() => actions.onDownloadUpload(doc.id)} disabled={actions.downloadingUpload === doc.id}>
          {actions.downloadingUpload === doc.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
          Baixar arquivo
        </Button>
      )}

      <VersionHistoryDialog documentId={doc.id} documentType={docType} />
    </div>
  );
}

interface Props {
  docType: DocType;
  status: StepStatus;
  doc: ProcessDocument | undefined;
  processId: number;
  actions: DocumentActions;
}

export function DocTabContent({ docType, status, doc, processId, actions }: Props) {
  const prereq = PREREQUISITES[docType];
  const info = DOC_LABELS[docType];

  // Locked
  if (status === "locked") {
    const prereqLabel = prereq ? DOC_LABELS[prereq].short : "";
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <Lock className="h-7 w-7 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-foreground mb-1">{info.short} bloqueado</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Complete o <strong>{prereqLabel}</strong> primeiro para liberar esta etapa.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => prereq && actions.onTabChange(prereq)}>
          Ir para {prereqLabel}
          <ChevronRight className="ml-1.5 h-4 w-4" />
        </Button>
      </div>
    );
  }

  // Editing
  if (doc && actions.editingDocumentId === doc.id) {
    return (
      <DocumentEditor
        initialContent={actions.editingContent}
        onSave={actions.onSaveEdit}
        onCancel={actions.onCancelEdit}
        isSaving={actions.updateIsPending}
        autoSave={true}
        onAutoSave={actions.onAutoSave}
      />
    );
  }

  // Document exists
  if (doc) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <StepBadge status={status} />
            <span className="text-xs text-muted-foreground">
              Versão {doc.version} · {formatDate(doc.createdAt)}
            </span>
          </div>
          <DocActions docType={docType} doc={doc} actions={actions} />
        </div>

        {doc.content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Streamdown>{doc.content}</Streamdown>
          </div>
        ) : (
          <div className="flex flex-col items-center py-10 gap-3 text-muted-foreground">
            <UploadCloud className="h-10 w-10 opacity-50" />
            <p className="text-sm">Arquivo enviado via upload</p>
          </div>
        )}

        <CommentsSection documentId={doc.id} processId={processId} />
      </div>
    );
  }

  // Pending
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <FileText className="h-7 w-7 text-primary" />
      </div>
      <div className="max-w-md">
        <p className="font-semibold text-foreground mb-1">{info.long}</p>
        <p className="text-sm text-muted-foreground">{info.description}</p>
      </div>
      <div className="flex gap-3 flex-wrap justify-center">
        <Button onClick={() => actions.onGenerate(docType)} disabled={actions.generatingDoc === docType}>
          {actions.generatingDoc === docType ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Gerar com IA
        </Button>
        <Button variant="outline" onClick={() => actions.onUploadClick(docType)} disabled={actions.uploadingDoc === docType}>
          {actions.uploadingDoc === docType ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Fazer upload
        </Button>
      </div>
    </div>
  );
}
