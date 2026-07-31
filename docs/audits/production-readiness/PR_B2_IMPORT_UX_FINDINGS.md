# PR B.2 — Achados funcionais de importação (REGISTRO — não implementado nesta PR)

> Registro de achados de UX/funcionais observados durante a homologação da PR #191.
> **Fora do escopo da correção de CSP** — nenhuma alteração de comportamento foi feita aqui.
> Servem de backlog para uma futura **PR B.2**.

## Achados

1. **Importação de DFD — seleção "PDF" não apresenta upload.**
   Ao escolher a origem "PDF" no fluxo de importação de DFD, o componente de upload de arquivo não
   é exibido, impedindo o envio do PDF. Esperado: revelar o seletor/dropzone de arquivo ao marcar
   "PDF".

2. **Pesquisa de Preços — seleção "PDF" não apresenta upload.**
   Mesmo sintoma no fluxo de Pesquisa de Preços: a opção "PDF" não expõe o controle de upload.

3. **"Iniciar direto no ETP" é criação direta, não importação.**
   O rótulo/ação sugere importação, mas o comportamento é criar um ETP em branco. Há dissonância
   entre expectativa (importar) e efeito (criar). Avaliar renomear/realocar para deixar claro que é
   **criação**.

4. **Avaliar ação explícita "Importar ETP existente".**
   Não há um caminho explícito para importar um ETP já existente. Avaliar adicionar essa ação como
   contraparte de importação, separada da criação direta.

## Observações de encaminhamento (para a PR B.2)

- Itens 1 e 2 aparentam ser a mesma causa-raiz (condicional de exibição do upload por tipo de
  origem "PDF") em dois fluxos distintos — investigar componente/estado compartilhado.
- Itens 3 e 4 são de **nomenclatura/arquitetura de navegação** (criar vs. importar) — exigem decisão
  de produto antes de implementar.
- Nenhum destes toca CSP, segurança ou o gate de produção da PR #191.
