# PRODUCT_NORTH_STAR.md

# LiciGov Pro — Product North Star

## A Constituição do Produto

---

# IMPORTANTE

Este documento representa a filosofia permanente do LiciGov Pro.

Toda implementação deverá respeitar obrigatoriamente estes princípios.

Os prompts de sprint definem funcionalidades específicas.

Este documento define a arquitetura permanente do produto.

Caso exista conflito entre um prompt e este documento, considera-se que:

- o prompt trata de um caso específico;
- este documento representa a visão permanente do produto.

Nenhuma implementação poderá violar estes princípios sem alteração explícita deste documento.

---

# Nossa Missão

O LiciGov Pro existe para tornar os Departamentos de Licitações mais eficientes, seguros e inteligentes.

Nosso objetivo é reduzir trabalho operacional repetitivo, elevar a qualidade técnica dos documentos e preservar a autonomia do servidor público.

Nunca substituímos o servidor.

Nunca substituímos a análise jurídica.

Nunca substituímos os sistemas oficiais da Administração Pública.

Nós potencializamos o trabalho das pessoas.

---

# Nossa Visão

Ser a principal Plataforma Cognitiva para Licitações Públicas do Brasil.

Uma plataforma que acompanha, orienta, organiza, documenta e acelera toda a operação do Departamento de Licitações, mantendo segurança jurídica, rastreabilidade e governança.

---

# Nosso Posicionamento

O LiciGov Pro NÃO é um ERP.

O LiciGov Pro NÃO concorre com:

- Elotech
- Betha
- IPM
- Equiplano
- Governança Brasil
- sistemas contábeis
- sistemas financeiros
- sistemas administrativos

O LiciGov Pro atua como uma Camada Cognitiva e Operacional integrada aos sistemas já utilizados pelo município.

---

# O Que Fazemos

Auxiliamos o Departamento de Licitações a:

- elaborar documentos de alta qualidade;
- padronizar procedimentos;
- organizar fluxos;
- reduzir retrabalho;
- reduzir erros;
- preservar conhecimento institucional;
- aumentar conformidade;
- acelerar elaboração documental;
- apoiar decisões técnicas;
- acompanhar toda a operação do departamento.

---

# O Que NÃO Fazemos

Não executamos atividades pertencentes aos ERPs.

Não implementamos:

- financeiro;
- contabilidade;
- patrimônio;
- folha;
- almoxarifado;
- pagamentos;
- tesouraria;
- execução orçamentária;
- arrecadação;
- protocolo administrativo.

Estas responsabilidades permanecem nos sistemas oficiais da Administração.

---

# Filosofia do Produto

O sistema existe para facilitar o trabalho do servidor.

Sempre que possível deverá:

- reutilizar informações;
- evitar redigitação;
- automatizar preenchimentos;
- explicar recomendações;
- produzir documentos robustos;
- preservar rastreabilidade.

Nunca aumentar trabalho.

---

# Filosofia da Inteligência Artificial

Toda IA deverá ser:

- supervisionada;
- approval-aware;
- explainable;
- contextual;
- auditável;
- replay-safe;
- determinística quando necessário.

A IA nunca decide.

A IA recomenda.

O servidor sempre possui a decisão final.

---

# Adaptive Recommendation Engine

O sistema recomenda.

Nunca obriga.

Cada recomendação deverá apresentar:

- reasoning;
- impact;
- confidence;
- alternativas;
- fundamentação legal (quando existir).

Toda recomendação poderá ser aceita ou rejeitada.

---

# Filosofia dos Business Domains

Cada Business Domain representa uma área operacional do Departamento de Licitações.

Todos compartilham um único Cognitive Kernel.

Nenhum domínio duplica informações.

Todo dado possui uma única fonte de verdade.

---

# Filosofia do Cognitive Kernel

O Kernel concentra toda infraestrutura compartilhada.

Incluindo:

- IA
- RAG
- Knowledge Graph
- Timeline
- Explainability
- Institutional Request Engine
- Adaptive Recommendation Engine
- Multi-Copilot
- Observabilidade
- Replay Safety
- **AIExecutionEngine** — pipeline oficial de execução de IA (RC-3.5)
- **Provider Adapter** — camada agnóstica de providers (RC-3.5)
- **Storage Service** — único ponto de acesso ao Amazon S3 (RC-3.5)

Nenhum domínio acessa infraestrutura diretamente.

Todo acesso ocorre pelo Kernel.

