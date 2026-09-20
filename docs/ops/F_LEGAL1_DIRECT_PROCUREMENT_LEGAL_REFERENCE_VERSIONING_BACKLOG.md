# F-LEGAL1 — Direct Procurement Legal Reference Versioning & Temporal Validity

> **Estado atual:** `V1 CLOSED — PRE-PILOT BLOCKER RESOLVED`.
> O conteúdo abaixo preserva o backlog histórico que originou F-LEGAL1.1/F-LEGAL1.2/A3-RD1.
> O fluxo oficial já resolve referência e valor pelo domínio governado. Expansão adicional passa a ser **V2 não bloqueante**.
> Evidência: [`F_LEGAL1_V1_CLOSURE_2026-09-18.md`](./F_LEGAL1_V1_CLOSURE_2026-09-18.md).

## Contexto

Ao corrigir o casamento de artigo (2ª LIVE A3), foi removida do prompt de `suggestLegalArticle`
a orientação jurídica **hardcoded** que podia divergir do catálogo institucional:

```
Considere os limites de valor (Art. 75, I: até R$ 100.000 para obras, até R$ 50.000 para outros).
Considere a urgência (Art. 75, III: emergência; Art. 75, IV: urgência).
Considere exclusividade (Art. 74, I: fornecedor exclusivo).
```

A seleção passou a se basear **exclusivamente** nos DADOS DE REFERÊNCIA que o próprio serviço envia
(artigo, inciso, `summary`, `description`, `valueLimit`, `examples` do catálogo). Isso remove um ponto
de divergência imediato, mas **não** resolve o problema estrutural: thresholds legais imutáveis ainda
existem espalhados no código (ex.: `validateValue`, catálogo semeado) sem vigência/lineage.

## Escopo mínimo futuro (quando F-LEGAL1 for autorizado)

- Eliminar thresholds legais imutáveis espalhados em código.
- **Versionar** limites por vigência (valor normativo tem data de início/fim).
- Registrar `source` e `effective date` de cada regra.
- Alinhar `validateValue` ao catálogo versionado (uma única fonte da verdade).
- Alinhar prompt ↔ catálogo (sem duplicação de regra jurídica).
- **Impedir** uso de valor normativo revogado/desatualizado.
- Testes de **temporalidade** (regra vigente em data X).
- **Provenance/lineage** da regra jurídica aplicada em cada decisão.

## Fora de escopo agora

Não implementar nesta fase. Não alterar catálogo nem thresholds institucionais sem fonte/versionamento.
Bloqueador de pré-piloto, a ser tratado em janela própria, sob autorização.

## Nota relacionada — defeito de dados de referência (reportado, não corrigido aqui)

A 2ª LIVE sugeriu `Art. 75, II` (dispensa por valor para compras/serviços), que **não existe no
catálogo semeado** (`direct_contract_legal_articles` tem Art. 75 I, III, IV, VIII, XII, XIII — sem II).
Classificado como **`DIRECT PROCUREMENT REFERENCE DATA DEFECT`** e reportado — **nenhum registro
ad hoc foi inserido** para "fazer a homologação passar". A completude/curadoria do catálogo (com
fonte e vigência) é parte de F-LEGAL1.


## Addendum de encerramento — 2026-09-18

- O problema estrutural foi resolvido para o fluxo oficial por A3-RD1.
- `validateGovernedValue` usa `legal_value_override` temporal; o helper com valores históricos permanece somente `@legacy`.
- O reference set V1 foi aprovado e ativado com hash pinado e cobertura declarada.
- Artigos fora do coverage manifest retornam `LEGAL_REFERENCE_UNSUPPORTED`; não há aproximação/fabricação.
- Cobertura jurídica adicional deve nascer como V2 append-only, com nova verificação oficial, staging e aprovação humana.
- Portanto este backlog deixa de ser blocker pré-piloto do V1 e passa a registrar evolução futura.
