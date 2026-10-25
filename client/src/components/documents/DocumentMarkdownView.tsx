import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { stripInternalMarkers } from "@shared/documentMarkers";

/**
 * M8 (homologação visual) — visualização FORMATADA e SOMENTE LEITURA do conteúdo documental (Markdown do motor
 * documental: títulos, listas, tabelas GFM). Reutiliza o renderizador já usado no produto (Streamdown/react-markdown);
 * não é um segundo motor — a fonte continua sendo o mesmo texto persistido, inalterado.
 *
 * Conteúdo tratado como NÃO CONFIÁVEL (pode vir de importação ou edição humana):
 *  - HTML bruto desligado: sem `rehype-raw` e com `skipHtml` — tags/comentários não viram DOM;
 *  - marcadores internos `<!-- licigov:… -->` removidos antes de renderizar;
 *  - sem imagens nem mídia embutida; links passam pelo filtro padrão de URL do react-markdown (bloqueia `javascript:`);
 *  - sem controles de copiar/baixar e sem matemática/mermaid (não fazem parte dos documentos).
 */
const DISALLOWED = ["img", "iframe", "script", "style", "object", "embed", "video", "audio", "source", "form", "input"];

export interface DocumentMarkdownViewProps {
  content: string;
  className?: string;
  /** Rótulo acessível da região (ex.: "Visualização do TR v2"). */
  ariaLabel?: string;
}

export default function DocumentMarkdownView({ content, className = "", ariaLabel }: DocumentMarkdownViewProps) {
  const text = stripInternalMarkers(content ?? "");
  if (!text.trim()) return <p className="text-xs text-muted-foreground">Sem conteúdo.</p>;
  return (
    <div
      role="document"
      aria-label={ariaLabel}
      data-testid="document-markdown-view"
      className={`prose prose-sm dark:prose-invert max-w-none break-words [&_h1]:mt-2 [&_h1]:text-xl [&_h2]:mt-4 [&_h2]:text-lg [&_h3]:text-base [&_h4]:text-sm ${className}`}
    >
      <Streamdown
        remarkPlugins={[defaultRemarkPlugins.gfm]}
        rehypePlugins={[]}
        skipHtml
        disallowedElements={DISALLOWED}
        unwrapDisallowed
        controls={false}
        parseIncompleteMarkdown={false}
      >
        {text}
      </Streamdown>
    </div>
  );
}
