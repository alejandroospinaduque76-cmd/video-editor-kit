/* Video Editor Kit — asistente de la página de venta.
 * Vanilla JS, sin dependencias. Dos modos:
 *  - LLM: si window.VEK_CHAT_ENDPOINT está definido (Worker de Cloudflare → Claude).
 *  - FAQ (por defecto y de respaldo): busca en assets/asistente-faq.json.
 * Config: window.VEK_LINK_COMPRA, window.VEK_CORREO, window.VEK_CHAT_ENDPOINT.
 * En Node exporta el buscador de FAQ para pruebas (module.exports).
 */
(function () {
  "use strict";

  /* ---------------- Buscador de FAQ (puro, sin DOM) ---------------- */

  var STOP = ("a al algo algun alguna alguno ante asi aun cada como con cual cuales cuando de del desde donde " +
    "e el ella ellas ello ellos en entre era es esa ese eso esta estan estas este esto estoy fue ha han has hay " +
    "la las le les lo los mas me mi mis mucho muy nos o para pero poco por porque pues que quien se sea ser si " +
    "sin sobre soy su sus tal tambien te ti tu tus un una unas uno unos usted vos y ya yo hola buenas buenos " +
    "dias tardes noches gracias favor quisiera saber puedo pueden podria oye tengo tiene tienes").split(" ");
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });
  // "tengo/tiene" van como stopwords: no aportan tema ("tengo una pc" → "pc").

  var SUFFIXES = ["amientos", "imientos", "amiento", "imiento", "aciones", "iciones", "uciones", "adoras", "adores",
    "idades", "amente", "acion", "icion", "ucion", "mente", "idad", "ables", "ibles", "able", "ible", "ando", "iendo",
    "ados", "idas", "idos", "adas", "aria", "ado", "ido", "ada", "ida", "ara", "era", "ira", "ar", "er", "ir",
    "es", "as", "os", "an", "en", "a", "e", "o", "s"];

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function stem(w) {
    if (w.length <= 3) return w;
    for (var i = 0; i < SUFFIXES.length; i++) {
      var s = SUFFIXES[i];
      if (w.length - s.length >= 3 && w.slice(-s.length) === s) return w.slice(0, -s.length);
    }
    return w;
  }

  function tokens(text) {
    return normalize(text).split(" ").filter(function (w) { return w && !STOPSET[w]; }).map(stem);
  }

  function bigrams(toks) {
    var out = [];
    for (var i = 0; i + 1 < toks.length; i++) out.push(toks[i] + "_" + toks[i + 1]);
    return out;
  }

  function lev1(a, b) { // ¿distancia de edición <= 1?
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0, j = 0, diff = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return diff + (la - i) + (lb - j) <= 1;
  }

  function sim(q, t) { // similitud 0..1 entre dos raíces
    if (q === t) return 1;
    var m = Math.min(q.length, t.length);
    if (m >= 4 && lev1(q, t)) return 0.85;
    if (m >= 4 && (q.indexOf(t) === 0 || t.indexOf(q) === 0)) return 0.75;
    // transposición de letras vecinas ("widnows")
    if (q.length === t.length && q.length >= 5) {
      var d = [];
      for (var i = 0; i < q.length; i++) if (q[i] !== t[i]) d.push(i);
      if (d.length === 2 && d[1] === d[0] + 1 && q[d[0]] === t[d[1]] && q[d[1]] === t[d[0]]) return 0.85;
    }
    return 0;
  }

  function buildIndex(faq) {
    var entries = (faq || []).filter(function (e) { return e && e.id && e.respuesta; }).map(function (e) {
      var preg = (e.preguntas || []).map(function (p) { var t = tokens(p); return { t: t, b: bigrams(t) }; });
      var pal = (e.palabras || []).map(function (p) { var t = tokens(p); return { t: t, b: bigrams(t) }; });
      var vocab = {};
      preg.concat(pal).forEach(function (x) { x.t.forEach(function (w) { vocab[w] = 1; }); });
      return { entry: e, preg: preg, pal: pal, vocab: Object.keys(vocab) };
    });
    var df = {};
    entries.forEach(function (x) { x.vocab.forEach(function (w) { df[w] = (df[w] || 0) + 1; }); });
    var n = Math.max(entries.length, 1);
    var idf = {};
    Object.keys(df).forEach(function (w) { idf[w] = Math.log(1 + n / df[w]); });
    return { entries: entries, idf: idf, n: n, allVocab: Object.keys(df) };
  }

  function weightOf(index, q) { // peso IDF de una raíz de la pregunta (con tolerancia a errores)
    if (index.idf[q] != null) return index.idf[q];
    var best = null;
    for (var i = 0; i < index.allVocab.length; i++) {
      var v = index.allVocab[i];
      if (sim(q, v) > 0 && (best === null || index.idf[v] > best)) best = index.idf[v];
    }
    return best != null ? best : 0.6; // palabra desconocida: pesa poco pero diluye
  }

  function coverage(q, list) {
    var best = 0;
    for (var i = 0; i < list.length && best < 1; i++) { var s = sim(q, list[i]); if (s > best) best = s; }
    return best;
  }

  function scoreAll(index, text) {
    var q = tokens(text);
    var seen = {};
    q = q.filter(function (w) { if (seen[w]) return false; seen[w] = 1; return true; });
    if (!q.length) return [];
    var qb = bigrams(tokens(text));
    var w = q.map(function (t) { return weightOf(index, t); });
    var wSum = w.reduce(function (a, b) { return a + b; }, 0) || 1;
    return index.entries.map(function (x) {
      // 1) cobertura de las palabras de la pregunta en todo el vocabulario de la entrada (preguntas + palabras)
      var cov = 0;
      for (var i = 0; i < q.length; i++) cov += w[i] * coverage(q[i], x.vocab);
      cov /= wSum;
      // 2) parecido con la mejor pregunta modelo (tipo Dice) y 3) bigramas en común
      var dice = 0, bi = 0;
      x.preg.concat(x.pal).forEach(function (p) {
        if (!p.t.length) return;
        var m = 0, pw = 0;
        for (var i = 0; i < q.length; i++) m += w[i] * coverage(q[i], p.t);
        for (var j = 0; j < p.t.length; j++) pw += index.idf[p.t[j]] || 0.6;
        var d = (2 * m) / (wSum + pw);
        if (d > dice) dice = d;
        if (qb.length && p.b.length) {
          var hit = 0;
          qb.forEach(function (g) { if (p.b.indexOf(g) > -1) hit++; });
          var bs = hit / qb.length;
          if (bs > bi) bi = bs;
        }
      });
      return { id: x.entry.id, entry: x.entry, score: 0.55 * cov + 0.3 * dice + 0.15 * bi };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  var THRESHOLD = 0.4;

  function match(index, text) {
    // Frases cortas exactas (hola, gracias, ok…): si coinciden con una pregunta de la FAQ, gana esa entrada.
    var norm = normalize(text).trim();
    if (norm) {
      for (var i = 0; i < index.entries.length; i++) {
        var e = index.entries[i].entry;
        for (var j = 0; j < (e.preguntas || []).length; j++) {
          if (normalize(e.preguntas[j]).trim() === norm) return { entry: e, score: 1, related: [] };
        }
      }
    }
    var ranked = scoreAll(index, text);
    var best = ranked[0];
    var top3 = (ranked.length ? ranked : index.entries.map(function (x) { return { entry: x.entry, score: 0 }; }))
      .slice(0, 3).map(function (r) { return r.entry; });
    if (best && best.score >= THRESHOLD) return { entry: best.entry, score: best.score, related: top3 };
    return { entry: null, score: best ? best.score : 0, related: top3 };
  }

  // Chips fijos del saludo → entradas preferidas (si existen en faq.json). Si no, se usa el buscador.
  var CHIP_IDS = {
    "¿Qué hace exactamente?": ["que-es"],
    "¿Funciona en mi computador?": ["sistemas"],
    "¿Cuánto cuesta y qué incluye?": ["precio", "que-incluye"],
    "¿Y si no me funciona?": ["garantia"]
  };
  function chipAnswer(index, text) {
    var ids = CHIP_IDS[text];
    if (!ids) return null;
    var found = ids.map(function (id) {
      for (var i = 0; i < index.entries.length; i++) if (index.entries[i].entry.id === id) return index.entries[i].entry;
      return null;
    });
    if (found.some(function (e) { return !e; })) return null;
    // Une las respuestas; el enlace de compra solo queda al final.
    var parts = found.map(function (e, i) {
      var r = String(e.respuesta).trim();
      return i < found.length - 1 ? r.replace(/[:\s]*\{LINK_COMPRA\}\.?\s*$/, "").replace(/([^.!?])$/, "$1.") : r;
    });
    return { id: ids.join("+"), respuesta: parts.join("\n\n"), preguntas: [text] };
  }

  var api = { normalize: normalize, stem: stem, tokens: tokens, buildIndex: buildIndex, scoreAll: scoreAll, match: match, chipAnswer: chipAnswer, THRESHOLD: THRESHOLD };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  if (typeof document === "undefined" || typeof window === "undefined") return;

  /* ---------------- Widget (DOM) ---------------- */

  var W = window;
  var LINK = W.VEK_LINK_COMPRA || "";
  var CORREO = W.VEK_CORREO || "";
  var ENDPOINT = W.VEK_CHAT_ENDPOINT || null;
  var STORE_KEY = "vek-asistente-v1";
  var TIMEOUT_MS = 25000;
  var GREETING = "¡Hola! Soy el asistente del Video Editor Kit. Pregúntame lo que quieras sobre el kit, cómo funciona o la compra.";
  var CHIPS = ["¿Qué hace exactamente?", "¿Funciona en mi computador?", "¿Cuánto cuesta y qué incluye?", "¿Y si no me funciona?"];
  var NO_SE = "No estoy seguro de eso. Escríbenos a {CORREO_SOPORTE} y te respondemos por escrito.";

  var script = document.currentScript;
  var FAQ_URL = (function () {
    try { if (script && script.src) return new URL("asistente-faq.json", script.src).href; } catch (e) {}
    return "assets/asistente-faq.json";
  })();

  function fill(t) {
    return String(t || "").split("{LINK_COMPRA}").join(LINK).split("{CORREO_SOPORTE}").join(CORREO);
  }

  function count(name) {
    try { if (W.goatcounter && typeof W.goatcounter.count === "function") W.goatcounter.count({ path: name, title: name, event: true }); } catch (e) {}
  }

  // estado: [{role:'user'|'assistant', content, chips?:[texto]}]
  var state = { msgs: [], open: false };
  function save() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ msgs: state.msgs.slice(-40), open: state.open })); } catch (e) {} }
  function load() {
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d && Array.isArray(d.msgs)) state.msgs = d.msgs.filter(function (m) { return m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"; });
      state.open = !!(d && d.open);
    } catch (e) {}
  }

  var faqIndex = null, faqPromise = null;
  function getFaq() {
    if (faqIndex) return Promise.resolve(faqIndex);
    if (!faqPromise) {
      faqPromise = fetch(FAQ_URL, { credentials: "omit" })
        .then(function (r) { if (!r.ok) throw new Error("faq " + r.status); return r.json(); })
        .then(function (j) { faqIndex = buildIndex(j); return faqIndex; })
        .catch(function () { faqPromise = null; return buildIndex([]); });
    }
    return faqPromise;
  }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // Texto plano → nodos, con URLs y correos enlazados. Nunca innerHTML.
  var LINK_RE = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  function renderText(container, text) {
    text = String(text || "").replace(/\*\*(.+?)\*\*/g, "$1");
    var last = 0, m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text))) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a;
      if (m[1]) {
        a = el("a", { href: m[1], target: "_blank", rel: "noopener" }, m[1]);
        if (isBuyLink(m[1])) { a.textContent = "Comprar el kit ↗"; a.className = "vek-buy"; a.setAttribute("data-vek-buy", "1"); }
      } else {
        a = el("a", { href: "mailto:" + m[2] }, m[2]);
      }
      container.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  }
  function isBuyLink(u) {
    var norm = function (x) { return String(x).replace(/&amp;/g, "&"); };
    return (LINK && norm(u) === norm(LINK)) || /gumroad\.com\/(checkout|l\/)/.test(u);
  }

  /* ---- construcción del DOM ---- */
  var root, launcher, panel, list, form, input, sendBtn, closeBtn, chipsBox, lastFocus;

  function build() {
    root = el("div", { "class": "vek-chat" });
    launcher = el("button", { type: "button", "class": "vek-launcher", "aria-expanded": "false", "aria-controls": "vek-panel", "aria-haspopup": "dialog" });
    launcher.appendChild(el("span", { "class": "vek-dot", "aria-hidden": "true" }));
    launcher.appendChild(el("span", null, "¿Preguntas? Escríbeme"));

    panel = el("div", { id: "vek-panel", "class": "vek-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "vek-title", hidden: "" });
    var head = el("div", { "class": "vek-head" });
    var titles = el("div");
    titles.appendChild(el("p", { id: "vek-title", "class": "vek-title" }, "Asistente del kit"));
    titles.appendChild(el("p", { "class": "vek-sub" }, ENDPOINT ? "Responde al instante" : "Respuestas rápidas sobre el kit"));
    head.appendChild(titles);
    closeBtn = el("button", { type: "button", "class": "vek-close", "aria-label": "Cerrar el chat" }, "×");
    head.appendChild(closeBtn);

    list = el("div", { "class": "vek-list", role: "log", "aria-live": "polite", "aria-relevant": "additions", tabindex: "0", "aria-label": "Conversación" });
    chipsBox = el("div", { "class": "vek-chips", role: "group", "aria-label": "Preguntas sugeridas" });

    form = el("form", { "class": "vek-form", autocomplete: "off" });
    var lab = el("label", { "for": "vek-input", "class": "vek-sr" }, "Escribe tu pregunta");
    input = el("input", { id: "vek-input", type: "text", maxlength: "1500", placeholder: "Escribe tu pregunta…", enterkeyhint: "send" });
    sendBtn = el("button", { type: "submit", "class": "vek-send", "aria-label": "Enviar" }, "Enviar");
    form.appendChild(lab); form.appendChild(input); form.appendChild(sendBtn);

    panel.appendChild(head); panel.appendChild(list); panel.appendChild(chipsBox); panel.appendChild(form);
    panel.appendChild(el("p", { "class": "vek-foot" }, "Asistente automático: puede equivocarse. Para casos puntuales, escríbenos por correo."));
    root.appendChild(panel); root.appendChild(launcher);
    document.body.appendChild(root);

    launcher.addEventListener("click", function () { state.open ? close() : open(); });
    closeBtn.addEventListener("click", close);
    form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
    panel.addEventListener("keydown", onKey);
    list.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (a && (a.getAttribute("data-vek-buy") || isBuyLink(a.getAttribute("href") || ""))) count("chat-compra");
    });
  }

  function focusables() {
    return Array.prototype.filter.call(panel.querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])"),
      function (n) { return !n.disabled && n.offsetParent !== null; });
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    var f = focusables(); if (!f.length) return;
    var first = f[0], lastEl = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
    else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
  }

  function open(silent) {
    lastFocus = document.activeElement;
    state.open = true; panel.hidden = false; root.classList.add("is-open");
    launcher.setAttribute("aria-expanded", "true");
    if (!list.childNodes.length) renderAll();
    scrollDown();
    if (!silent) { input.focus(); count("chat-abierto"); getFaq(); }
    save();
  }
  function close() {
    state.open = false; panel.hidden = true; root.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    save();
    (lastFocus && lastFocus !== document.body && document.contains(lastFocus) ? lastFocus : launcher).focus();
  }

  function scrollDown() { list.scrollTop = list.scrollHeight; }

  function bubble(role, text) {
    var b = el("div", { "class": "vek-msg vek-" + (role === "user" ? "user" : "bot") });
    renderText(b, text);
    list.appendChild(b);
    return b;
  }
  function setChips(labels) {
    chipsBox.textContent = "";
    (labels || []).forEach(function (t) {
      var c = el("button", { type: "button", "class": "vek-chip" }, t);
      c.addEventListener("click", function () { ask(t); });
      chipsBox.appendChild(c);
    });
    chipsBox.hidden = !(labels && labels.length);
  }
  function renderAll() {
    list.textContent = "";
    bubble("assistant", GREETING);
    state.msgs.forEach(function (m) { bubble(m.role, m.content); });
    var lastMsg = state.msgs[state.msgs.length - 1];
    setChips(!state.msgs.length ? CHIPS : (lastMsg && lastMsg.chips) || []);
  }

  var busy = false;
  function typing(on) {
    var t = list.querySelector(".vek-typing");
    if (on && !t) {
      t = el("div", { "class": "vek-msg vek-bot vek-typing", role: "status", "aria-label": "Escribiendo…" });
      for (var i = 0; i < 3; i++) t.appendChild(el("span", { "aria-hidden": "true" }));
      list.appendChild(t); scrollDown();
    } else if (!on && t) t.remove();
  }

  function ask(raw) {
    var text = String(raw || "").trim().slice(0, 1500);
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    input.value = "";
    setChips([]);
    state.msgs.push({ role: "user", content: text });
    bubble("user", text); scrollDown(); save();
    count("chat-pregunta");
    typing(true);
    var p = ENDPOINT ? askLLM().catch(function () { return askFAQ(text); }) : askFAQ(text);
    p.then(function (res) {
      typing(false);
      var msg = { role: "assistant", content: res.text };
      if (res.chips && res.chips.length) msg.chips = res.chips;
      state.msgs.push(msg);
      bubble("assistant", res.text);
      setChips(res.chips || []);
      scrollDown(); save();
    }).then(function () { busy = false; sendBtn.disabled = false; input.focus(); });
  }

  function askFAQ(text) {
    return getFaq().then(function (idx) {
      var chip = chipAnswer(idx, text);
      if (chip) return { text: fill(chip.respuesta) };
      var r = match(idx, text);
      if (r.entry) return { text: fill(r.entry.respuesta) };
      return {
        text: fill(NO_SE.replace("{CORREO_SOPORTE}", CORREO || "el correo de contacto al pie de la página")),
        chips: r.related.map(function (e) { return (e.preguntas && e.preguntas[0]) || ""; }).filter(Boolean).slice(0, 3)
      };
    });
  }

  function history() {
    var out = [];
    state.msgs.forEach(function (m) {
      var prev = out[out.length - 1];
      if (prev && prev.role === m.role) prev.content += "\n\n" + m.content;
      else out.push({ role: m.role, content: m.content });
    });
    out = out.slice(-10);
    while (out.length && out[0].role !== "user") out.shift();
    return out.map(function (m) { return { role: m.role, content: m.content.slice(0, 1500) }; });
  }

  function askLLM() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var timeout = new Promise(function (_, rej) { setTimeout(function () { rej(new Error("timeout")); }, TIMEOUT_MS + 50); });
    var req = fetch(ENDPOINT, {
      method: "POST", credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history() }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || typeof j.reply !== "string" || !j.reply.trim()) throw new Error("empty");
      return { text: j.reply.trim() };
    });
    return Promise.race([req, timeout]).then(function (v) { clearTimeout(timer); return v; }, function (e) { clearTimeout(timer); throw e; });
  }

  function init() {
    load();
    build(); // la conversación se restaura al abrir; el panel no se reabre solo al recargar
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
