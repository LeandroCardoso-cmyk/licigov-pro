import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paperclip, Download, Trash2, Upload } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Attachment {
  id: number;
  fileName: string;
  /** PROMPT 08 / D-3 — o servidor não expõe URL; `false` = anexo antigo sem referência de armazenamento reconhecível. */
  downloadable: boolean;
  fileSize?: number | null;
  uploadedAt?: Date | string | null;
}

interface Props {
  attachments: Attachment[];
  uploadingFile: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (id: number) => void;
  /** PROMPT 08 / D-3 — pede URL ASSINADA de curta duração (bucket privado) e abre o download. */
  onDownload: (id: number) => void;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export function TaskAttachments({ attachments, uploadingFile, onFileChange, onDelete, onDownload }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Paperclip className="h-4 w-4" />
          Anexos ({attachments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {attachments.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
            <div className="flex items-center gap-3">
              <Paperclip className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{a.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(a.fileSize ?? 0)}
                  {a.uploadedAt && <> • {formatDistanceToNow(new Date(a.uploadedAt), { addSuffix: true, locale: ptBR })}</>}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={!a.downloadable} title={a.downloadable ? "Baixar" : "Anexo antigo sem referência de armazenamento"} onClick={() => onDownload(a.id)}>
                <Download className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onDelete(a.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        <div className="pt-2">
          <Button variant="outline" size="sm" disabled={uploadingFile} onClick={() => document.getElementById("task-file-upload")?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            {uploadingFile ? "Enviando..." : "Adicionar Anexo"}
          </Button>
          <input id="task-file-upload" type="file" className="hidden" onChange={onFileChange} disabled={uploadingFile} />
          <p className="text-xs text-muted-foreground mt-1">Limite: 10MB</p>
        </div>
      </CardContent>
    </Card>
  );
}
