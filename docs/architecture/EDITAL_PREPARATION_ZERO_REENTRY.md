# Preparação do Edital institucional — ZERO_REENTRY

Princípio: **se uma informação já tem autoridade canônica no sistema, a pessoa não a digita de novo.** A tela deixa de ser um
formulário técnico e passa a mostrar só as exceções (decisões que ainda dependem de pessoa).

> **Evolução:** o reuso de contexto institucional e upstream (Perfil de Licitações, papéis, padrões, Parâmetros estruturados do TR e Authority Matrix) está em [`EDITAL_CONTEXT_REUSE.md`](EDITAL_CONTEXT_REUSE.md).

Nada muda na governança: mesmas autoridades (`institutional_decisions` / `GovernedSourceService`), mesmo CAS, mesma
idempotência, mesmo M1/M2, mesma revalidação (`SOURCE_CHANGED`). **Sem migration, sem segundo ledger.**

## Classificação determinística (`editalPreparationModel.ts`)

Cada variável do catálogo da revisão vinculada cai em exatamente uma classe, por regra explícita (ordem de precedência):

| Classe | Regra | Na tela |
|---|---|---|
| `POST_AWARD` | `pos.*` / fonte `RESULT` | nunca aparece ("a preencher" no documento) |
| `CANONICAL` | autoridade "dona" (`AUTHORITY_OWNED_PATHS`), pin de documento, ou **projeção determinística** (objeto do processo, unidade requisitante, localidade e UF por extenso do cadastro do órgão) | somente leitura + origem |
| `TR_PROJECTION` | fonte `TR`; projetada só quando o **TR oficial EXATO pinado** traz dado **estruturado** (hoje: `metadata.object`) | automático ou pendência humana explícita |
| `CONDITIONAL` | possui `requiredWhen` | oculta até a condição ficar ativa (avaliação ao vivo na tela; o composer é a autoridade final) |
| `ORG_PROFILE` | fontes `IDENTITY`/`POLICY` | registrado UMA vez para o órgão e reutilizado em todo processo |
| `PROCESS_DECISION` | demais (certame/processo) | editável — é o que sobra para a pessoa |

Projeções vêm de `editalProjections.ts`, **a mesma função** usada pela composição (`canonicalSources.ts`) e pela tela: o que a
tela mostra como "reaproveitado" é exatamente o que o composer consome.

## Uma autoridade por variável (fechamento)

- **TR exato, nunca "latest".** A projeção do TR deriva do **mesmo documento** validado pelo pin (`id + versão + hash`): a composição
  resolve o pin primeiro e entrega o documento exato às fontes (`resolveSources(..., official)`); a preparação recebe o pin escolhido
  e o valida pela mesma regra. Sem pin ⇒ "Selecione o TR oficial exato"; pin obsoleto (`OFFICIAL_PIN_STALE`) ⇒ sem projeção, preflight
  BLOCKED, reseleção humana; nenhuma versão é escolhida automaticamente.
- **CANONICAL não é sobreposto.** Para variáveis `CANONICAL` (autoridade "dona" ou projeção canônica) o composer e a preparação usam
  só a autoridade canônica. Valor governado **legado** no ledger é preservado como história (nunca apagado nem migrado), **ignorado**
  na composição e na preparação (aviso técnico "valor legado preservado e ignorado") e mantido nas regravações da seção.
- **Guard de escrita derivado da mesma política** (`canonicalProjectionPolicy.ts`): gravar caminho CANONICAL é recusado com
  `CANONICAL_AUTHORITY_OWNED`, como já ocorria com `AUTHORITY_OWNED_PATHS`. A releitura do registro tolera o legado.
- **TR_PROJECTION**: se o TR exato traz o dado, ele **vence** qualquer decisão humana anterior (preservada no ledger); se não traz, a
  pessoa pode supri-lo (pendência explícita) e a decisão vale enquanto o TR exato não trouxer o dado.
- **Classificação exaustiva**: fontes sem política explícita (`DFD`, `ETP`, `PARAMS` ou futuras) falham fechado
  (`PREPARATION_CLASSIFICATION_UNSUPPORTED`); nada vira decisão humana por omissão.
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
