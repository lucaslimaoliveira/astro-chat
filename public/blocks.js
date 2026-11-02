(() => {
  "use strict";
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  };
  function httpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  function image(value, description) {
    const fallback = node(
      "span",
      description || "Foto indisponível",
      "block-note",
    );
    const url = httpsUrl(value);
    if (!url) return fallback;
    const host = new URL(url).hostname;
    const allowed = window.ASTRO_CONFIG?.imageAllowedHosts || [];
    if (
      !host.endsWith(".r2.cloudflarestorage.com") &&
      !host.endsWith(".r2.dev") &&
      !allowed.includes(host)
    )
      return fallback;
    const img = node("img");
    img.src = url;
    img.alt = description || "Foto de perfil";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(fallback), {
      once: true,
    });
    return img;
  }
  function cell(value) {
    return value && typeof value === "object" && value.tipo === "imagem"
      ? image(value.url, value.descricao)
      : node("span", value == null ? "—" : String(value));
  }
  function table(block) {
    const wrap = node("div", null, "response-block");
    let page = 0;
    const size = 10;
    const rows = Array.isArray(block.linhas) ? block.linhas : [];
    const columns = Array.isArray(block.colunas) ? block.colunas : [];
    const content = node("div");
    const pagination = node("div", null, "table-pagination");
    function draw() {
      content.replaceChildren();
      pagination.replaceChildren();
      const el = node("table");
      const caption = node("caption", block.titulo || "Dados da resposta");
      el.append(caption);
      const head = node("thead");
      const heading = node("tr");
      columns.forEach((c) => {
        const th = node("th", c.titulo);
        th.scope = "col";
        heading.append(th);
      });
      head.append(heading);
      el.append(head);
      const body = node("tbody");
      rows.slice(page * size, (page + 1) * size).forEach((row) => {
        const tr = node("tr");
        columns.forEach((c) => {
          const td = node("td");
          td.append(cell(row[c.chave]));
          tr.append(td);
        });
        body.append(tr);
      });
      el.append(body);
      content.append(el);
      if (rows.length > size) {
        const back = node("button", "← Anterior");
        const next = node("button", "Próxima →");
        back.type = next.type = "button";
        back.disabled = page === 0;
        next.disabled = (page + 1) * size >= rows.length;
        back.addEventListener("click", () => {
          page--;
          draw();
        });
        next.addEventListener("click", () => {
          page++;
          draw();
        });
        pagination.append(
          back,
          node("span", `${page + 1} / ${Math.ceil(rows.length / size)}`),
          next,
        );
      }
    }
    draw();
    wrap.append(content, pagination);
    const notes = [
      `${rows.length} registros recebidos de ${block.total ?? rows.length}.`,
    ];
    if (block.versao === 1 && block.total_paginas > 1)
      notes.push(
        `Página do servidor ${block.pagina} de ${block.total_paginas}.`,
      );
    if (block.tem_mais)
      notes.push(
        "Há outros registros fora deste conjunto. Peça mais detalhes ao Astro.",
      );
    if (block.limitado)
      notes.push(
        block.motivo_limite === "tamanho_resposta"
          ? "Resultado limitado pelo tamanho da resposta."
          : "Resultado limitado ao máximo permitido.",
      );
    wrap.append(node("p", notes.join(" "), "block-note"));
    return wrap;
  }
  function chart(block) {
    const section = node("section", null, "response-block");
    section.append(node("h3", block.titulo));
    const data = Array.isArray(block.dados) ? block.dados : [];
    const max = Math.max(1, ...data.map((p) => Number(p.valor) || 0));
    // Every chart includes the original values and labels for assistive technology.
    if (block.tipo === "grafico_linhas" && data.length) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 500 140");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("line-chart");
      const line = document.createElementNS(svg.namespaceURI, "polyline");
      line.setAttribute(
        "points",
        data
          .map(
            (p, i) =>
              `${15 + (i * 470) / Math.max(1, data.length - 1)},${125 - (Math.max(0, Number(p.valor) || 0) / max) * 110}`,
          )
          .join(" "),
      );
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "#9874be");
      line.setAttribute("stroke-width", "3");
      svg.append(line);
      section.append(svg);
    }
    const total = data.reduce(
      (sum, p) => sum + Math.max(0, Number(p.valor) || 0),
      0,
    );
    if (
      ["grafico_setores", "grafico_rosca"].includes(block.tipo) &&
      total > 0
    ) {
      const colors = [
        "#7549b8",
        "#a87bcc",
        "#c4a9e2",
        "#5b6eb3",
        "#86a8c7",
        "#a3c8c0",
      ];
      let offset = 0;
      const stops = data.map((p, i) => {
        const start = offset;
        offset += (Math.max(0, Number(p.valor) || 0) / total) * 100;
        return `${colors[i % colors.length]} ${start}% ${offset}%`;
      });
      const disk = node(
        "div",
        null,
        `pie-chart ${block.tipo === "grafico_rosca" ? "donut-chart" : ""}`,
      );
      disk.style.background = `conic-gradient(${stops.join(",")})`;
      disk.setAttribute("aria-hidden", "true");
      section.append(disk);
    }
    data.forEach((p) => {
      const row = node("div", null, "chart-row");
      const track = node("div", null, "chart-track");
      const bar = node("span", null, "chart-bar");
      const value = Math.max(0, Number(p.valor) || 0);
      bar.style.width = `${(value / max) * 100}%`;
      track.append(bar);
      track.setAttribute("aria-hidden", "true");
      row.append(
        node("span", p.categoria),
        track,
        node(
          "strong",
          `${value.toLocaleString("pt-BR")}${["grafico_setores", "grafico_rosca"].includes(block.tipo) && total ? ` (${((value / total) * 100).toFixed(1)}%)` : ""}`,
        ),
      );
      section.append(row);
    });
    section.append(
      node(
        "p",
        `Unidade: ${block.unidade || "registros"} · Fonte: ${block.fonte || "Não informada"}`,
        "block-note",
      ),
    );
    return section;
  }
  function details(value, title) {
    const el = node("details", null, "data-details");
    el.append(node("summary", title));
    const dl = node("dl");
    Object.entries(value)
      .filter(
        ([k, v]) =>
          !["tipo", "versao", "titulo", "origem", "url", "foto", "id"].includes(
            k,
          ) && v != null,
      )
      .forEach(([key, val]) => {
        dl.append(
          node("dt", key.replaceAll("_", " ")),
          node(
            "dd",
            typeof val === "object"
              ? JSON.stringify(val, (k, v) => (k === "url" ? undefined : v), 2)
              : String(val),
          ),
        );
      });
    el.append(dl);
    return el;
  }
  function render(block, markdown) {
    const section = node("section", null, "response-block");
    const known = [
      "texto",
      "arquivo",
      "grafico_barras",
      "grafico_linhas",
      "grafico_setores",
      "grafico_rosca",
      "tabela",
      "matriz_conformidade",
      "indicadores",
      "contexto_dados",
      "galeria_usuarios",
      "ficha_usuario",
    ];
    const version = block.versao ?? 1;
    if (
      !known.includes(block.tipo) ||
      (version !== 1 && !(block.tipo === "tabela" && version === 2))
    ) {
      return node(
        "p",
        "Parte desta resposta usa um formato ainda não disponível neste chat.",
        "block-note",
      );
    }
    if (block.tipo === "texto") {
      section.innerHTML = markdown(String(block.conteudo || ""));
      return section;
    }
    if (block.tipo === "tabela" || block.tipo === "matriz_conformidade")
      return table(block);
    if (block.tipo.startsWith("grafico_")) return chart(block);
    if (block.tipo === "arquivo") {
      section.append(node("strong", block.nome || "Arquivo PDF"));
      if (block.tamanho_bytes > 0)
        section.append(
          node(
            "p",
            `${(block.tamanho_bytes / 1024).toFixed(1)} KB`,
            "block-note",
          ),
        );
      const url = httpsUrl(block.url);
      const expiration = new Date(block.expira_em).getTime();
      if (url && block.estado === "disponivel" && expiration > Date.now()) {
        const link = node("a", "↓ Baixar PDF", "file-link");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.addEventListener("click", (e) => {
          if (Date.now() >= expiration) {
            e.preventDefault();
            link.replaceWith(
              node(
                "p",
                "Link expirado; solicite a geração novamente.",
                "block-note",
              ),
            );
          }
        });
        section.append(
          link,
          node(
            "p",
            `Disponível até ${new Date(expiration).toLocaleString("pt-BR")}.`,
            "block-note",
          ),
        );
      } else
        section.append(
          node(
            "p",
            block.estado === "expirado" || expiration <= Date.now()
              ? "Link expirado; solicite a geração novamente."
              : "Arquivo indisponível.",
            "block-note",
          ),
        );
      return section;
    }
    if (block.titulo) section.append(node("h3", block.titulo));
    if (block.tipo === "indicadores") {
      section.append(node("p", block.universo, "block-note"));
      const grid = node("div", null, "indicator-grid");
      (block.indicadores || []).forEach((i) => {
        const card = node("div", null, "indicator");
        card.append(
          node("span", i.rotulo),
          node(
            "strong",
            i.valor == null
              ? "Não se aplica"
              : `${Number(i.valor).toLocaleString("pt-BR")} ${i.unidade}`,
          ),
        );
        if (i.numerador != null && i.denominador != null)
          card.append(node("small", `${i.numerador} / ${i.denominador}`));
        card.append(node("small", i.criterio));
        grid.append(card);
      });
      section.append(grid);
    } else if (block.tipo === "ficha_usuario") {
      section.append(
        image(
          block.foto?.url,
          block.foto?.descricao || block.nome || "Meu perfil",
        ),
      );
      const dl = node("dl", null, "profile-fields");
      for (const [key, label] of Object.entries({
        nome: "Nome",
        email: "E-mail",
        cargo: "Cargo",
        unidade: "Unidade",
        perfil: "Perfil",
        modalidade: "Modalidade",
        situacao: "Situação",
      }))
        if (block[key] != null)
          dl.append(node("dt", label), node("dd", block[key]));
      section.append(dl);
      if (block.conformidade) {
        const c = block.conformidade;
        section.append(
          node(
            "p",
            c.percentual == null
              ? "Sem NRs aplicáveis"
              : `Conformidade: ${c.percentual}% · ${c.vigentes} / ${c.total}`,
          ),
          node(
            "p",
            `${c.criterio} · Referência: ${c.data_referencia}`,
            "block-note",
          ),
        );
      }
    } else if (block.tipo === "galeria_usuarios") {
      const gallery = node("div", null, "gallery");
      (block.imagens || []).forEach((i) => {
        const figure = node("figure");
        figure.append(image(i.url, i.nome), node("figcaption", i.nome));
        gallery.append(figure);
      });
      section.append(gallery);
    } else
      section.append(details(block, "Fonte, filtros e contexto dos dados"));
    return section;
  }
  function toText(block) {
    if (block.tipo === "texto") return block.conteudo || "";
    if (block.tipo === "arquivo") return `[PDF: ${block.nome}]`;
    return `${block.titulo || block.tipo}\n${JSON.stringify(block, (key, value) => (["url", "foto", "id", "origem"].includes(key) ? undefined : value), 2)}`;
  }
  window.AstroBlocks = { render, toText };
})();
