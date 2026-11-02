const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");
const createPurify = require("dompurify");
const { marked } = require("marked");
const source = (name) => readFileSync(`public/${name}`, "utf8");
const id = "94229143-d20b-4766-80a4-05341435c236";
async function settle() {
  for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r));
}
function setup(handler, saved = {}) {
  const dom = new JSDOM(source("index.html"), {
    url: "https://chat.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const calls = [];
  w.matchMedia = () => ({ matches: false });
  w.marked = marked;
  w.DOMPurify = createPurify(w);
  w.ASTRO_CONFIG = { apiBaseUrl: "https://ia.astro-app.sbs/", markdown: true };
  Object.entries(saved).forEach(([key, val]) =>
    w.sessionStorage.setItem(key, val),
  );
  w.fetch = async (url, options) => {
    const call = {
      path: url.replace("https://ia.astro-app.sbs", ""),
      ...options,
      body: options.body ? JSON.parse(options.body) : undefined,
    };
    calls.push(call);
    const result = await handler(call);
    return {
      ok: typeof result.status !== "number" || result.status < 400,
      status: typeof result.status === "number" ? result.status : 200,
      headers: { get: () => "application/json" },
      json: async () => result.data ?? result,
    };
  };
  w.eval(source("blocks.js"));
  w.eval(source("app.js"));
  const $ = (s) => w.document.querySelector(s);
  async function login() {
    $("#email").value = "pessoa@example.com";
    $("#password").value = "test-only";
    $("#login-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
  }
  async function send(text) {
    $("#message-input").value = text;
    $("#message-input").dispatchEvent(new w.Event("input"));
    $("#chat-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
    await settle();
  }
  return { dom, w, $, calls, login, send, close: () => dom.window.close() };
}
function base(call) {
  if (call.path === "/auth/login")
    return { access_token: "fixture-token", expires_in: 3600 };
  if (call.path.startsWith("/sessions?"))
    return { sessions: [], next_cursor: null };
  throw new Error(`Unexpected request ${call.path}`);
}
test("creates a session without UUID, renders ordered blocks once and continues the returned UUID", async () => {
  const app = setup((c) =>
    c.path.startsWith("/chat/messages")
      ? {
          session_id: id,
          agentes_chamados: ["agenda"],
          blocos: [
            { tipo: "texto", conteudo: "**Resposta**" },
            {
              tipo: "tabela",
              versao: 2,
              titulo: "Pessoas",
              colunas: [{ chave: "nome", titulo: "Nome" }],
              linhas: [{ nome: "Ana" }],
              total: 1,
            },
          ],
        }
      : base(c),
  );
  try {
    await app.login();
    await app.send("Olá");
    assert.equal(app.$("#chat-view").hidden, false);
    const first = app.calls.find((c) => c.path.startsWith("/chat/messages"));
    assert.deepEqual(first.body, { message: "Olá" });
    assert.match(first.headers.Authorization, /Bearer fixture-token/);
    assert.equal(app.$("#messages strong").textContent, "Resposta");
    assert.equal(app.$("caption").textContent, "Pessoas");
    assert.equal(app.$("#message-input").value, "");
    await app.send("Continue");
    assert.equal(
      app.calls.filter((c) => c.path.startsWith("/chat/messages"))[1].body
        .session_id,
      id,
    );
    assert.equal(app.w.sessionStorage.getItem("astro.test.messages"), null);
  } finally {
    app.close();
  }
});
test("opens old history using content and resumes a closed session only on send", async () => {
  const app = setup((c) => {
    if (c.path.startsWith("/sessions?"))
      return {
        sessions: [
          {
            session_id: id,
            title: "Conversa antiga",
            last_message_preview: "Olá",
          },
        ],
        next_cursor: null,
      };
    if (c.path.endsWith("/messages"))
      return {
        session_id: id,
        status: "encerrada",
        mensagens: [{ role: "assistant", content: "Mensagem antiga" }],
      };
    if (c.path.endsWith("/iniciar")) return { session_id: id, status: "ativa" };
    if (c.path.startsWith("/chat/messages"))
      return {
        session_id: id,
        blocos: [{ tipo: "texto", conteudo: "Retomada" }],
      };
    return base(c);
  });
  try {
    await app.login();
    app.$(".history-item").click();
    await settle();
    assert.match(
      app.$("#messages").textContent,
      /Mensagem antiga/,
      JSON.stringify({ calls: app.calls, toast: app.$("#toast").textContent }),
    );
    assert.equal(
      app.calls.some((c) => c.path.endsWith("/iniciar")),
      false,
    );
    await app.send("Continuar");
    const paths = app.calls.map((c) => c.path);
    assert(
      paths.findIndex((p) => p.endsWith("/iniciar")) <
        paths.findIndex((p) => p.startsWith("/chat/messages")),
    );
    assert.equal(
      app.calls.find((c) => c.path.endsWith("/iniciar")).body,
      undefined,
    );
    assert(!paths.some((p) => p.includes("encerrar")));
  } finally {
    app.close();
  }
});
test("double submit sends only one POST, new conversation does not close the old one", async () => {
  let complete;
  const pending = new Promise((r) => (complete = r));
  const app = setup((c) =>
    c.path.startsWith("/chat/messages") ? pending : base(c),
  );
  try {
    await app.login();
    await app.send("Uma vez");
    await app.send("Outra");
    assert.equal(
      app.calls.filter((c) => c.path.startsWith("/chat/messages")).length,
      1,
    );
    assert.equal(app.$("#logout").disabled, true);
    complete({ session_id: id, blocos: [{ tipo: "texto", conteudo: "Ok" }] });
    await settle();
    app.$("#new-chat").click();
    assert.equal(app.$("#session-id").textContent, "Nova conversa");
    assert(app.$(".welcome-card"));
    assert(!app.calls.some((c) => c.path.includes("encerrar")));
  } finally {
    app.close();
  }
});
test("401 clears private state and goes back to login", async () => {
  const app = setup((c) =>
    c.path.startsWith("/chat/messages")
      ? { status: 401, data: { detail: "expired" } }
      : base(c),
  );
  try {
    await app.login();
    await app.send("Pergunta");
    assert.equal(app.$("#login-view").hidden, false);
    assert.equal(app.w.sessionStorage.getItem("astro.test.token"), null);
    assert.equal(app.$("#history-list").children.length, 0);
    assert.equal(app.$("#logout").disabled, false);
  } finally {
    app.close();
  }
});
test("network failure preserves draft and never retries creation automatically", async () => {
  const app = setup((c) => {
    if (c.path.startsWith("/chat/messages"))
      throw new app.w.TypeError("network");
    return base(c);
  });
  try {
    await app.login();
    await app.send("Minha pergunta");
    assert.equal(app.$("#message-input").value, "Minha pergunta");
    assert.equal(
      app.calls.filter((c) => c.path.startsWith("/chat/messages")).length,
      1,
    );
    assert.match(app.$("#messages").textContent, /Confira as conversas/);
  } finally {
    app.close();
  }
});
test("504 reconciles known history before another send without duplicating a persisted turn", async () => {
  let sent = false;
  const app = setup(
    (c) => {
      if (c.path.endsWith("/messages"))
        return {
          session_id: id,
          status: "ativa",
          mensagens: sent
            ? [
                { role: "user", content: "Pergunta" },
                { role: "assistant", content: "Recebida" },
              ]
            : [],
        };
      if (c.path.startsWith("/chat/messages")) {
        sent = true;
        return { status: 504, data: { detail: "timeout" } };
      }
      return base(c);
    },
    {
      "astro.test.token": "token",
      "astro.test.expiresAt": String(Date.now() + 3600000),
      "astro.test.sessionId": id,
    },
  );
  try {
    await settle();
    await app.send("Pergunta");
    assert.match(
      app.$("#messages").textContent,
      /Recebida/,
      JSON.stringify({ calls: app.calls, toast: app.$("#toast").textContent }),
    );
    assert.equal(app.$("#message-input").value, "");
    assert.equal(
      app.calls.filter((c) => c.path.startsWith("/chat/messages")).length,
      1,
    );
  } finally {
    app.close();
  }
});
test("session pagination uses opaque cursor, deduplicates and stops at null", async () => {
  let n = 0;
  const app = setup((c) =>
    c.path.startsWith("/sessions?")
      ? {
          sessions: [{ session_id: id, title: "A" }],
          next_cursor: ++n === 1 ? "opaque+/=" : null,
        }
      : base(c),
  );
  try {
    await app.login();
    app.$("#more-history").click();
    await settle();
    assert(app.calls.some((c) => c.path.includes("cursor=opaque%2B%2F%3D")));
    assert.equal(app.$("#history-list").children.length, 1);
    assert.equal(app.$("#more-history").hidden, true);
  } finally {
    app.close();
  }
});
test("table v2 paginates locally, preserves zero and never sends a request to change page", async () => {
  const app = setup(base);
  try {
    const before = app.calls.length;
    const el = app.w.AstroBlocks.render(
      {
        tipo: "tabela",
        versao: 2,
        titulo: "Registros",
        colunas: [{ chave: "n", titulo: "Número" }],
        linhas: Array.from({ length: 25 }, (_, n) => ({ n })),
        total: 100,
        tem_mais: true,
        limitado: true,
        motivo_limite: "tamanho_resposta",
      },
      String,
    );
    app.w.document.body.append(el);
    assert.equal(el.querySelectorAll("tbody tr").length, 10);
    assert.equal(el.querySelector("td").textContent, "0");
    el.querySelectorAll("button")[1].click();
    assert.equal(el.querySelector("td").textContent, "10");
    assert.equal(app.calls.length, before);
    assert.match(el.textContent, /25 registros recebidos de 100/);
    assert.match(el.textContent, /tamanho/);
  } finally {
    app.close();
  }
});
test("unknown blocks and versions fall back without executing their content", () => {
  const app = setup(base);
  try {
    for (const block of [
      { tipo: "alien", conteudo: "<script>x</script>" },
      { tipo: "tabela", versao: 99 },
    ]) {
      const el = app.w.AstroBlocks.render(block, String);
      assert.match(el.textContent, /formato ainda não disponível/);
      assert.equal(el.querySelector("script"), null);
    }
  } finally {
    app.close();
  }
});
test("PDF expiry and HTTPS are enforced; exported text omits signed URLs", () => {
  const app = setup(base);
  try {
    const block = {
      tipo: "arquivo",
      versao: 1,
      nome: "relatorio.pdf",
      estado: "disponivel",
      url: "https://files.example/private?signature=secret",
      expira_em: new Date(Date.now() + 3600000).toISOString(),
    };
    assert(app.w.AstroBlocks.render(block, String).querySelector("a"));
    assert(
      !app.w.AstroBlocks.render(
        { ...block, expira_em: "2020-01-01" },
        String,
      ).querySelector("a"),
    );
    assert(
      !app.w.AstroBlocks.render(
        { ...block, url: "javascript:alert(1)" },
        String,
      ).querySelector("a"),
    );
    assert(!app.w.AstroBlocks.toText(block).includes("signature"));
  } finally {
    app.close();
  }
});
test("indicators preserve null and zero; profile omits absent fields", () => {
  const app = setup(base);
  try {
    const el = app.w.AstroBlocks.render(
      {
        tipo: "indicadores",
        versao: 1,
        universo: "Equipe",
        indicadores: [
          {
            rotulo: "Percentual",
            valor: null,
            unidade: "%",
            criterio: "Sem base",
          },
          {
            rotulo: "Pessoas",
            valor: 0,
            unidade: "pessoas",
            criterio: "Total",
          },
        ],
      },
      String,
    );
    assert.match(el.textContent, /Não se aplica/);
    assert.match(el.textContent, /0 pessoas/);
    const profile = app.w.AstroBlocks.render(
      {
        tipo: "ficha_usuario",
        versao: 1,
        titulo: "Meu perfil",
        nome: null,
        cargo: "Analista",
        modalidade: "HIBRIDO",
        foto: { url: null },
      },
      String,
    );
    assert.match(profile.textContent, /Analista/);
    assert(!profile.textContent.includes("Conformidade"));
    assert.equal(profile.querySelectorAll("dt").length, 2);
  } finally {
    app.close();
  }
});
test("Markdown is sanitized and user text is never interpreted as HTML", async () => {
  const app = setup((c) =>
    c.path.startsWith("/chat/messages")
      ? {
          session_id: id,
          blocos: [
            {
              tipo: "texto",
              conteudo:
                "<img src=x onerror=alert(1)><script>alert(1)</script>[ruim](javascript:alert(1))",
            },
          ],
        }
      : base(c),
  );
  try {
    await app.login();
    await app.send("<img src=x onerror=alert(1)>");
    assert.equal(app.$("#messages script"), null);
    assert.equal(app.$("#messages img"), null);
    assert.equal(app.$("#messages a")?.getAttribute("href"), null);
    assert.match(app.$(".message.user").textContent, /<img/);
  } finally {
    app.close();
  }
});
