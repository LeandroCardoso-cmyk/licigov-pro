# MINUTA — Política de Privacidade e Termos de Uso do LiciGov Pro

> **Status: MINUTA INSTITUCIONAL REVISÁVEL — NÃO PUBLICAR.**
> Preparada na missão LICIGOV-LAUNCH-READY (Lane B, PRD-03, 26/11/2026) a partir do comportamento real do código.
> Não é conclusão jurídica. A publicação exige: (1) preenchimento de todos os campos `[PENDENTE]`; (2) análise e
> aprovação por profissional jurídico competente (incluindo a qualificação de controlador/operador por tratamento);
> (3) decisão do Owner. Até lá, as páginas `/privacidade` e `/termos` seguem com o texto vigente, apenas com as
> correções factuais da Lane B (ver "Correções já aplicadas").

## Correções factuais já aplicadas nas páginas vigentes (sem publicar esta minuta)

| Afirmação anterior | Comportamento real (evidência) | Correção aplicada |
|---|---|---|
| "Método de login (OAuth)" | Login próprio por e-mail e senha; senha com hash bcrypt; sessão JWT em cookie HTTP-only (`server/routers/authRouter.ts`, `server/services/passwordSecurity.ts`) | "Credenciais de acesso (e-mail e senha…hash)" |
| "Dados armazenados em servidores no Brasil" | Região S3 configurável, padrão `us-east-1` (`server/config/aws.ts`); IA via provedores externos (Gemini por padrão — `server/config/ai.ts`) | Informa que provedores podem tratar dados fora do Brasil, com salvaguardas da LGPD |
| "em conformidade com a LGPD" (absoluto) | Não há avaliação de conformidade documentada | "com base na LGPD" |
| "Criptografia em repouso", "Monitoramento e auditoria de segurança" | Não verificável no repositório; HTTPS, hash de senha, RBAC/isolamento por órgão, trilha de auditoria e backup (`.github/workflows/db-backup.yml`) são verificáveis | Lista reduzida ao verificável |
| Provedores "hospedagem, análise" | Railway (hospedagem/banco), AWS S3 (arquivos), Brevo (e-mail), Stripe (pagamentos), IA (Gemini; Claude/OpenAI preparados) | Categorias de provedores explicitadas |
| Cookies "essenciais" apenas | GA4 carregado quando `VITE_GA_MEASUREMENT_ID` existe no build (`client/src/lib/analytics.ts`) | Menção à medição de uso quando habilitada |
| Termos: "você deve criar uma conta" | Cadastro público desabilitado por padrão (`ALLOW_PUBLIC_REGISTRATION=false`); acesso por convite | Acesso por vínculo ao órgão/convite |
| Termos: IA "gera documentos" | Conteúdo editável, revisão humana; não publica em portais; não substitui parecer | Descrição alinhada ao North Star |

## Campos pendentes (não inventar — decisão/insumo do Owner e do jurídico)

- `[PENDENTE: razão social da empresa responsável pelo LiciGov Pro]`
- `[PENDENTE: CNPJ]`
- `[PENDENTE: endereço]`
- `[PENDENTE: e-mail/canal de contato do titular e do Encarregado (DPO) — hoje o texto diz "sistema de suporte", que não existe como canal público identificado]`
- `[PENDENTE: nome do Encarregado ou forma de contato]`
- `[PENDENTE: política de retenção por categoria — o código tem RetentionPolicy para documentos (docs/legal/README.md), mas não há prazos definidos para contas, logs técnicos e solicitações comerciais]`
- `[PENDENTE: região efetiva do bucket S3 e do banco em produção (confirmar no provedor; não presumir Brasil)]`
- `[PENDENTE: provedores de IA efetivamente habilitados em produção e termos de uso de dados de cada um (retenção/treinamento)]`
- `[PENDENTE: qualificação jurídica controlador × operador por tratamento — proposta abaixo é hipótese de trabalho]`
- `[PENDENTE: confirmação de uso de Google Analytics em produção e base legal/consentimento de cookies não essenciais]`
- `[PENDENTE: forma de atendimento dos direitos — exportação e exclusão por autoatendimento estão DESATIVADAS (server/routers/lgpdRouter.ts); atendimento seria por solicitação ao canal de contato]`
- `[PENDENTE: foro e condições comerciais (preço, vigência, rescisão) — vivem no contrato com o órgão, não nos Termos]`

---

## Parte A — Política de Privacidade (minuta)

### 1. Quem somos
O LiciGov Pro é operado por `[PENDENTE: razão social]`, CNPJ `[PENDENTE]`, com sede em `[PENDENTE]`. Contato: `[PENDENTE]`.