> **RC-3.5 — Componentes permanentes:** o AIExecutionEngine, o Provider Adapter e o
> Storage Service são componentes **permanentes** do Kernel. Business Domains **nunca**
> falam diretamente com Providers ou com o Amazon S3 — sempre pelo Kernel. Banco oficial:
> **MySQL**. Storage oficial: **Amazon S3**. `JWT_SECRET` é **obrigatório** (o sistema não
> inicia com segredo vazio). Ver [KERNEL_INFRASTRUCTURE.md](./KERNEL_INFRASTRUCTURE.md).

---

# Filosofia dos Documentos

Os documentos são o principal produto do sistema.

Todo documento deverá ser:

- tecnicamente correto;
- juridicamente fundamentado;
- padronizado;
- revisável;
- rastreável;
- editável;
- exportável.

Formatos oficiais:

- DOCX
- PDF

---

# Centro de Operações

O Centro de Operações representa a visão operacional do Departamento.

Seu objetivo é responder:

- Como está o Departamento agora?
- Quais processos precisam de atenção?
- O que acontece hoje?
- O que acontecerá nos próximos dias?
- Onde estão os gargalos?

---

# Calendário

O Calendário acompanha EVENTOS.

Nunca acompanha etapas do workflow.

Eventos:

- certames;
- reuniões;
- audiências;
- assinaturas;
- vencimentos;
- tarefas;
- eventos operacionais.

Publicações NÃO pertencem ao calendário.

---

# Timeline

A Timeline registra tudo que aconteceu.

É append-only.

Nunca editável.

---

# Workflow

O Workflow acompanha etapas do processo.

Cada etapa pode possuir checklists.

Os checklists permanecem dentro do próprio processo.

---

# Publicações

Publicações fazem parte do Workflow.

Nunca do Calendário.

Devem possuir:

- status;
- data;
- observações.

PNCP é padrão.

Os demais veículos deverão ser configuráveis por município.

---

# Processos Legados

O sistema deverá permitir registrar:

- processos completos;
- contratos externos;
- aditivos externos;
- atas;
- pareceres externos;
- reuniões;
- tarefas;
- eventos.

Nunca exigir reconstrução completa.

---

# Contratos

Contratos e Aditivos deverão gerar automaticamente eventos de vencimento.

Alertas:

- 90 dias;
- 60 dias;
- 30 dias;
- 15 dias;
- 7 dias.

---

# Future Evolution

A arquitetura deverá estar preparada para:

- Google Calendar;
- Apple Calendar;
- Outlook;
- ICS;
- Mobile;
- BI;
- Analytics;
- Dashboards avançados.

Preparar arquitetura não significa implementar funcionalidade.

---

# Princípios Arquiteturais

Toda implementação deverá preservar:

- Multi-Tenant
- Replay Safety
- Explainability
- Auditabilidade
- Observabilidade
- Determinismo
- Modularidade
- Baixo Acoplamento
- Escalabilidade
- Governança
- Segurança Jurídica

---

# Decisões Arquiteturais Consolidadas

1. O LiciGov Pro nunca substitui ERP.

2. Todo documento oficial é gerado em DOCX e PDF.

3. Toda IA é supervisionada.

4. O servidor sempre toma a decisão final.

5. Todo Business Domain reutiliza o Cognitive Kernel.

6. Não existe duplicação de dados.

7. O Centro de Operações apenas acompanha.

8. O Calendário acompanha eventos.

9. Publicações pertencem ao Workflow.

10. Processos legados são suportados.

11. Contratos geram eventos automaticamente.

12. Toda funcionalidade nova deverá passar pela Regra de Ouro.

---

# Regra de Ouro

Antes de implementar qualquer funcionalidade responder:

1. Isso reduz trabalho do servidor?

2. Isso melhora a qualidade dos documentos?

3. Isso aumenta a segurança jurídica?

4. Isso pertence ao Departamento de Licitações?

5. Isso pertence ao ERP?

Se a resposta da quinta pergunta for "SIM", a funcionalidade NÃO deve ser implementada no LiciGov Pro.

---

# Nosso Compromisso

Queremos que o servidor termine seu expediente sabendo que:

- trabalhou menos;
- produziu documentos melhores;
- teve segurança jurídica;
- perdeu menos tempo;
- reduziu retrabalho;
- não esqueceu prazos;
- recebeu apoio da tecnologia sem perder autonomia.

---

# A Frase que Resume o Produto

"O LiciGov Pro não substitui o ERP da prefeitura.

Ele potencializa o Departamento de Licitações com inteligência, governança, rastreabilidade e apoio cognitivo para que os servidores produzam documentos de alta qualidade e conduzam processos com mais eficiência e segurança jurídica."
