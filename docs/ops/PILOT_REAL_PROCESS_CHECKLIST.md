# Checklist operacional — primeiro processo real (DFD → ETP → TR → Edital)

> **Status:** roteiro para uma futura autorização específica do Owner e do órgão. Este documento **não autoriza** leitura nem escrita
> em órgão real. A organização 1 (Moreira Sales) contém referências reais e só pode ser usada com autorização expressa para o processo
> escolhido. Nada aqui cria processo, documento ou decisão.

## 0. Antes de começar (uma vez por órgão)
- [ ] Autorização escrita para o processo-piloto: órgão, número do processo e pessoas envolvidas.
- [ ] Membros reais no órgão com o papel certo:
  - `operator` elabora;
  - `manager` emite as versões preparatórias.
  - Admin de plataforma **não** age pelo órgão.
- [ ] Perfil de Licitações do órgão preenchido uma vez: identidade, plataforma e políticas. Sem dados fictícios.
- [ ] Modelo institucional do Edital publicado e vinculado pelo órgão, com evidência jurídica conforme a política do próprio órgão.

## 1. DFD
- [ ] Criar o processo e preencher o DFD com a demanda real. Os dados já informados são reaproveitados nas etapas seguintes.
- [ ] Conferir unidade, responsável e itens com quantidade prevista.

## 2. Pesquisa de preços e itens
- [ ] Importar as cotações reais e conferir a origem de cada uma (fonte, data, fornecedor).
- [ ] Preço fictício ou demonstrativo **bloqueia** a emissão. Substituir por cotação real.
- [ ] Aprovar os itens e conferir o valor estimado e a data-base do orçamento.

## 3. ETP e TR
- [ ] Gerar o ETP e o TR pelo fluxo do processo e revisar o texto completo. Toda saída de IA é rascunho editável.
- [ ] Resolver os marcadores `[REVISAR]`: informar o dado ou redigir o trecho. Nunca apagar o marcador sem resolver.
- [ ] Preencher os parâmetros estruturados do TR.
- [ ] Emitir o TR, que vira a versão imutável que instrui o processo.
  - Quem elaborou e tem papel `manager` pode emitir.
  - Exportar o DOCX/PDF na aba TR: esse é o **Anexo I** vinculante do Edital.

## 4. Edital
- [ ] Na preparação do Edital, completar só as decisões do certame que estiverem pendentes. O que já é conhecido vem preenchido.
- [ ] Confirmar o **TR oficial exato** (versão emitida) e compor a minuta pelo modelo.
- [ ] No painel "Revisão do modelo institucional", redigir cada trecho pendente.
  - Usar "Não há conteúdo adicional" só onde o modelo permite.
  - Nos trechos em linha, a pontuação final da frase já está no modelo.
- [ ] Revisar o texto inteiro. Alterar um trecho depois de resolvido exige registrá-lo de novo.
- [ ] Emitir o Edital. Pendências **vinculantes** impedem a emissão:
  - marcadores;
  - trechos sem resolução;
  - fonte alterada;
  - preço fictício;
  - TR não emitido.
- [ ] Pendências **informativas** (ex.: dados de publicação "A DEFINIR") não impedem a emissão, mas precisam ser resolvidas antes da publicação.

## 5. Exportação e conjunto documental
- [ ] Exportar o Edital emitido em DOCX e PDF. O conteúdo é o mesmo nos dois; a paginação pode variar entre os formatos.
- [ ] Juntar o Edital e o TR emitido (Anexo I). O Edital cita o TR como "versão oficial emitida no processo".
  - A versão exata fica no manifesto da emissão.
  - Se o TR for reemitido depois, o Edital precisa de nova emissão.
- [ ] Conferir: identificação do órgão, número do processo, versão emitida, anexos I a IV (ou V, em SRP) e quadro de itens legível.

## 6. Atos distintos, fora da emissão
- [ ] **Análise jurídica (parecer):** pela procuradoria, no fluxo de Parecer. Emitir não é parecer.
- [ ] **Aprovação institucional e autorização da publicação:** pela autoridade competente do órgão.
- [ ] **Publicação externa** (PNCP, plataforma, diário): ato próprio do órgão. O LiciGov Pro não publica.

## 7. Registro do piloto
- [ ] Anotar, sem dados pessoais, o tempo por etapa, as pendências encontradas e os ajustes de texto feitos pelo servidor.
- [ ] Toda evidência é do servidor real. Automação e IA não registram atos humanos (CLAUDE.md, "Agentes de IA, confirmações humanas e evidências").
