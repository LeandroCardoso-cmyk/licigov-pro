import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import "./landing.css";

/**
 * Landing institucional do LiciGov Pro.
 *
 * Port fiel do design produzido no Claude Design (opção A: reconstrução como componente React,
 * sem HTML standalone de ~5,8 MB embutido). O visual vive em `./landing.css`, com tokens
 * ESCOPADOS em `.lgv-landing` (não vazam para o design system shadcn/Tailwind do app) e modo
 * escuro atrelado à classe `.dark` do ThemeProvider.
 *
 * CTAs reais (sem âncoras mortas):
 *  - "Entrar"                    → /login
 *  - "Agendar demonstração" /
 *    "Solicitar proposta" /
 *    "Falar com um especialista" → /solicitar-proposta (fluxo comercial já existente)
 *  - Âncoras internas (#produto…) → navegação entre seções da própria página.
 *
 * Toda saída de IA descrita aqui é apresentada como supervisionada, explicável e auditável —
 * coerente com o PRODUCT_NORTH_STAR (IA nunca protagonista; revisão humana obrigatória).
 */

const LOGO = "/landing/logo-lockup.png";
const PROPOSAL = "/solicitar-proposta";

const CAPACIDADES: { titulo: string; itens: string[] }[] = [
  {
    titulo: "Instrumentos de contratação",
    itens: [
      "DFD — Documento de Formalização",
      "ETP — Estudo Técnico Preliminar",
      "Termo de Referência",
      "Editais e minutas",
      "Contratações diretas",
    ],
  },
  {
    titulo: "Gestão contratual",
    itens: ["Contratos administrativos", "Termos aditivos", "Vencimentos e prazos", "Central de Controle"],
  },
  {
    titulo: "Catálogos e padrões",
    itens: ["CATMAT", "CATSER", "Modelos institucionais", "Consulta normativa"],
  },
  {
    titulo: "Inteligência e governança",
    itens: [
      "IA supervisionada",
      "Workflow e colaboração",
      "Histórico e versionamento",
      "Auditoria e rastreabilidade",
    ],
  },
];

const FLUXO: { n: string; nome: string; desc: string; artigo: string }[] = [
  { n: "01", nome: "DFD", desc: "Formaliza a demanda", artigo: "Art. 12, VII" },
  { n: "02", nome: "ETP", desc: "Estuda a viabilidade", artigo: "Art. 18" },
  { n: "03", nome: "TR", desc: "Referencia o objeto", artigo: "Art. 6º, XXIII" },
  { n: "04", nome: "Edital", desc: "Publica com segurança", artigo: "Art. 25" },
  { n: "05", nome: "Contrato", desc: "Formaliza a execução", artigo: "Art. 89" },
  { n: "06", nome: "Aditivos", desc: "Gerencia alterações", artigo: "Art. 124" },
];

const CENTRAL_BULLETS = [
  "Andamento das contratações",
  "Documentos pendentes",
  "Responsáveis e aprovações",
  "Contratos e aditivos",
  "Vencimentos e prazos",
  "Alertas e indicadores",
];

