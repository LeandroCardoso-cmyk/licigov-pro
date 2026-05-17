import { useState, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useDocumentDownload } from "./useDocumentDownload";
import type { DocType } from "@/components/document-flow/types";

interface Options {
  processId: number;
  invalidate: () => void;
  setActiveTab: (docType: DocType) => void;
  getContractFilenameHint?: () => string;
}

export function useProcessDocuments({ processId, invalidate, setActiveTab }: Options) {
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [generatingDoc, setGeneratingDoc] = useState<DocType | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const { downloadingUpload, downloadUploaded } = useDocumentDownload();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadDocType = useRef<DocType | null>(null);

  const generateDocumentMutation = trpc.documents.generateDocument.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.docType.toUpperCase()} gerado com sucesso!`);
      setGeneratingDoc(null);
      setActiveTab(data.docType as DocType);
      invalidate();
    },
    onError: (err) => {
      toast.error("Erro ao gerar documento", { description: err.message });
      setGeneratingDoc(null);
    },
  });

  const uploadDocumentMutation = trpc.documents.uploadDocument.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.docType.toUpperCase()} enviado com sucesso!`);
      setUploadingDoc(null);
      setActiveTab(data.docType as DocType);
      invalidate();
    },
    onError: (err) => {
      toast.error("Erro ao enviar documento", { description: err.message });
      setUploadingDoc(null);
    },
  });

  const updateDocumentMutation = trpc.documents.updateDocument.useMutation({
    onSuccess: (data) => {
      toast.success("Documento atualizado!", { description: `Versão ${data.version} salva.` });
      setEditingDocumentId(null);
      setEditingContent("");
      invalidate();
    },
  });

  const downloadPdfMutation = trpc.documents.downloadPdf.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: data.filename }).click();
      URL.revokeObjectURL(url);
      toast.success("PDF baixado!");
      setDownloadingPdf(false);
    },
    onError: () => setDownloadingPdf(false),
  });

  const downloadDocxMutation = trpc.documents.downloadDocx.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: data.filename }).click();
      URL.revokeObjectURL(url);
      toast.success("DOCX baixado!");
      setDownloadingDocx(false);
    },
    onError: () => setDownloadingDocx(false),
  });

  const handleGenerate = (docType: DocType) => {
    setGeneratingDoc(docType);
    generateDocumentMutation.mutate({ processId, docType });
  };

  const handleUploadClick = (docType: DocType) => {
    pendingUploadDocType.current = docType;
    uploadInputRef.current?.click();
  };

  const ALLOWED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "text/plain",
  ] as const;
  type AllowedMime = typeof ALLOWED_MIME_TYPES[number];

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docType = pendingUploadDocType.current;
    if (!file || !docType) return;
    e.target.value = "";

    if (!ALLOWED_MIME_TYPES.includes(file.type as AllowedMime)) {
      toast.error("Tipo de arquivo não permitido", { description: "Use PDF, DOCX ou TXT." });
      return;
    }

    setUploadingDoc(docType);
    const reader = new FileReader();
    reader.onload = () => {
      uploadDocumentMutation.mutate({
        processId,
        docType,
        fileName: file.name,
        fileBase64: (reader.result as string).split(",")[1],
        mimeType: file.type as AllowedMime,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = (content: string) => {
    if (editingDocumentId) updateDocumentMutation.mutate({ documentId: editingDocumentId, content });
  };

  const handleAutoSave = async (content: string) => {
    if (!editingDocumentId) return;
    try {
      await updateDocumentMutation.mutateAsync({ documentId: editingDocumentId, content });
      setEditingContent(content);
    } catch {}
  };

  return {
    // state
    editingDocumentId,
    editingContent,
    generatingDoc,
    uploadingDoc,
    downloadingPdf,
    downloadingDocx,
    downloadingUpload,
    uploadInputRef,
    updateIsPending: updateDocumentMutation.isPending,
    // handlers
    handleGenerate,
    handleUploadClick,
    handleFileSelected,
    handleSaveEdit,
    handleAutoSave,
    handleDownloadPdf: (docId: number) => {
      setDownloadingPdf(true);
      downloadPdfMutation.mutate({ documentId: docId });
    },
    handleDownloadDocx: (docId: number) => {
      setDownloadingDocx(true);
      downloadDocxMutation.mutate({ documentId: docId });
    },
    handleDownloadUpload: downloadUploaded,
    handleCancelEdit: () => {
      setEditingDocumentId(null);
      setEditingContent("");
    },
    handleStartEdit: (docId: number, content: string) => {
      setEditingDocumentId(docId);
      setEditingContent(content);
    },
  };
}
