# Fluxo de Trabalho — Nascimento do Contrato e Abas do Workspace

O Business Domain Contratos reconhece que **nenhuma prefeitura começa apenas com contratos
novos**. Por isso oferece **três formas de nascimento** do contrato, todas convergindo para
o mesmo agregado `ContractWorkspace`.

## Os 3 fluxos de nascimento

### Fluxo 1 — A partir do Processo Licitatório
`originType = processo_licitatorio`

```
Processo Licitatório → Homologação → Adjudicação → Gerar Contrato → Workspace (minuta)
```

- Origem: um processo licitatório concluído dentro do LiciGov Pro.
- Dados do objeto, valor, contratada e vigência são **reaproveitados** do processo.
- Router: `createFromProcurement`.

### Fluxo 2 — A partir da Contratação Direta
`originType = contratacao_direta`

```
Contratação Direta → Ratificação → Gerar Contrato → Workspace (minuta)
```

- Origem: dispensa, inexigibilidade ou credenciamento já ratificados.
- Router: `createFromDirectProcurement`.

### Fluxo 3 — Contrato Externo (OBRIGATÓRIO)
`originType = externo`

```
Importar PDF/DOCX → Extração → Reconstrução da estrutura → Workspace (vigente)
```

- Origem: contratos que **já existiam** antes da adoção da plataforma.
- Permite que a prefeitura traga seu acervo contratual para dentro do sistema.
- Router: `importExternalContract`.
- Detalhado em [`imported-contracts.md`](./imported-contracts.md).

> O Fluxo 3 é **obrigatório** justamente porque garante adoção real: sem ele, o sistema só
> serviria a contratos nascidos internamente.

## Abas do Workspace

Uma vez criado, o `ContractWorkspace` organiza toda a operação em cinco abas:

### 1. Contrato
O instrumento principal. Exibe dados cadastrais, status atual e a minuta/versão vigente do
contrato. Ponto de partida para gerar documentos e instrumentos.

### 2. Aditivos
Termos aditivos (prazo, valor, quantitativo, qualitativo). Cada aditivo segue o fluxo
Solicitar → Justificar → Gerar minuta → Parecer Jurídico (quando necessário) → Documento
Final. Ver [`addenda.md`](./addenda.md). Router: `createAddendum`.

### 3. Apostilamentos
Registros de reajuste, alteração de gestor, alteração de fiscal e demais alterações
permitidas em lei — com minuta gerada automaticamente. Ver [`apostilles.md`](./apostilles.md).
Router: `createApostille`.

### 4. Documentos
Todos os artefatos gerados (contrato, aditivos, apostilamentos, rescisões) e pareceres,
sempre **por referência** ao Document Engine e ao domínio Parecer Jurídico — nunca
duplicados. Router: `generateDocuments`.

### 5. Ocorrências
Registro simples de fatos relevantes do contrato: descrição, data, anexos e observações.
**Sem workflow complexo** — é uma trilha factual, não um processo. Router: `registerOccurrence`.

## Papel do Adaptive Process Engine

A navegação entre abas e a decisão sobre **qual instrumento** cabe (aditivo? apostilamento?
parecer? nova minuta?) é **sugerida pelo Adaptive Process Engine**, nunca imposta por um
fluxo rígido. O usuário mantém o controle e a decisão final.
