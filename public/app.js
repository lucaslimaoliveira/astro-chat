(() => {
  "use strict";

  const config = window.ASTRO_CONFIG ?? {};
  const apiBaseUrl = String(config.apiBaseUrl ?? "").replace(/\/$/, "");
  const markdownEnabled = config.markdown !== false;
  const storageKeys = {
    token: "astro.test.token",
    expiresAt: "astro.test.expiresAt",
    sessionId: "astro.test.sessionId",
    messages: "astro.test.messages",
  };

  const elements = {
    loginView: document.querySelector("#login-view"),
    chatView: document.querySelector("#chat-view"),
    loginForm: document.querySelector("#login-form"),
    email: document.querySelector("#email"),
    password: document.querySelector("#password"),
    togglePassword: document.querySelector("#toggle-password"),
    loginButton: document.querySelector("#login-button"),
    loginError: document.querySelector("#login-error"),
    chatForm: document.querySelector("#chat-form"),
    messageInput: document.querySelector("#message-input"),
    sendButton: document.querySelector("#send-button"),
    messages: document.querySelector("#messages"),
    sessionId: document.querySelector("#session-id"),
    copySession: document.querySelector("#copy-session"),
    endChat: document.querySelector("#end-chat"),
    logout: document.querySelector("#logout"),
    endDialog: document.querySelector("#end-dialog"),
    confirmEnd: document.querySelector("#confirm-end"),
    toast: document.querySelector("#toast"),
    apiStatus: document.querySelector("#api-status"),
  };

  const welcomeMarkup = elements.messages.innerHTML;
  let token = "";
  let sessionId = "";
  let transcript = [];
  let requestInFlight = false;
  let toastTimer;

  function newSessionId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (character) =>
      (character ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> character / 4).toString(16),
    );
  }

  function saveSession() {
    sessionStorage.setItem(storageKeys.sessionId, sessionId);
    sessionStorage.setItem(storageKeys.messages, JSON.stringify(transcript));
  }

  function setToken(value, expiresIn = 0) {
    token = value;
    if (!value) {
      sessionStorage.removeItem(storageKeys.token);
      sessionStorage.removeItem(storageKeys.expiresAt);
      return;
    }
    sessionStorage.setItem(storageKeys.token, value);
    sessionStorage.setItem(
      storageKeys.expiresAt,
      String(Date.now() + Math.max(0, Number(expiresIn) - 30) * 1000),
    );
  }

  function restoreToken() {
    const savedToken = sessionStorage.getItem(storageKeys.token) ?? "";
    const expiresAt = Number(sessionStorage.getItem(storageKeys.expiresAt) ?? 0);
    if (!savedToken || !expiresAt || Date.now() >= expiresAt) {
      setToken("");
      return false;
    }
    token = savedToken;
    return true;
  }

  function restoreConversation() {
    sessionId = sessionStorage.getItem(storageKeys.sessionId) || newSessionId();
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKeys.messages) || "[]");
      transcript = Array.isArray(saved) ? saved : [];
    } catch {
      transcript = [];
    }
    updateSessionLabel();
    renderTranscript();
    saveSession();
  }

  function updateSessionLabel() {
    elements.sessionId.textContent = sessionId;
    elements.copySession.title = `Copiar sessão ${sessionId}`;
  }

  function showLogin() {
    elements.chatView.hidden = true;
    elements.loginView.hidden = false;
    elements.password.value = "";
    window.setTimeout(() => elements.email.focus(), 50);
  }

  function showChat() {
    elements.loginView.hidden = true;
    elements.chatView.hidden = false;
    window.setTimeout(() => elements.messageInput.focus(), 50);
  }

  function setBusy(isBusy) {
    requestInFlight = isBusy;
    elements.sendButton.disabled = isBusy;
    elements.messageInput.disabled = isBusy;
    elements.endChat.disabled = isBusy;
    elements.messages.setAttribute("aria-busy", String(isBusy));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
  }

  function setApiStatus(connected) {
    elements.apiStatus.classList.toggle("offline", !connected);
    elements.apiStatus.lastChild.textContent = connected ? " API conectada" : " API indisponível";
  }

  function escapeHtml(value) {
    return value.replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character]);
  }

  function renderMarkdown(value) {
    if (window.marked && window.DOMPurify) {
      window.marked.setOptions({ gfm: true, breaks: true });
      const parsed = window.marked.parse(value);
      const sanitized = window.DOMPurify.sanitize(parsed, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["style", "iframe", "form", "input", "button"],
      });
      const template = document.createElement("template");
      template.innerHTML = sanitized;
      template.content.querySelectorAll("a").forEach((link) => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
      return template.innerHTML;
    }
    return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
  }

  function createMessageElement(item) {
    const article = document.createElement("article");
    article.className = `message ${item.role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (item.role === "assistant") {
      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = "A";
      article.append(avatar);
      bubble.innerHTML = renderMarkdown(item.content);

      if (Array.isArray(item.agents) && item.agents.length) {
        const path = document.createElement("div");
        path.className = "agent-path";
        path.textContent = `Rota: ${item.agents.join(" → ")}`;
        bubble.append(path);
      }
    } else {
      bubble.textContent = item.content;
    }

    article.append(bubble);
    return article;
  }

  function renderTranscript() {
    elements.messages.innerHTML = transcript.length ? "" : welcomeMarkup;
    transcript.forEach((item) => elements.messages.append(createMessageElement(item)));
    bindSuggestionButtons();
    scrollToLatest();
  }

  function appendMessage(item) {
    if (!transcript.length) {
      elements.messages.innerHTML = "";
    }
    transcript.push(item);
    elements.messages.append(createMessageElement(item));
    saveSession();
    scrollToLatest();
  }

  function addTypingIndicator() {
    const article = document.createElement("article");
    article.id = "typing-indicator";
    article.className = "message assistant typing";
    article.innerHTML = `
      <div class="avatar" aria-hidden="true">A</div>
      <div class="bubble" aria-label="Astro está respondendo"><i></i><i></i><i></i></div>
    `;
    elements.messages.append(article);
    scrollToLatest();
  }

  function removeTypingIndicator() {
    document.querySelector("#typing-indicator")?.remove();
  }

  function scrollToLatest() {
    window.requestAnimationFrame(() => {
      elements.messages.scrollTop = elements.messages.scrollHeight;
    });
  }

  function resizeComposer() {
    elements.messageInput.style.height = "auto";
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 144)}px`;
  }

  async function parseResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await response.json()
      : { detail: await response.text() };

    if (!response.ok) {
      const error = new Error(data.detail || `A API respondeu com status ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function friendlyError(error) {
    if (error instanceof TypeError) {
      return "Não foi possível acessar a API. Verifique a conexão e a configuração de CORS do backend.";
    }
    const messages = {
      401: "Sua autenticação expirou ou as credenciais estão incorretas.",
      403: "Esta conta não possui acesso ao Astro.",
      404: "A rota solicitada não está disponível no servidor.",
      409: "Esta conversa já foi encerrada. Uma nova sessão será criada.",
      422: "Revise os dados informados e tente novamente.",
      502: "A IA não conseguiu concluir a resposta. Tente reformular a mensagem.",
      503: "Um serviço necessário está temporariamente indisponível.",
    };
    return error.message || messages[error.status] || "Não foi possível concluir a solicitação.";
  }

  async function authenticatedFetch(path, options = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (response.status === 401) {
      setToken("");
      showLogin();
    }
    return response;
  }

  async function handleLogin(event) {
    event.preventDefault();
    elements.loginError.textContent = "";
    if (!elements.loginForm.reportValidity()) return;

    elements.loginButton.disabled = true;
    elements.loginButton.querySelector("span").textContent = "Entrando...";

    try {
      const response = await fetch(`${apiBaseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: elements.email.value.trim(),
          password: elements.password.value,
        }),
      });
      const data = await parseResponse(response);
      setToken(data.access_token, data.expires_in);
      elements.password.value = "";
      restoreConversation();
      setApiStatus(true);
      showChat();
    } catch (error) {
      setApiStatus(false);
      elements.loginError.textContent = friendlyError(error);
    } finally {
      elements.loginButton.disabled = false;
      elements.loginButton.querySelector("span").textContent = "Entrar no chat";
    }
  }

  async function handleSend(event) {
    event.preventDefault();
    if (requestInFlight) return;

    const message = elements.messageInput.value.trim();
    if (!message) return;

    appendMessage({ role: "user", content: message });
    elements.messageInput.value = "";
    resizeComposer();
    setBusy(true);
    addTypingIndicator();

    try {
      const response = await authenticatedFetch(
        `/chat/messages?markdown=${markdownEnabled ? "true" : "false"}`,
        {
          method: "POST",
          body: JSON.stringify({ message, session_id: sessionId }),
        },
      );
      const data = await parseResponse(response);
      sessionId = data.session_id;
      updateSessionLabel();
      setApiStatus(true);
      removeTypingIndicator();
      appendMessage({
        role: "assistant",
        content: data.resposta,
        agents: data.agentes_chamados,
      });
    } catch (error) {
      removeTypingIndicator();
      setApiStatus(false);
      appendMessage({
        role: "assistant",
        content: `**Não foi possível concluir a mensagem.**\n\n${friendlyError(error)}`,
        agents: [],
      });
      if (error.status === 409) {
        startFreshConversation();
      }
    } finally {
      setBusy(false);
      elements.messageInput.focus();
    }
  }

  function startFreshConversation() {
    sessionId = newSessionId();
    transcript = [];
    updateSessionLabel();
    renderTranscript();
    saveSession();
  }

  async function finishConversation() {
    if (requestInFlight) return;
    elements.endDialog.close();

    if (!transcript.length) {
      startFreshConversation();
      showToast("Nova conversa iniciada.");
      return;
    }

    setBusy(true);
    elements.endChat.textContent = "Finalizando...";
    try {
      const response = await authenticatedFetch(`/sessions/${sessionId}/encerrar`, {
        method: "POST",
      });
      await parseResponse(response);
      startFreshConversation();
      setApiStatus(true);
      showToast("Conversa finalizada. Uma nova sessão foi criada.");
    } catch (error) {
      setApiStatus(false);
      showToast(friendlyError(error));
    } finally {
      setBusy(false);
      elements.endChat.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
          <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"></path>
          <path d="m16 17 5-5-5-5M21 12H8"></path>
        </svg>
        Finalizar conversa
      `;
    }
  }

  function logout() {
    setToken("");
    sessionStorage.removeItem(storageKeys.sessionId);
    sessionStorage.removeItem(storageKeys.messages);
    sessionId = "";
    transcript = [];
    showLogin();
  }

  function bindSuggestionButtons() {
    document.querySelectorAll("[data-suggestion]").forEach((button) => {
      button.addEventListener("click", () => {
        elements.messageInput.value = button.dataset.suggestion;
        resizeComposer();
        elements.messageInput.focus();
      });
    });
  }

  elements.loginForm.addEventListener("submit", handleLogin);
  elements.chatForm.addEventListener("submit", handleSend);
  elements.messageInput.addEventListener("input", resizeComposer);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });
  elements.togglePassword.addEventListener("click", () => {
    const isVisible = elements.password.type === "text";
    elements.password.type = isVisible ? "password" : "text";
    elements.togglePassword.setAttribute("aria-pressed", String(!isVisible));
    elements.togglePassword.setAttribute("aria-label", isVisible ? "Mostrar senha" : "Ocultar senha");
  });
  elements.copySession.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      showToast("ID da sessão copiado.");
    } catch {
      showToast("Não foi possível copiar o ID da sessão.");
    }
  });
  elements.endChat.addEventListener("click", () => elements.endDialog.showModal());
  elements.confirmEnd.addEventListener("click", (event) => {
    event.preventDefault();
    finishConversation();
  });
  elements.logout.addEventListener("click", logout);

  if (!apiBaseUrl) {
    elements.loginError.textContent = "Configure a URL da API no arquivo config.js.";
    elements.loginButton.disabled = true;
  } else if (restoreToken()) {
    restoreConversation();
    showChat();
  } else {
    showLogin();
  }
})();
