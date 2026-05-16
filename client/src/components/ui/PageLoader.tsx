import { Loader2 } from "lucide-react";

interface PageLoaderProps {
  message?: string;
}

export function PageLoader({ message = "Carregando..." }: PageLoaderProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function InlineLoader({ className = "" }: { className?: string }) {
  return <Loader2 className={`h-4 w-4 animate-spin ${className}`} />;
}