### 2. Papéis no tratamento (hipótese a validar juridicamente)
- **Dados inseridos pelos órgãos nos processos de contratação** (documentos, processos, contratos, dados de servidores e fornecedores): o **órgão público contratante** tende a ser o controlador; o LiciGov Pro atua como **operador**, tratando conforme as instruções do órgão e o contrato.
- **Dados de conta, segurança, faturamento e relacionamento comercial** (cadastro do usuário, logs de acesso, solicitações de proposta): o LiciGov Pro tende a atuar como **controlador**.

### 3. Categorias de dados
- Conta: nome, e-mail, hash de senha, papel no órgão, vínculo organizacional, registros de convite.
- Uso e auditoria: ações realizadas, versões de documentos, autoria/edição/emissão, data e hora, identificador de correlação, endereço IP.
- Conteúdo dos processos: informações inseridas pelo órgão (podem conter dados pessoais de servidores, fornecedores e terceiros).
- Comercial: dados do órgão e do responsável informados em `/solicitar-proposta` (nome, cargo, e-mail, telefone).
- Pagamento: processados pelo provedor de pagamentos; a plataforma não armazena dados completos de cartão.

### 4. Finalidades
Prestação do serviço contratado; autenticação e segurança; rastreabilidade e auditoria exigidas pela gestão pública; geração assistida de conteúdo com IA sob revisão humana; comunicação transacional (convites, redefinição de senha); atendimento comercial; cumprimento de obrigações legais.

### 5. Inteligência artificial
Trechos do contexto do processo podem ser enviados a provedores de IA `[PENDENTE: lista efetiva]` para gerar sugestões. Toda saída é editável e revisada por servidor; a IA não toma decisões administrativas, não emite parecer e não publica documentos. `[PENDENTE: termos de retenção/treinamento de cada provedor]`.

### 6. Compartilhamento
Com provedores necessários à operação (hospedagem e banco de dados; armazenamento de arquivos; e-mail transacional; pagamentos; IA), e quando exigido por lei ou ordem de autoridade. Não vendemos dados pessoais.

### 7. Transferência internacional
Provedores podem tratar dados fora do Brasil `[PENDENTE: confirmar regiões]`, observadas as hipóteses do art. 33 da LGPD.

### 8. Segurança
HTTPS; senhas com hash; controle de acesso por papéis e isolamento por órgão; trilha de auditoria; cópias de segurança periódicas do banco. Nenhuma medida elimina todo risco; incidentes relevantes serão comunicados na forma da lei.

### 9. Retenção
`[PENDENTE: prazos por categoria]`. Documentos de processos seguem a política de retenção documental do órgão e a legislação aplicável.

### 10. Direitos dos titulares
Confirmação, acesso, correção, anonimização/bloqueio/eliminação quando cabível, portabilidade, informação sobre compartilhamento, revogação de consentimento e oposição — exercidos por solicitação em `[PENDENTE: canal]`. Quando o LiciGov Pro for operador, a solicitação será encaminhada ao órgão controlador. Reclamações podem ser dirigidas à ANPD.

### 11. Cookies
Essenciais (sessão). Medição de uso apenas quando habilitada `[PENDENTE: confirmação e consentimento]`.

### 12. Vigência e atualizações
Vigente a partir de `[PENDENTE]`. Alterações relevantes serão informadas na plataforma.

## Parte B — Termos de Uso (minuta)

1. **Objeto.** Plataforma de apoio operacional e documental ao departamento de licitações (DFD, ETP, TR, minutas de edital, contratação direta, parecer, contratos e aditivos, gestão), sob a Lei 14.133/2021. Não é ERP, portal de compras ou plataforma de pregão; não publica atos em portais oficiais.
2. **Acesso.** Por vínculo a órgão contratante, em regra por convite do administrador do órgão. O usuário responde pela guarda das credenciais.
3. **Responsabilidades do órgão e dos usuários.** Revisar todo conteúdo; decidir e assinar os atos; observar os procedimentos legais. A emissão interna de um documento na plataforma registra autoria e versão, mas **não equivale** a parecer jurídico, aprovação da autoridade, assinatura ou publicação.
4. **Responsabilidades da empresa.** Disponibilizar o serviço conforme o contrato `[PENDENTE: nível de serviço]`, manter segurança e isolamento dos dados, tratar dados pessoais conforme a Política.
5. **IA.** Saídas são sugestões; podem conter erros; devem ser verificadas.
6. **Propriedade.** Conteúdo inserido e documentos produzidos pertencem ao órgão; a plataforma e seus modelos pertencem à `[PENDENTE: razão social]`.
7. **Uso aceitável, suspensão e encerramento.** `[PENDENTE: redação jurídica — a cláusula atual de suspensão "sem aviso, por qualquer motivo" deve ser revisada à luz do contrato com o órgão]`.
8. **Condições comerciais.** Definidas no instrumento contratual com o órgão, conforme os procedimentos legais aplicáveis — não nestes Termos.
9. **Lei aplicável e foro.** Legislação brasileira; foro `[PENDENTE]`.
10. **Contato.** `[PENDENTE]`.
