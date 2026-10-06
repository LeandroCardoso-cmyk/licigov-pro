import { outlineOf } from "@/lib/institutionalTemplatesView";

/** Contorno estrutural (somente leitura) do AST: tipos de nó da whitelist, nunca HTML/script. */
export function AstOutline({ ast }: { ast: unknown }) {
  const items = outlineOf(ast);
  if (items.length === 0) return <p className="text-sm text-muted-foreground">Estrutura vazia.</p>;
  return (
    <ol className="space-y-0.5 text-sm" aria-label="Estrutura da revisão">
      {items.map((it, i) => (
        <li key={`${i}-${it.kind}`} style={{ paddingLeft: `${it.depth * 16}px` }}>
          <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{it.kind}</span>{it.label}
        </li>
      ))}
    </ol>
  );
}
