(() => {
  "use strict";
  const config = window.ASTRO_CONFIG || {};
  const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/+$/, "");
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    loginView: $("#login-view"),
    chatView: $("#chat-view"),
    loginForm: $("#login-form"),
    email: $("#email"),
    password: $("#password"),
    togglePassword: $("#toggle-password"),
    loginButton: $("#login-button"),
    loginError: $("#login-error"),
    chatForm: $("#chat-form"),
    messageInput: $("#message-input"),
    sendButton: $("#send-button"),
    messages: $("#messages"),
    sessionId: $("#session-id"),
    copySession: $("#copy-session"),
    newChat: $("#new-chat"),
    logout: $("#logout"),
    toast: $("#toast"),
    apiStatus: $("#api-status"),
    exportChat: $("#export-chat"),
    historyList: $("#history-list"),
    moreHistory: $("#more-history"),
    characterCount: $("#character-count"),
    accountName: $("#account-name"),
    accountAvatar: $("#account-avatar"),
  };
  const keys = {
    token: "astro.test.token",
    expires: "astro.test.expiresAt",
    session: "astro.test.sessionId",
    account: "astro.account",
  };
  const welcomeMarkup = elements.messages.innerHTML;
  let token = "",
    sessionId = "",
    sessionStatus = "ativa",
    transcript = [],
    sessions = [],
    nextCursor = null;
  let busy = false,
    listing = false,
    toastTimer,
    generation = 0;
  const controllers = new Set();
  const storage = {
    get(key) {
      try {
        return sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value) sessionStorage.setItem(key, value);
        else sessionStorage.removeItem(key);
      } catch {
        /* Keep the current session usable when storage is unavailable. */
      }
    },
  };
  let tokenExpiresAt = Number(storage.get(keys.expires) || 0);
  // Photos and signed file links stay in memory. History is always reloaded from the API.
  storage.set("astro.test.messages", "");
  function toast(text) {
    clearTimeout(toastTimer);
    elements.toast.textContent = text;
    elements.toast.classList.add("visible");
    toastTimer = setTimeout(
      () => elements.toast.classList.remove("visible"),
      4000,
    );
  }
  function status(text, state = "") {
    elements.apiStatus.className = `api-status ${state}`;
    elements.apiStatus.lastChild.textContent = ` ${text}`;
  }
  function updateComposer() {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 144)}px`;
    elements.characterCount.textContent = `${elements.messageInput.value.length.toLocaleString("pt-BR")} / 4.000`;
    elements.sendButton.disabled =
      busy ||
      !elements.messageInput.value.trim() ||
      sessionStatus === "encerrando";
  }
  function setBusy(value) {
    busy = value;
    elements.messageInput.disabled = value;
    elements.newChat.disabled = value;
    elements.logout.disabled = value;
    elements.messages.setAttribute("aria-busy", String(value));
    elements.historyList
      .querySelectorAll("button")
      .forEach((b) => (b.disabled = value));
    elements.moreHistory.disabled = value || listing;
    updateComposer();
  }
  function label() {
    elements.sessionId.textContent = sessionId || "Nova conversa";
    elements.copySession.disabled = !sessionId;
    elements.copySession.title = sessionId
      ? `Copiar sessão ${sessionId}`
      : "Envie uma mensagem para criar a sessão";
    elements.exportChat.disabled = !transcript.length;
    elements.historyList.querySelectorAll("[data-session]").forEach((b) => {
      b.classList.toggle("active", b.dataset.session === sessionId);
      if (b.dataset.session === sessionId)
        b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    });
  }
  function scroll() {
    requestAnimationFrame(
      () => (elements.messages.scrollTop = elements.messages.scrollHeight),
    );
  }
  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }
  function markdown(value) {
    if (config.markdown !== false && window.marked && window.DOMPurify) {
      const template = document.createElement("template");
      template.innerHTML = window.DOMPurify.sanitize(
        window.marked.parse(String(value), { gfm: true, breaks: true }),
        {
          USE_PROFILES: { html: true },
          FORBID_TAGS: [
            "style",
            "iframe",
            "form",
            "input",
            "button",
            "img",
            "video",
            "audio",
            "source",
          ],
          FORBID_ATTR: ["style"],
        },
      );
      template.content.querySelectorAll("a").forEach((a) => {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      });
      return template.innerHTML;
    }
    return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
  }
  function messageText(item) {
    return item.blocos?.length
      ? item.blocos.map(window.AstroBlocks.toText).join("\n\n")
      : item.content || "";
  }
  function messageElement(item) {
    const article = document.createElement("article");
    article.className = `message ${item.role === "user" ? "user" : "assistant"}${item.error ? " error-message" : ""}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (item.role === "user") bubble.textContent = item.content;
    else {
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.textContent = "✦";
      avatar.setAttribute("aria-hidden", "true");
      article.append(avatar);
      if (item.blocos?.length)
        item.blocos.forEach((block) => {
          try {
            bubble.append(window.AstroBlocks.render(block, markdown));
          } catch {
            const note = document.createElement("p");
            note.textContent = "Não foi possível exibir parte desta resposta.";
            bubble.append(note);
          }
        });
      else bubble.innerHTML = markdown(item.content || "");
      if (item.agents?.length) {
        const details = document.createElement("details");
        details.className = "agent-path";
        const summary = document.createElement("summary");
        summary.textContent = "Ver agentes consultados";
        const text = document.createElement("p");
        text.textContent = item.agents.join(" → ");
        details.append(summary, text);
        bubble.append(details);
      }
      if (!item.error) {
        const tools = document.createElement("div");
        tools.className = "message-tools";
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "copy-message";
        copy.textContent = "⧉ Copiar resposta";
        copy.addEventListener("click", () =>
          copyText(messageText(item), "Resposta copiada."),
        );
        tools.append(copy);
        bubble.append(tools);
      }
    }
    article.append(bubble);
    return article;
  }
  function render() {
    elements.messages.innerHTML = transcript.length ? "" : welcomeMarkup;
    transcript.forEach((item) =>
      elements.messages.append(messageElement(item)),
    );
    label();
    if (transcript.length) scroll();
    else elements.messages.scrollTop = 0;
  }
  function typing() {
    const article = document.createElement("article");
    article.id = "typing-indicator";
    article.className = "message assistant typing";
    article.innerHTML =
      '<div class="avatar" aria-hidden="true">✦</div><div class="bubble"><i></i><i></i><i></i><span class="typing-label">Astro está preparando sua resposta…</span></div>';
    elements.messages.append(article);
    scroll();
  }
  function showError(text) {
    elements.messages.append(
      messageElement({ role: "assistant", content: text, error: true }),
    );
    scroll();
  }
  function friendlyError(error) {
    if (error.name === "TimeoutError")
      return "O Astro demorou para responder. Confira o histórico antes de enviar novamente.";
    if (error instanceof TypeError)
      return "Não foi possível conectar ao Astro. Verifique sua conexão e tente novamente.";
    const messages = {
      400: "Não foi possível carregar esta página de conversas.",
      401: "Sua sessão expirou ou os dados de acesso estão incorretos. Entre novamente.",
      403: "Sua conta não possui acesso ao Astro.",
      404: "Esta conversa não está disponível para sua conta.",
      409: "A conversa está ocupada ou precisa ser retomada. Atualize o histórico antes de tentar novamente.",
      422: "Revise os dados informados e tente novamente.",
      429: "Há muitas solicitações. Aguarde um pouco antes de tentar novamente.",
      502: "O Astro não conseguiu concluir a resposta. Tente novamente mais tarde.",
      503: "O Astro está temporariamente indisponível.",
      504: "O Astro demorou para responder. Confira o histórico antes de enviar novamente.",
    };
    return (
      messages[error.status] ||
      error.message ||
      "Não foi possível concluir a solicitação."
    );
  }
  async function request(path, options = {}, authenticated = true) {
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(
      () =>
        controller.abort(new DOMException("Tempo excedido", "TimeoutError")),
      config.requestTimeoutMs || 120000,
    );
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        cache: "no-store",
        signal: controller.signal,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
      const isJson = (response.headers.get("content-type") || "").includes(
        "application/json",
      );
      const data = isJson ? await response.json() : {};
      if (!response.ok) {
        const error = new Error("Não foi possível concluir a solicitação.");
        error.status = response.status;
        if (response.status === 401 && authenticated)
          logout("Sua sessão expirou. Entre novamente para continuar.");
        throw error;
      }
      if (!isJson)
        throw new Error(
          "O servidor retornou uma resposta inesperada. Tente novamente mais tarde.",
        );
      return data;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function clearState() {
    generation++;
    controllers.forEach((c) => c.abort());
    controllers.clear();
    token = "";
    tokenExpiresAt = 0;
    sessionId = "";
    sessionStatus = "ativa";
    transcript = [];
    sessions = [];
    nextCursor = null;
    listing = false;
    elements.messages.innerHTML = welcomeMarkup;
    storage.set(keys.token, "");
    storage.set(keys.expires, "");
    storage.set(keys.session, "");
    storage.set(keys.account, "");
    elements.messageInput.value = "";
    elements.historyList.replaceChildren();
    elements.moreHistory.hidden = true;
  }
  function logout(reason = "") {
    clearState();
    setBusy(false);
    elements.chatView.hidden = true;
    elements.loginView.hidden = false;
    elements.password.value = "";
    elements.loginError.textContent = reason;
    elements.email.focus();
  }
  function account() {
    const email = storage.get(keys.account) || "Sua conta Astro";
    elements.accountName.textContent = email;
    elements.accountName.title = email;
    elements.accountAvatar.textContent = email.slice(0, 1).toUpperCase();
  }
  function showChat() {
    elements.loginView.hidden = true;
    elements.chatView.hidden = false;
    account();
    render();
    updateComposer();
    elements.messageInput.focus();
  }
  function renderSessions() {
    elements.historyList.replaceChildren();
    if (!sessions.length) {
      const note = document.createElement("p");
      note.className = "history-note";
      note.textContent = "Suas conversas vão aparecer aqui.";
      elements.historyList.append(note);
    }
    sessions.forEach((s) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      button.dataset.session = s.session_id;
      button.disabled = busy;
      const title = document.createElement("strong");
      title.textContent = s.title || "Conversa sem título";
      const preview = document.createElement("small");
      preview.textContent = s.last_message_preview || "Sem mensagens";
      const date = document.createElement("small");
      const time = new Date(s.updated_at);
      date.textContent = Number.isNaN(time.getTime())
        ? ""
        : time.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
      button.append(title, preview, date);
      button.addEventListener("click", () => openSession(s.session_id));
      elements.historyList.append(button);
    });
    elements.moreHistory.hidden = !nextCursor;
    label();
  }
  async function loadSessions(more = false) {
    if (!token || listing) return;
    listing = true;
    elements.moreHistory.disabled = true;
    const current = generation;
    try {
      const data = await request(
        `/sessions?limit=20${more && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : ""}`,
      );
      if (current !== generation) return;
      if (!Array.isArray(data.sessions))
        throw new Error("Não foi possível ler a lista de conversas.");
      const merged = new Map(
        (more ? sessions : []).map((s) => [s.session_id, s]),
      );
      data.sessions.forEach((s) => merged.set(s.session_id, s));
      sessions = [...merged.values()];
      nextCursor = data.next_cursor || null;
      renderSessions();
    } catch (error) {
      if (current !== generation) return;
      if (more && error.status === 400) {
        nextCursor = null;
        listing = false;
        return loadSessions();
      }
      const note = document.createElement("p");
      note.className = "history-note";
      note.textContent = friendlyError(error);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "text-button";
      retry.textContent = "Atualizar conversas";
      retry.addEventListener("click", () => loadSessions());
      if (!more) elements.historyList.replaceChildren();
      elements.historyList.append(note, retry);
    } finally {
      if (current === generation) {
        listing = false;
        elements.moreHistory.disabled = busy;
      }
    }
  }
  async function fetchHistory(id) {
    const data = await request(`/sessions/${encodeURIComponent(id)}/messages`);
    if (!Array.isArray(data.mensagens) || data.session_id !== id)
      throw new Error("Não foi possível ler esta conversa.");
    return data;
  }
  function applyHistory(data) {
    sessionId = data.session_id;
    sessionStatus = data.status;
    transcript = data.mensagens.filter((m) =>
      ["user", "assistant"].includes(m.role),
    );
    storage.set(keys.session, sessionId);
    render();
    if (sessionStatus === "encerrando") {
      status("Conversa em recuperação", "offline");
      showError(
        "Esta conversa está disponível para leitura. Para continuar, solicite recuperação ao suporte ou inicie uma nova conversa.",
      );
    } else if (sessionStatus === "encerrada")
      status("Envie para retomar a conversa");
    else status("Conversa atualizada", "connected");
    updateComposer();
  }
  async function openSession(id) {
    if (busy) return;
    const current = generation;
    setBusy(true);
    status("Carregando conversa…", "busy");
    try {
      const data = await fetchHistory(id);
      if (current !== generation) return;
      applyHistory(data);
      if (matchMedia("(max-width:700px)").matches)
        $("#history-panel").open = false;
    } catch (error) {
      if (current === generation) {
        toast(friendlyError(error));
        status("Falha ao carregar", "offline");
        if (error.status === 404) {
          if (sessionId === id) {
            setBusy(false);
            fresh();
          }
          await loadSessions();
        }
      }
    } finally {
      if (current === generation) {
        setBusy(false);
        elements.messageInput.focus();
      }
    }
  }
  function fresh() {
    if (busy) return;
    sessionId = "";
    sessionStatus = "ativa";
    transcript = [];
    storage.set(keys.session, "");
    elements.messageInput.value = "";
    render();
    updateComposer();
    status("Pronto para conversar");
    elements.messageInput.focus();
    if (matchMedia("(max-width:700px)").matches)
      $("#history-panel").open = false;
  }
  async function login(event) {
    event.preventDefault();
    if (elements.loginButton.disabled || !elements.loginForm.reportValidity())
      return;
    elements.loginButton.disabled = true;
    elements.loginButton.querySelector("span").textContent = "Entrando…";
    elements.loginError.textContent = "";
    try {
      const data = await request(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email: elements.email.value.trim(),
            password: elements.password.value,
          }),
        },
        false,
      );
      if (
        !data.access_token ||
        !Number.isFinite(Number(data.expires_in)) ||
        Number(data.expires_in) <= 0
      )
        throw new Error("O servidor não retornou uma autenticação válida.");
      clearState();
      token = data.access_token;
      storage.set(keys.token, token);
      tokenExpiresAt =
        Date.now() + Math.max(0, Number(data.expires_in) - 30) * 1000;
      storage.set(keys.expires, String(tokenExpiresAt));
      storage.set(keys.account, elements.email.value.trim());
      elements.password.value = "";
      showChat();
      status("Autenticado no Astro", "connected");
      await loadSessions();
    } catch (error) {
      elements.loginError.textContent = friendlyError(error);
    } finally {
      elements.loginButton.disabled = false;
      elements.loginButton.querySelector("span").textContent = "Entrar no chat";
    }
  }
  async function send(event) {
    event.preventDefault();
    const message = elements.messageInput.value.trim();
    if (busy || !message || message.length > 4000) return;
    if (sessionStatus === "encerrando") {
      toast(
        "Esta conversa precisa de recuperação pelo suporte. Você pode iniciar uma nova conversa.",
      );
      return;
    }
    if (Date.now() >= tokenExpiresAt) {
      logout("Sua sessão expirou. Entre novamente.");
      return;
    }
    const current = generation;
    const id = sessionId;
    const before = [...transcript];
    setBusy(true);
    status("Preparando resposta…", "busy");
    try {
      if (id && sessionStatus === "encerrada") {
        await request(`/sessions/${encodeURIComponent(id)}/iniciar`, {
          method: "POST",
        });
        sessionStatus = "ativa";
      }
      transcript.push({ role: "user", content: message });
      render();
      typing();
      const body = { message };
      if (id) body.session_id = id;
      const data = await request(
        `/chat/messages?markdown=${config.markdown !== false}`,
        { method: "POST", body: JSON.stringify(body) },
      );
      if (current !== generation) return;
      if (
        !data.session_id ||
        (!Array.isArray(data.blocos) && typeof data.resposta !== "string")
      )
        throw new Error(
          "O Astro retornou uma resposta inesperada. Confira o histórico.",
        );
      sessionId = data.session_id;
      sessionStatus = "ativa";
      storage.set(keys.session, sessionId);
      transcript.push({
        role: "assistant",
        blocos: data.blocos,
        content: data.resposta || "",
        agents: data.agentes_chamados,
      });
      elements.messageInput.value = "";
      render();
      status("Resposta recebida", "connected");
      await loadSessions();
    } catch (error) {
      if (current !== generation) return;
      transcript = before;
      render();
      status("Não foi possível concluir", "offline");
      // A failed POST can already have been persisted. Reconcile without replaying it.
      if (id) {
        try {
          const data = await fetchHistory(id);
          if (current !== generation) return;
          applyHistory(data);
          if (
            data.mensagens.length > before.length &&
            data.mensagens.some(
              (m, i) =>
                i >= before.length &&
                m.role === "user" &&
                m.content === message,
            )
          )
            elements.messageInput.value = "";
        } catch {
          /* The draft stays available until history can be checked. */
        }
      }
      if (current === generation) {
        showError(
          `${friendlyError(error)}\n\nConfira as conversas antes de reenviar: a mensagem pode já ter sido recebida.`,
        );
        await loadSessions();
      }
    } finally {
      if (current === generation) {
        $("#typing-indicator")?.remove();
        setBusy(false);
        if (!elements.chatView.hidden) elements.messageInput.focus();
      }
    }
  }
  async function copyText(text, success) {
    try {
      await navigator.clipboard.writeText(text);
      toast(success);
    } catch {
      toast("Não foi possível copiar. Selecione e copie o texto manualmente.");
    }
  }
  elements.loginForm.addEventListener("submit", login);
  elements.chatForm.addEventListener("submit", send);
  elements.messageInput.addEventListener("input", updateComposer);
  elements.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });
  elements.messages.addEventListener("click", (e) => {
    const button = e.target.closest("[data-suggestion]");
    if (!button || busy) return;
    elements.messageInput.value = button.dataset.suggestion;
    updateComposer();
    elements.messageInput.focus();
  });
  elements.togglePassword.addEventListener("click", () => {
    const visible = elements.password.type === "text";
    elements.password.type = visible ? "password" : "text";
    elements.togglePassword.setAttribute("aria-pressed", String(!visible));
    elements.togglePassword.setAttribute(
      "aria-label",
      visible ? "Mostrar senha" : "Ocultar senha",
    );
  });
  elements.newChat.addEventListener("click", fresh);
  elements.logout.addEventListener("click", () => logout());
  elements.copySession.addEventListener("click", () => {
    if (sessionId) copyText(sessionId, "ID da sessão copiado.");
  });
  elements.moreHistory.addEventListener("click", () => loadSessions(true));
  elements.exportChat.addEventListener("click", () => {
    if (!transcript.length) return;
    const content = `# Conversa com Astro\n\nSessão: ${sessionId}\n\n${transcript.map((m) => `## ${m.role === "user" ? "Você" : "Astro"}\n\n${messageText(m)}`).join("\n\n---\n\n")}`;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `astro-${sessionId || "conversa"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Conversa exportada.");
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden || !token || busy) return;
    if (Date.now() >= tokenExpiresAt) {
      logout("Sua sessão expirou. Entre novamente.");
      return;
    }
    if (sessionId) await openSession(sessionId);
    await loadSessions();
  });
  if (matchMedia("(max-width:700px)").matches) $("#history-panel").open = false;
  if (!apiBaseUrl) {
    elements.loginError.textContent =
      "A conexão com o Astro ainda não foi configurada.";
    elements.loginButton.disabled = true;
  } else if (storage.get(keys.token) && Date.now() < tokenExpiresAt) {
    token = storage.get(keys.token);
    sessionId = storage.get(keys.session) || "";
    showChat();
    (async () => {
      if (sessionId) await openSession(sessionId);
      await loadSessions();
    })();
  } else logout();
})();