const CONTEXTO: { k: string; v: string }[] = [
  { k: "Legislação municipal", v: "Leis e regulamentos próprios do órgão." },
  { k: "Decretos e pareceres", v: "Atos normativos e entendimentos internos." },
  { k: "Modelos internos", v: "Padrões e minutas já adotados pelo setor." },
  { k: "Tribunal de Contas competente", v: "Orientações do TC do seu estado, quando disponibilizadas." },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  // Reutiliza o mecanismo canônico de tema (ThemeProvider) — sem localStorage paralelo. O botão
  // do header alterna explicitamente light↔dark via toggleTheme; a preferência persiste e o
  // dark mode da landing continua governado por `.dark .lgv-landing`.
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lgv-landing">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="lgv-header" data-scrolled={scrolled}>
        <div className="lgv-header-inner">
          <a href="#topo" className="lgv-brand">
            <img src={LOGO} alt="LiciGov Pro" />
          </a>
          <nav aria-label="Navegação principal" className="lgv-nav">
            <span className="lgv-nav-sections">
              <a href="#produto" className="lgv-nav-link">
                A plataforma
              </a>
              <a href="#capacidades" className="lgv-nav-link">
                Capacidades
              </a>
              <a href="#central" className="lgv-nav-link">
                Central de Controle
              </a>
              <a href="#fluxo" className="lgv-nav-link">
                Fluxo
              </a>
            </span>
            <span className="lgv-nav-actions">
              <button
                type="button"
                onClick={toggleTheme}
                className="lgv-btn lgv-btn-icon"
                aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
                title={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
              >
                {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
              </button>
              <Link href="/login" className="lgv-btn lgv-btn-ghost">
                Entrar
              </Link>
              <Link href={PROPOSAL} className="lgv-btn lgv-btn-navy">
                Agendar demonstração
              </Link>
            </span>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section id="topo" className="lgv-hero">
        <div aria-hidden="true" className="lgv-hero-overlay" />
        <div className="lgv-hero-grid lgv-fade-up">
          <div>
            <span className="lgv-eyebrow">
              <span style={{ width: 24, height: 1, background: "var(--brass)", display: "inline-block" }} />O sistema
              operacional do departamento de licitações
            </span>
            <h1 className="lgv-hero-h1">Todo o seu departamento de licitações, organizado em uma só plataforma.</h1>
            <p className="lgv-hero-sub">
              O LiciGov Pro acompanha toda a jornada da contratação pública — do planejamento à gestão dos Contratos
              Administrativos e Termos Aditivos. Menos retrabalho, documentos padronizados e segurança jurídica, com
              apoio <b>supervisionado, explicável e auditável</b>.
            </p>
            <div className="lgv-hero-cta">
              <Link href={PROPOSAL} className="lgv-btn lgv-btn-brass">
                Agendar demonstração →
              </Link>
              <Link href={PROPOSAL} className="lgv-btn lgv-btn-glass">
                Solicitar proposta
              </Link>
            </div>
            <div className="lgv-hero-trust">
              <span>Fundamentado em</span>
              <b>Lei 14.133</b>
              <span className="lgv-dot" />
              <b>Fontes governadas</b>
              <span className="lgv-dot" />
              <b>Contexto institucional</b>
            </div>
          </div>
          <div className="lgv-hero-figure">
            <div aria-hidden="true" className="lgv-hero-glow" />
            <div className="lgv-hero-card">
              <div className="lgv-hero-card-bar">
                <img src={LOGO} alt="LiciGov Pro" />
                <span className="lgv-hero-card-tag">Ambiente demonstrativo · dados ilustrativos</span>
              </div>
              <img
                className="lgv-shot"
                src="/landing/central-de-controle.png"
                alt="Centro de Operações do LiciGov Pro com visão consolidada de processos, contratos, pareceres, tarefas, solicitações e recomendações do departamento."
              />
            </div>
            <div className="lgv-hero-badge">
              <div className="lgv-hero-badge-k">Preparado para o seu órgão</div>
              <div className="lgv-hero-badge-v">Uma visão única de contratações, prazos e responsáveis.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Posicionamento ─────────────────────────────────────────────────── */}
      <section id="produto" className="lgv-section">
        <div className="lgv-container">
          <div style={{ maxWidth: "64ch" }}>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              Posicionamento
            </span>
            <h2 className="lgv-h2">
              A camada cognitiva e operacional do departamento — não mais um sistema paralelo.
            </h2>
            <p className="lgv-lead" style={{ maxWidth: "60ch" }}>
              O LiciGov Pro organiza, padroniza e dá inteligência à rotina interna do setor. Ele opera ao lado dos seus
              sistemas — e o protagonista é sempre o departamento.
            </p>
          </div>
          <div className="lgv-two-col">
            <div>
              <h3 className="lgv-col-title is-sage">O que ele é</h3>
              <ul className="lgv-check-list is-positive">
                <li>
                  <span className="lgv-mark is-dot" />
                  Sistema operacional do departamento de licitações
                </li>
                <li>
                  <span className="lgv-mark is-dot" />
                  Plataforma operacional e de engenharia documental
                </li>
                <li>
                  <span className="lgv-mark is-dot" />
                  Inteligência documental e apoio técnico-jurídico
                </li>
                <li>
                  <span className="lgv-mark is-dot" />
                  Um copiloto — sempre supervisionado por servidor competente
                </li>
              </ul>
            </div>
            <div>
              <h3 className="lgv-col-title is-brass">O que ele não substitui</h3>
              <ul className="lgv-check-list is-negative">
                <li>
                  <span className="lgv-mark is-square" />
                  ERP municipal, sistemas contábeis e financeiros
                </li>
                <li>
                  <span className="lgv-mark is-square" />
                  Compras.gov e o PNCP
                </li>
                <li>
                  <span className="lgv-mark is-square" />
                  Portais e sistemas de pregão eletrônico
                </li>
                <li>
                  <span className="lgv-mark is-square" />
                  Uma caixa-preta que decide sozinha — nenhum documento se torna oficial sem revisão e ação humana
                  competente
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Capacidades ────────────────────────────────────────────────────── */}
      <section id="capacidades" className="lgv-section lgv-section-paper">
        <div className="lgv-container">
          <div style={{ maxWidth: "64ch" }}>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              A plataforma completa
            </span>
            <h2 className="lgv-h2">Muito mais do que geração de documentos.</h2>
            <p className="lgv-lead" style={{ maxWidth: "60ch" }}>
              Toda a inteligência operacional do departamento reunida — do primeiro estudo à gestão dos contratos, com
              governança e rastreabilidade em cada etapa.
            </p>
          </div>
          <div className="lgv-cap-grid">
            {CAPACIDADES.map((col) => (
              <div key={col.titulo}>
                <h3 className="lgv-cap-title">{col.titulo}</h3>
                <ul className="lgv-cap-list">
                  {col.itens.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Central de Controle ────────────────────────────────────────────── */}
      <section id="central" className="lgv-section">
        <div className="lgv-container">
          <div style={{ maxWidth: "74ch" }}>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              O grande diferencial
            </span>
            <h2 className="lgv-h2">Central de Controle: o departamento inteiro em um só lugar.</h2>
            <p className="lgv-lead" style={{ maxWidth: "64ch" }}>
              O gestor acompanha o andamento de todas as contratações, prazos e responsáveis em um único ambiente — com
              histórico, indicadores e alertas para decidir com clareza e no tempo certo.
            </p>
            <div className="lgv-central-bullets">
              {CENTRAL_BULLETS.map((b) => (
                <div key={b}>
                  <span className="lgv-bullet" />
                  {b}
                </div>
              ))}
            </div>
          </div>
          <figure className="lgv-figure">
            <img
              src="/landing/central-de-controle.png"
              loading="lazy"
              decoding="async"
              alt="Centro de Operações do LiciGov Pro com visão consolidada de processos, contratos, pareceres, tarefas, solicitações e recomendações do departamento."
            />
            <figcaption className="lgv-figcaption">
              Centro de Operações — visão consolidada da rotina do Departamento de Licitações. Ambiente demonstrativo ·
              dados ilustrativos.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Fluxo ──────────────────────────────────────────────────────────── */}
      <section id="fluxo" className="lgv-section lgv-section-paper">
        <div className="lgv-container">
          <div style={{ maxWidth: "64ch" }}>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              O caminho de uma contratação
            </span>
            <h2 className="lgv-h2">Cada etapa reaproveita a anterior. Menos retrabalho e mais consistência.</h2>
            <p className="lgv-lead" style={{ maxWidth: "60ch" }}>
              Do planejamento à gestão do contrato, as informações são reaproveitadas de forma controlada entre os
              instrumentos, com validação e rastreabilidade em cada etapa.
            </p>
          </div>
          <div className="lgv-flow-grid">
            {FLUXO.map((f) => (
              <div key={f.n} className="lgv-flow-card">
                <div className="lgv-flow-n">{f.n}</div>
                <div className="lgv-flow-name">{f.nome}</div>
                <div className="lgv-flow-desc">{f.desc}</div>
                <div className="lgv-flow-art">{f.artigo}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Diferencial técnico (IA) ───────────────────────────────────────── */}
      <section className="lgv-section">
        <div className="lgv-container lgv-split">
          <div>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              O diferencial técnico
            </span>
            <h2 className="lgv-h2">Inteligência que mostra por quê.</h2>
            <p className="lgv-lead" style={{ maxWidth: "58ch" }}>
              A IA é uma das tecnologias que sustentam o produto — nunca a protagonista. Ela estrutura tecnicamente a
              contratação com padronização e mais segurança jurídica, sempre sob supervisão humana.
            </p>
            <div className="lgv-def-list">
              <div>
                <b>Supervisionada</b>
                <span> — o servidor competente revisa e decide.</span>
              </div>
              <div>
                <b>Explicável</b>
                <span>
                  {" "}
                  — o sistema apresenta as fontes e evidências utilizadas, quando disponíveis no contexto governado.
                </span>
              </div>
              <div>
                <b>Auditável</b>
                <span> — versões, fontes, contexto e trilha de execução ficam disponíveis para rastreabilidade.</span>
              </div>
            </div>
          </div>
          <div className="lgv-panel">
            <div className="lgv-panel-head">
              <span style={{ color: "var(--sage)" }}>●</span>
              <b>Rastreabilidade da geração</b>
            </div>
            <div className="lgv-panel-body">
              <div className="lgv-panel-row">
                <span>Documento</span>
                <b>Termo de Referência</b>
              </div>
              <div className="lgv-panel-row">
                <span>Fundamentação</span>
                <b>Art. 6º, XXIII</b>
              </div>
              <div className="lgv-panel-row">
                <span>Fontes</span>
                <b>Federal · Estadual · Municipal</b>
              </div>
              <div className="lgv-panel-row">
                <span>Revisão humana</span>
                <b className="is-sage">Obrigatória</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Consulta normativa ─────────────────────────────────────────────── */}
      <section id="duvidas" className="lgv-section lgv-section-paper">
        <div className="lgv-container lgv-consulta">
          <figure className="lgv-consulta-figure">
            <img
              src="/landing/consulta-normativa.png"
              loading="lazy"
              decoding="async"
              alt="Consulta normativa do LiciGov Pro com pergunta sobre contratação direta, resposta fundamentada e referência à Lei 14.133."
            />
            <figcaption className="lgv-figcaption">Ambiente demonstrativo · dados ilustrativos</figcaption>
          </figure>
          <div>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              Consulta normativa
            </span>
            <h2 className="lgv-h2">Perguntou, a norma responde.</h2>
            <p className="lgv-lead" style={{ maxWidth: "58ch" }}>
              Uma ferramenta institucional de consulta técnica — não apenas um chatbot. O LiciGov Pro utiliza as fontes
              governadas disponíveis no contexto do órgão e apresenta fundamentação e referências rastreáveis,
              preservando a decisão sob responsabilidade do servidor competente.
            </p>
            <div className="lgv-note">
              <div>
                <b style={{ display: "block", marginBottom: 4 }}>Sem fundamento verificável, o sistema não conclui</b>
                <span>
                  Quando o conjunto de fontes disponível não oferece evidência suficiente, o sistema sinaliza a
                  limitação em vez de apresentar uma conclusão como se estivesse fundamentada.
                </span>
              </div>
              <div>
                <b>Histórico durável</b>
                <span> — auditável e isolado por município.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Inteligência contextual ────────────────────────────────────────── */}
      <section className="lgv-section">
        <div className="lgv-container">
          <div style={{ maxWidth: "64ch" }}>
            <span className="lgv-eyebrow" style={{ marginBottom: 14, display: "inline-block" }}>
              Inteligência contextual
            </span>
            <h2 className="lgv-h2">
              Cada município tem a sua realidade. O LiciGov Pro foi preparado para operar com o contexto institucional do
              seu órgão.
            </h2>
            <p className="lgv-lead" style={{ maxWidth: "60ch" }}>
              Além da legislação federal, o sistema pode operar com a legislação municipal, decretos, pareceres, modelos
              internos e orientações do Tribunal de Contas competente — quando essas fontes fizerem parte do contexto
              institucional disponibilizado ao órgão.
            </p>
          </div>
          <div className="lgv-context-grid">
            {CONTEXTO.map((c) => (
              <div key={c.k} className="lgv-context-cell">
                <div className="k">{c.k}</div>
                <div className="v">{c.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Autoridade ─────────────────────────────────────────────────────── */}
      <section className="lgv-authority">
        <div className="lgv-authority-inner">
          <span className="lgv-eyebrow" style={{ marginBottom: 16, display: "inline-block", color: "var(--brass)" }}>
            Feito por quem vive a rotina
          </span>
          <h2>
            Desenvolvido por profissionais que vivem, diariamente, a realidade dos departamentos de licitações públicas.
          </h2>
          <p>
            Cada decisão de produto nasce da prática real do serviço público — não de suposições. É essa vivência que
            torna o LiciGov Pro rigoroso na forma e seguro no conteúdo.
          </p>
        </div>
      </section>

      {/* ── CTA final ──────────────────────────────────────────────────────── */}
      <section id="proposta" className="lgv-section">
        <div className="lgv-container">
          <div className="lgv-cta-card">
            <div className="lgv-cta-inner">
              <div style={{ maxWidth: "44ch" }}>
                <h2 className="lgv-cta-h2">Um Departamento de Licitações mais organizado, seguro e inteligente.</h2>
                <p className="lgv-cta-p">
                  Menos retrabalho, mais segurança jurídica e inteligência institucional em cada contratação — do
                  planejamento à gestão dos Contratos Administrativos e Termos Aditivos, sempre com supervisão humana.
                  Fale com um especialista e leve o LiciGov Pro para o seu órgão.
                </p>
              </div>
              <div className="lgv-cta-actions">
                <Link href={PROPOSAL} className="lgv-btn lgv-btn-navy" style={{ justifyContent: "center" }}>
                  Agendar demonstração →
                </Link>
                <Link href={PROPOSAL} className="lgv-btn lgv-btn-outline">
                  Solicitar proposta
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="lgv-footer">
        <div className="lgv-container">
          <div className="lgv-footer-grid">
            <div className="lgv-footer-brand">
              <img src={LOGO} alt="LiciGov Pro" loading="lazy" decoding="async" />
              <p>A camada cognitiva e operacional do departamento de licitações públicas.</p>
            </div>
            <div>
              <div className="lgv-footer-h">Contato</div>
              <ul className="lgv-footer-list">
                <li>
                  <Link href={PROPOSAL}>Agendar demonstração</Link>
                </li>
                <li>
                  <Link href={PROPOSAL}>Solicitar proposta</Link>
                </li>
                <li>
                  <Link href={PROPOSAL}>Falar com um especialista</Link>
                </li>
              </ul>
            </div>
            <div>
              <div className="lgv-footer-h">Legal</div>
              <ul className="lgv-footer-list">
                <li>
                  <Link href="/privacidade">Política de Privacidade</Link>
                </li>
                <li>
                  <Link href="/termos">Termos de Uso</Link>
                </li>
              </ul>
            </div>
            <div>
              <div className="lgv-footer-h">Empresa</div>
              <div className="lgv-footer-note">Desenvolvido para apoiar contratações sob a Lei nº 14.133/2021</div>
            </div>
          </div>
          <div className="lgv-footer-bottom">
            <span>© {new Date().getFullYear()} LiciGov Pro. Todos os direitos reservados.</span>
            <span>Nova Lei de Licitações · Lei nº 14.133/2021</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
