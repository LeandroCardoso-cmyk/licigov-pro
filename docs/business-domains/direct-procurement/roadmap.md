# Roadmap — Future Evolution

## Aviso importante

Este documento descreve **evoluções futuras** do Business Domain Contratação
Direta. **Nada aqui está implementado.** Para os itens listados existem, no
máximo, **interfaces e pontos de extensão** que permitem a implementação futura
sem retrabalho — mas **não há comportamento ativo**.

O objetivo é registrar a direção arquitetural e evitar que o núcleo atual
(Production Ready Core) seja confundido com estas capacidades.

## Itens planejados (NÃO implementados)

### 1. Envio automático de convites
Envio automatizado de convites a fornecedores na etapa de recebimento de
propostas. Hoje o recebimento é **100% manual** (ver `proposal-collection.md`).
Ponto de extensão: gancho na `PROPOSAL_COLLECTION`.

### 2. Integração de e-mail
Recebimento e envio de mensagens por e-mail integrados ao processo (propostas,
comunicações). Hoje o e-mail é apenas uma **forma de recebimento manual**
registrada no procedimento presencial.

### 3. Leitura automática de propostas
Extração automática de dados de propostas recebidas (OCR/parsing). Hoje toda
proposta é **inserida ou revisada por humano**.

### 4. Integração PNCP
Transmissão automática de avisos, extratos e ratificações ao Portal Nacional de
Contratações Públicas. Hoje o sistema **gera** os documentos de publicação, mas
**não transmite** a veículos externos (ver `publication.md`).

### 5. Biblioteca de justificativas
Repositório reutilizável de justificativas de contratação e de preço, com
sugestão contextual. Hoje cada justificativa é elaborada no processo.

### 6. Benchmark
Comparação de preços e condições entre processos e órgãos, com referências de
mercado consolidadas.

### 7. Analytics
Painéis analíticos específicos de contratação direta (volumes, prazos, modalidades,
gargalos), além dos indicadores gerais de Gestão.

### 8. IA preditiva
Previsão de prazos, de necessidade de parecer e de riscos processuais a partir do
histórico.

### 9. Score de risco
Classificação de risco jurídico/operacional do processo, com fatores explicáveis.

### 10. Reutilização inteligente
Sugestão automática de reaproveitamento de artefatos (justificativas, documentação,
fundamentos) de processos anteriores semelhantes.

## Princípios que se mantêm

Qualquer evolução futura deverá respeitar os princípios do domínio:

- **reutilizar sem duplicar** — consumir capacidades existentes por interface;
- **explicabilidade** — toda recomendação com reasoning, explainability,
  provenance e confidence, sempre rejeitável;
- **humano no controle** — saída de IA editável, revisável e validada;
- **determinismo e replay-safety** — IDs via `sha256`, sem `Date.now()` nem
  `Math.random()`;
- **multi-tenant** — isolamento por `organizationId`;
- **Kernel Access Service** — `assertKernelAccess` como única porta de acesso ao
  Kernel.

## Fora de escopo (permanente)

Alinhado ao posicionamento do LiciGov Pro, estas capacidades **não** fazem parte
do roadmap deste domínio: ERP municipal, sistema contábil/financeiro, tributário,
RH ou patrimonial, portal completo de compras e plataforma completa de pregão
eletrônico.
