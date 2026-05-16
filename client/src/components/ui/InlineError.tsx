import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface InlineErrorProps {
  title?: string;
  message?: string;
}

export function InlineError({
  title = "Erro ao carregar",
  message = "Ocorreu um erro inesperado. Tente novamente.",
}: InlineErrorProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px] p-6">
      <Alert variant="destructive" className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}
