import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function useDocumentDownload() {
  const [downloadingUpload, setDownloadingUpload] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const downloadUploaded = async (documentId: number) => {
    setDownloadingUpload(documentId);
    try {
      const result = await utils.documents.getDownloadUrl.fetch({ documentId });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Erro ao gerar link de download. Tente novamente.");
    } finally {
      setDownloadingUpload(null);
    }
  };

  return { downloadingUpload, downloadUploaded };
}
