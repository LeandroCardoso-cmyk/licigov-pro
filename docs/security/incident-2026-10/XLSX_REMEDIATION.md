# Remediação do `xlsx` (SheetJS 0.18.5) — SEC-AUD-07

**Data:** 25/10/2026 · **Advisories:** GHSA-4r6h-8v6p-xvw6 (prototype pollution na leitura), GHSA-5pgg-2g8v-p4x9
(ReDoS) — high. O npm não publica versão corrigida (o SheetJS distribui ≥ 0.19 só pela CDN própria).

## Inventário de consumidores reais

| Consumidor | Uso | Entrada | Exposição |
|---|---|---|---|
| `server/parsers/xlsxParser.ts` (registrado em `parserRegistry`) | **Leitura** de XLSX e XLS na ingestão canônica (Pesquisa de Preços, Document Intake) | Arquivo enviado por usuário autenticado (upload ≤ 50 MB) | **Aplicável** |
| `server/services/excelService.ts` ← `download.itemsSpreadsheet` (tenantProcedure) e `zipService` (pacote de publicação) | **Escrita** de planilha de itens | Dados do processo (texto do usuário/importado) | Advisories são de leitura; a escrita não executa fórmula |
| Testes (`p0-pilot-*`, `m8-*`, `r2-leg005`) | Geram fixtures XLSX/XLS | — | Só dev |

CSV não usa SheetJS (`server/parsers/csvParser.ts`, sem alteração).

## Decisão técnica desta PR

| Formato | Antes | Depois |
|---|---|---|
| XLSX (ZIP) — leitura | SheetJS 0.18.5 | **`exceljs` 4.4.0** (já dependência), matriz idêntica por teste diferencial |
| XLSX — exportação | SheetJS 0.18.5 | **`exceljs`**: mesma aba, células e larguras; texto iniciado por `=` continua texto |
| XLS legado (BIFF/OLE) — leitura | SheetJS 0.18.5 | **SheetJS 0.18.5 mantido** (o `exceljs` não lê BIFF), com teto de 100 mil linhas por aba |
| Outro conteúdo com extensão .xls/.xlsx | Erro genérico do SheetJS | `CORRUPT_FILE` explícito (leitor escolhido pela **assinatura do conteúdo**, não pela extensão) |

Limites novos (`server/parsers/spreadsheetLimits.ts`), aplicados antes de abrir o XLSX, lendo só o diretório
central do ZIP: ≤ 2.000 entradas, ≤ 250 MB descomprimidos declarados, taxa ≤ 200:1 por entrada > 1 MB, sem ZIP64;
depois de aberto: ≤ 100 abas e ≤ 2 milhões de células por aba. Falha ⇒ `SIZE_EXCEEDED`/`CORRUPT_FILE`
determinísticos (sem reprocessamento automático). Já existentes: upload ≤ 50 MB, ≤ 5.000 itens, fila de ingestão
com um job por vez por processo. **Sem timeout por parse** (backlog). Fórmulas nunca são executadas.

`PARSER_VERSION` 1.2.0 → 1.3.0 e `rawMetadata.engine` (`exceljs` | `sheetjs-legacy-xls`) registram na
proveniência qual leitor produziu cada sessão; sessões antigas mantêm sua versão (replay não reprocessa nada).

## Diferenças de comportamento conhecidas

- **Datas:** o SheetJS 0.18 convertia datas pelo fuso **local** do processo; o `exceljs` não depende de fuso.
  Produção roda em UTC (sem `TZ` no Railway) ⇒ saída idêntica. Em fuso com offset positivo, o leitor antigo
  podia deslocar a data para o dia anterior; o novo não.
- Aba vazia, células só formatadas, linhas vazias, mescladas, fórmulas com/sem cache, erros, rich text e
  hyperlinks: paridade comprovada no corpus sintético (`xlsx-exceljs-parity.test.ts`). **Limitação:** não há
  arquivos reais de Excel/LibreOffice no repositório; recomenda-se rodar o mesmo diferencial com 3–5 planilhas
  reais anonimizadas de prefeitura em staging antes de promover.

## Decisão de produto pendente (Owner) — XLS legado

O caminho XLS continua com as duas advisories. Opções:

1. **Manter XLS via SheetJS 0.20.3 oficial** (tarball da CDN do SheetJS fixado por integridade no lockfile):
   corrige as duas advisories e preserva o formato. Exige liberar `cdn.sheetjs.com` no build (Railway/CI) e
   aceitar dependência fora do npm. Não validado aqui (CDN bloqueada nesta sessão).
2. **Descontinuar a importação de `.xls`** com mensagem explícita ("salve como .xlsx ou .csv e reenvie") —
   remove a dependência e as advisories; muda a experiência de quem recebe planilhas antigas de fornecedores.
3. **Manter como está** (SheetJS 0.18.5 só para XLS, com limites) — risco residual aceito formalmente.

Até a decisão, `xlsx` permanece no `package.json` e as duas GHSA permanecem no baseline do gate (o baseline não
foi ampliado).
