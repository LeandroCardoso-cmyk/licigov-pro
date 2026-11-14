import type React from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { hasHiddenContent, stripInternalMarkers } from "@shared/documentMarkers";

/**
 * M8 (homologação visual) — visualização FORMATADA e SOMENTE LEITURA do conteúdo documental (Markdown do motor
 * documental: títulos, listas, tabelas GFM). Reutiliza o renderizador já usado no produto (Streamdown/react-markdown);
 * não é um segundo motor — a fonte continua sendo o mesmo texto persistido, inalterado.
 *
 * Conteúdo tratado como NÃO CONFIÁVEL (pode vir de importação ou edição humana):
 *  - HTML bruto desligado: sem `rehype-raw` e com `skipHtml` — tags/comentários não viram DOM;
 *  - marcadores internos `<!-- licigov:… -->` removidos antes de renderizar;
 *  - sem imagens nem mídia embutida; links passam pelo filtro padrão de URL do react-markdown (bloqueia `javascript:`);
 *  - sem controles de copiar/baixar e sem matemática/mermaid (não fazem parte dos documentos);
 *  - o que a apresentação segura descarta (HTML bruto, comentário comum, imagem) é sinalizado e o texto integral fica
 *    disponível em "Texto integral (técnico)" — quem revisa ou emite vê tudo o que está persistido.
 */
// Blocos de código como TEXTO puro: substitui o renderizador do Streamdown (que realça via HTML e desenha ```mermaid).
const PlainCode = ({ children, className }: { children?: React.ReactNode; className?: string }) => <code className={className}>{children}</code>;
// O `pre` padrão do Streamdown só repassa os filhos: sem ele o bloco perde as quebras de linha.
const PlainPre = ({ children }: { children?: React.ReactNode }) => <pre className="whitespace-pre-wrap">{children}</pre>;
// Item de lista de tarefas (GFM): estado como texto, sem controle de formulário.
const TaskMark = ({ checked }: { checked?: boolean }) => <span aria-label={checked ? "concluído" : "pendente"}>{checked ? "☑ " : "☐ "}</span>;
const COMPONENTS = { code: PlainCode, pre: PlainPre, input: TaskMark };

// `input` não está aqui: só o GFM o produz (caixa de tarefa) — `skipHtml` descarta `<input>` bruto — e ele vira TaskMark.
const DISALLOWED = ["img", "iframe", "script", "style", "object", "embed", "video", "audio", "source", "form"];

export interface DocumentMarkdownViewProps {
  content: string;
  className?: string;
  /** Rótulo acessível da região (ex.: "Visualização do TR v2"). */
  ariaLabel?: string;
}

export default function DocumentMarkdownView({ content, className = "", ariaLabel }: DocumentMarkdownViewProps) {
  const text = stripInternalMarkers(content ?? "");
  if (!text.trim()) return <p className="text-xs text-muted-foreground">Sem conteúdo.</p>;
  const hidden = hasHiddenContent(content ?? "");
  const view = (
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
        components={COMPONENTS}
        controls={false}
        parseIncompleteMarkdown={false}
      >
        {text}
      </Streamdown>
    </div>
  );
  if (!hidden) return view;
  return (
    <div>
      {view}
      <details className="mt-3 text-xs" data-testid="document-raw-text">
        <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
          Há trecho que a visualização formatada não mostra (HTML, comentário ou imagem). Ver texto integral (técnico)
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 p-2 font-mono text-[11px] text-foreground">{content}</pre>
      </details>
    </div>
  );
}
