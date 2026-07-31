import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import helmet from "helmet";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import {
  buildCspDirectives,
  buildHelmetContentSecurityPolicy,
  isCspEnabled,
  isAnalyticsAllowed,
  ANALYTICS_SCRIPT_SRC,
} from "../../config/csp";

/**
 * SEC-036 — homologação da CSP: landing e login sem violação, mantendo a política restritiva.
 *
 * A landing e a tela de login compartilham o MESMO shell (`client/index.html`), então testar o
 * shell + o header cobre "scripts da landing" e "scripts do login".
 */

function startAppWithCsp(allowAnalytics: boolean): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: buildCspDirectives(allowAnalytics) },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.get("/", (_req, res) => res.status(200).send("<!doctype html><html></html>"));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function getCspHeader(allowAnalytics: boolean): Promise<string> {
  const { server, base } = await startAppWithCsp(allowAnalytics);
  try {
    const res = await fetch(`${base}/`);
    return res.headers.get("content-security-policy") ?? "";
  } finally {
    server.close();
  }
}

describe("SEC-036 — header Content-Security-Policy", () => {
  it("emite CSP com script-src 'self' e SEM 'unsafe-inline' (sem enfraquecer scripts)", async () => {
    const csp = await getCspHeader(false);
    expect(csp).toContain("script-src 'self'");
    // ausência de unsafe-inline GLOBAL em scripts é a garantia central do SEC-036
    const scriptSrc = csp.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("*");
  });

  it("mantém diretivas restritivas (object-src none, frame-ancestors self, base-uri self)", async () => {
    const csp = await getCspHeader(false);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("por padrão (analítica desligada) NÃO libera nenhum domínio do Google", async () => {
    const csp = await getCspHeader(false);
    expect(csp).not.toContain("googletagmanager.com");
    expect(csp).not.toContain("google-analytics.com");
  });

  it("com analítica habilitada, libera APENAS os domínios exatos do Google nas diretivas certas", async () => {
    const csp = await getCspHeader(true);
    const dir = (name: string) => csp.split(";").find((d) => d.trim().startsWith(name)) ?? "";
    expect(dir("script-src")).toContain("https://www.googletagmanager.com");
    expect(dir("connect-src")).toContain("https://www.google-analytics.com");
    expect(dir("connect-src")).toContain("https://region1.google-analytics.com");
    expect(dir("img-src")).toContain("https://www.googletagmanager.com");
    // mesmo habilitada, nada de wildcard amplo em script-src, e sem unsafe-inline
    expect(dir("script-src")).not.toContain("'unsafe-inline'");
    expect(dir("script-src")).not.toMatch(/\bhttps:\s|(^|\s)\*($|\s)/);
  });
});

describe("SEC-036 — buildCspDirectives (unidade)", () => {
  it("script-src nunca contém 'unsafe-inline' nem wildcard, com ou sem analítica", () => {
    for (const allow of [false, true]) {
      const d = buildCspDirectives(allow);
      expect(d.scriptSrc).toContain("'self'");
      expect(d.scriptSrc).not.toContain("'unsafe-inline'");
      expect(d.scriptSrc).not.toContain("*");
      expect(d.scriptSrc).not.toContain("https:");
      expect(d.scriptSrcAttr).toEqual(["'none'"]);
    }
  });

  it("'unsafe-inline' é permitido SOMENTE em style-src (Recharts/TipTap), não em scripts", () => {
    const d = buildCspDirectives(false);
    expect(d.styleSrc).toContain("'unsafe-inline'");
    expect(d.scriptSrc).not.toContain("'unsafe-inline'");
  });

  it("domínios de analítica entram só quando habilitada", () => {
    const off = buildCspDirectives(false);
    expect(off.scriptSrc).not.toContain(ANALYTICS_SCRIPT_SRC[0]);
    expect(off.connectSrc).toEqual(["'self'"]);

    const on = buildCspDirectives(true);
    expect(on.scriptSrc).toContain(ANALYTICS_SCRIPT_SRC[0]);
    expect(on.connectSrc.length).toBeGreaterThan(1);
  });

  it("img-src cobre self/data/blob (downloads viram blob:) e nenhum host S3 direto", () => {
    const d = buildCspDirectives(false);
    expect(d.imgSrc).toEqual(["'self'", "data:", "blob:"]);
    expect(d.imgSrc.join(" ")).not.toContain("amazonaws");
  });
});

describe("SEC-036 — gates de ambiente", () => {
  const prev = { csp: process.env.HELMET_CSP_ENABLED, ga: process.env.CSP_ALLOW_ANALYTICS };
  beforeEach(() => {
    delete process.env.HELMET_CSP_ENABLED;
    delete process.env.CSP_ALLOW_ANALYTICS;
  });
  afterEach(() => {
    process.env.HELMET_CSP_ENABLED = prev.csp;
    process.env.CSP_ALLOW_ANALYTICS = prev.ga;
  });

  it("em development a CSP fica desligada por padrão e ligável via HELMET_CSP_ENABLED=true", () => {
    // a suíte roda com APP_ENV=development
    expect(isCspEnabled()).toBe(false);
    expect(buildHelmetContentSecurityPolicy()).toBe(false);
    process.env.HELMET_CSP_ENABLED = "true";
    expect(isCspEnabled()).toBe(true);
    const helmetCsp = buildHelmetContentSecurityPolicy();
    expect(helmetCsp).not.toBe(false);
    expect((helmetCsp as { directives: unknown }).directives).toBeTruthy();
  });

  it("analítica desligada por padrão; habilitada só com CSP_ALLOW_ANALYTICS=true", () => {
    expect(isAnalyticsAllowed()).toBe(false);
    process.env.CSP_ALLOW_ANALYTICS = "true";
    expect(isAnalyticsAllowed()).toBe(true);
  });
});

describe("SEC-036 — shell da landing/login (client/index.html)", () => {
  const root = process.cwd();
  const html = fs.readFileSync(path.resolve(root, "client/index.html"), "utf-8");

  it("não contém NENHUM script inline executável (só <script src=...>)", () => {
    // captura qualquer <script ...>...</script> com corpo não-vazio
    const inlineWithBody = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i;
    expect(inlineWithBody.test(html)).toBe(false);
  });

  it("não referencia googletagmanager/gtag no shell (GA saiu do index.html)", () => {
    expect(html).not.toContain("googletagmanager");
    expect(html).not.toMatch(/gtag\(/);
    expect(html).not.toContain("G-N0PT3PG3R1");
  });

  it("carrega o tema externalizado (/theme-init.js) e o bundle do app", () => {
    expect(html).toContain('src="/theme-init.js"');
    expect(html).toContain('src="/src/main.tsx"');
  });

  it("o arquivo /theme-init.js existe e é servido a partir de 'self' (client/public)", () => {
    const p = path.resolve(root, "client/public/theme-init.js");
    expect(fs.existsSync(p)).toBe(true);
    const js = fs.readFileSync(p, "utf-8");
    expect(js).toContain("classList.toggle");
  });
});
