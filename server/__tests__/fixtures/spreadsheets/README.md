# Fixtures sintéticas de planilha (SEC-AUD-07)

Dados **fictícios**. Gerados uma única vez em 26/10/2026, com `TZ=UTC`, pelo SheetJS 0.18.5 — o leitor/gravador
que saiu do produto e das dependências — para congelar o comportamento anterior sem manter o pacote:

| Arquivo | Conteúdo |
|---|---|
| `xlsx-goldens.json` | Matriz que o leitor anterior (`sheet_to_json(header:1, defval:"")`, `cellDates:true`) produzia para cada caso do corpus de `xlsx-reader-goldens.test.ts` e para os dois `.xlsx` abaixo. Datas como `{ "date": ISO }` |
| `sheetjs-mixed.xlsx` | XLSX escrito pelo SheetJS (outro gerador): tipos mistos, linha vazia, data, duas abas |
| `sheetjs-inline.xlsx` | XLSX escrito pelo SheetJS com strings inline (sem sharedStrings) |
| `itens-biff8.xls` | XLS legado real (BIFF8/OLE) com 2 itens — usado para provar o **bloqueio** do `.xls` |

Não regenerar sem o leitor anterior: os goldens são a referência de compatibilidade.
