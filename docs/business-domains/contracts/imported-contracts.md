# Contratos Externos (Importados) — Fluxo Obrigatório

## Por que existe

Nenhuma prefeitura inicia sua operação com apenas contratos novos. Existe sempre um
**acervo de contratos vigentes** firmados antes da adoção do LiciGov Pro. Por isso, o
cadastro de **contrato externo** é um fluxo **obrigatório** do Business Domain Contratos:
sem ele, o sistema não conseguiria representar a realidade contratual do órgão.

`originType = externo` · Router: `importExternalContract` · Tabela: `imported_contracts`

## Visão do fluxo

```
Upload PDF/DOCX
      │
      ▼
Extração determinística (heurística sobre o texto)
      │
      ▼
Reconstrução da estrutura contratual
      │
      ▼
Criação do ContractWorkspace (status: vigente)
      │
      ▼
Disponível para Aditivos, Apostilamentos, Ocorrências e geração documental
```

## Etapas

### 1. Importar PDF/DOCX
O usuário envia o arquivo do contrato já assinado. O conteúdo é registrado em
`imported_contracts`, preservando o documento original **por referência** (sem duplicação).

### 2. Extração de informações
A extração é feita por **heurística determinística sobre o texto** do documento. O objetivo
é identificar os campos-chave do contrato:

- Número do contrato (`contractNumber`)
- Contratada (`contractor`)
- Objeto (`object`)
- Valor (`value`)
- Vigência / prazo (`term`)
- Gestor e fiscal, quando presentes (`manager`, `inspector`)

> A extração é **determinística e replay-safe**: o mesmo texto sempre produz o mesmo
> resultado. Não há dependência de `Date.now()` ou `Math.random()`, e os identificadores
> derivam de `sha256`.

### 3. Reconstrução da estrutura
A partir dos campos extraídos, o domínio **reconstrói a estrutura** do contrato no formato
canônico do `ContractWorkspace`, mapeando cláusulas e metadados para o modelo interno. Isso
permite que um contrato externo seja tratado exatamente como um contrato nascido internamente.

### 4. Criação do Workspace
Com a estrutura reconstruída, cria-se o `ContractWorkspace` (tipicamente já como `vigente`,
pois o contrato externo já está em execução). A partir daí, todo o ferramental do domínio
fica disponível: aditivos, apostilamentos, ocorrências e geração inteligente de minutas.

## Revisão humana obrigatória

A extração heurística é uma **sugestão**. Todos os campos reconstruídos são
**revisáveis** pelo usuário antes da confirmação do Workspace, acompanhados de *confidence*
e *provenance* (de qual trecho do texto o dado foi extraído). Nada é gravado como definitivo
sem validação humana.

## O que este fluxo NÃO faz

- Não importa histórico financeiro, empenhos ou pagamentos.
- Não faz OCR de documentos que não tenham camada de texto extraível como parte do escopo
  central (o foco é a heurística determinística sobre o texto disponível).
- Não integra automaticamente com sistemas externos de origem — apenas reconstrói o
  documento fornecido.
