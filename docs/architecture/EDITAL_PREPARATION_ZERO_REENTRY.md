# Preparação do Edital institucional — ZERO_REENTRY

Princípio: **se uma informação já tem autoridade canônica no sistema, a pessoa não a digita de novo.** A tela deixa de ser um
formulário técnico e passa a mostrar só as exceções (decisões que ainda dependem de pessoa).

Nada muda na governança: mesmas autoridades (`institutional_decisions` / `GovernedSourceService`), mesmo CAS, mesma
idempotência, mesmo M1/M2, mesma revalidação (`SOURCE_CHANGED`). **Sem migration, sem segundo ledger.**

## Classificação determinística (`editalPreparationModel.ts`)

Cada variável do catálogo da revisão vinculada cai em exatamente uma classe, por regra explícita (ordem de precedência):

| Classe | Regra | Na tela |
|---|---|---|
| `POST_AWARD` | `pos.*` / fonte `RESULT` | nunca aparece ("a preencher" no documento) |
| `CANONICAL` | autoridade "dona" (`AUTHORITY_OWNED_PATHS`), pin de documento, ou **projeção determinística** (objeto do processo, unidade requisitante, localidade e UF por extenso do cadastro do órgão) | somente leitura + origem |
| `TR_PROJECTION` | fonte `TR`; projetada só quando há dado **estruturado** do TR oficial (hoje: `metadata.object` da versão emitida) | automático ou pendência humana explícita |
| `CONDITIONAL` | possui `requiredWhen` | oculta até a condição ficar ativa (avaliação ao vivo na tela; o composer é a autoridade final) |
| `ORG_PROFILE` | fontes `IDENTITY`/`POLICY` | registrado UMA vez para o órgão e reutilizado em todo processo |
| `PROCESS_DECISION` | demais (certame/processo) | editável — é o que sobra para a pessoa |

Projeções vêm de `editalProjections.ts`, **a mesma função** usada pela composição (`canonicalSources.ts`) e pela tela: o que a
tela mostra como "reaproveitado" é exatamente o que o composer consome. Decisão humana registrada prevalece sobre a projeção.
Nada é projetado de texto livre, nada de IA, e **nenhuma decisão jurídica/normativa é inferida** (modo de disputa, critério,
percentuais, prazos, regras de participação continuam decisões humanas).

## Experiência

- Resumo por grupo (`✓ n/n` ou `⚠ N pendências`) + "X informações reaproveitadas automaticamente / Y decisões ainda precisam de você".
- Só as pendências no formulário; "Configuração institucional pendente" (perfil do órgão) separada das decisões do processo.
- Recolhidos: decisões opcionais (inclui as que ativam campos adicionais), "Ver dados reaproveitados" (valor, origem, referência),
  "Ver detalhes técnicos", "Perfil institucional para Editais" (edição do perfil; cria nova revisão ORG).
- **Uma confirmação**: "Salvar preparação do Edital" lista as N decisões, pede autoridade humana e confirma uma vez; internamente as
  escritas são **sequenciais** (órgão → divulgação → fontes do processo), cada uma com idempotência própria e CAS encadeado. Conflito ⇒
  para, recarrega, informa o que já foi registrado e o que não foi executado; nunca sobrescreve.
- Preflight: "Pendente: N decisões humanas" + detalhes técnicos sob expansão.

## Limite conhecido (honesto)

O TR oficial é um documento de texto: **não existe autoridade estruturada** para prazos, local de entrega, formas de pagamento etc.
Esses campos continuam sendo decisões humanas explicitamente identificadas (classe `TR_PROJECTION`, status `PENDING`) até que o TR
passe a persistir parâmetros estruturados. Isso é a maior parcela do que ainda aparece para a pessoa.
