import { Upload, Loader2 } from "lucide-react";

interface Props {
  isPending: boolean;
  onFileSelect: (file: File) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function UploadStep({ isPending, onFileSelect, onDrop }: Props) {
  return (
    <div className="space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-primary transition-colors cursor-pointer"
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-sm text-gray-600 mb-2">Arraste e solte o arquivo aqui ou clique para selecionar</p>
        <p className="text-xs text-gray-500">Formatos: Excel (.xlsx, .xls) ou CSV (.csv) | Máximo: 5MB</p>
        <input
          id="file-input"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
          className="hidden"
        />
      </div>

      {isPending && (
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Processando arquivo...</span>
        </div>
      )}
    </div>
  );
}
