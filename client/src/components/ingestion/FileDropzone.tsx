/**
 * PR B.2.2 — Dropzone REAL (drag & drop + seletor de arquivo).
 *
 * NUNCA usa textarea como substituto de upload: há um <input type="file"> real. Acessível por
 * teclado (Enter/Espaço aciona o seletor), com foco visível e rótulos pt-BR. Valida contra a
 * capacidade REAL antes do envio (o servidor revalida); só aceita formatos suportados.
 */
import { useCallback, useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/InlineError";
import {
  acceptAttr,
  supportedFormatsLabel,
  formatBytes,
  validateFile,
  type IngestionCapabilities,
} from "@/lib/ingestion/capabilities";

interface FileDropzoneProps {
  capabilities: IngestionCapabilities;
  onFileAccepted: (file: File) => void;
  disabled?: boolean;
}

export function FileDropzone({ capabilities, onFileAccepted, disabled }: FileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const result = validateFile(file, capabilities);
    if (!result.ok) { setError(result.message); return; }
    setError(null);
    onFileAccepted(file);
  }, [capabilities, onFileAccepted]);

  const openPicker = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Enviar arquivo: clique ou arraste um arquivo suportado"
        aria-describedby={`${inputId}-hint`}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker(); }
        }}
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          dragOver ? "border-primary bg-primary/5" : "border-border bg-card",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-primary/60",
        )}
      >
        <Upload className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          Arraste um arquivo aqui ou <span className="text-primary underline">clique para selecionar</span>
        </p>
        <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
          Formatos aceitos: {supportedFormatsLabel(capabilities) || "nenhum disponível"} · tamanho máximo {formatBytes(capabilities.maxFileSizeBytes)}
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="sr-only"
          accept={acceptAttr(capabilities)}
          disabled={disabled}
          onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </div>
      {error && <InlineError message={error} />}
    </div>
  );
}
