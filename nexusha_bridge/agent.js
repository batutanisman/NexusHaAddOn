const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");

const TOKEN = process.env.SUPERVISOR_TOKEN;
const PAIR_FILE = "/data/pairing.json";
const OPTIONS_FILE = "/data/options.json";

function readAddonVersion() {
  const files = ["/app/config.yaml", __dirname + "/config.yaml", "./config.yaml"];
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, "utf8");
      const match = text.match(/^version:\s*["']?([^"'\n#]+)/m);
      if (match && match[1]) return String(match[1]).trim();
    } catch (e) {}
  }
  return "1.2.8";
}

const ADDON_VERSION = readAddonVersion();

let cloudBaseUrl = "wss://nexusha.app/tunnel";
try {
  const opts = JSON.parse(fs.readFileSync(OPTIONS_FILE, "utf8"));
  if (opts.cloud_url) cloudBaseUrl = opts.cloud_url;
} catch (e) {}

let state = { status: "connecting", code: null, agentId: null, version: ADDON_VERSION, addonVersion: ADDON_VERSION };

function getCreds() {
  try {
    return JSON.parse(fs.readFileSync(PAIR_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}

const renderHtml = () => `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NexusHA Cloud</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,.3); text-align: center; max-width: 400px; width: 90%; border: 1px solid #334155; }
    .badge { display: inline-block; padding: .35rem .85rem; border-radius: 999px; font-size: .85rem; font-weight: 600; margin-bottom: 1.2rem; }
    .ok { background: #065f46; color: #34d399; }
    .wait { background: #78350f; color: #fbbf24; }
    .code { font-size: 2.4rem; font-weight: 800; letter-spacing: .15em; background: #0f172a; padding: 1rem; border-radius: .75rem; margin: 1rem 0 0.75rem; border: 1px dashed #38bdf8; color: #38bdf8; user-select: all; }
    button { background: #ef4444; color: #fff; border: none; padding: .75rem 1.25rem; border-radius: .5rem; font-weight: 600; cursor: pointer; margin-top: 1.5rem; width: 100%; }
    button:hover { background: #dc2626; }
    .copy-btn { background: #0369a1; margin-top: 0.75rem; }
    .copy-btn:hover { background: #0284c7; }
    .copy-btn.done { background: #065f46; }
    p { color: #94a3b8; font-size: .95rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h2>NexusHA Cloud</h2>
    ${state.agentId ? `
      <span class="badge ok">● Bulut Bağlantısı Aktif</span>
      <p>Ev Kimliği: <strong>${state.agentId}</strong></p>
      <p>Uzaktan erişim ve cihaz kontrolü şu an aktif.</p>
      <form method="POST" action="reset">
        <button type="submit">Bağlantıyı Sıfırla / Yeniden Eşleş</button>
      </form>
    ` : `
      <span class="badge wait">● Eşleşme Bekleniyor</span>
      <p><strong>nexusha.app</strong> paneline girip aşağıdaki 6 haneli kodu yazın:</p>
      <div class="code" id="pair-code">${state.code || "..."}</div>
      <button type="button" class="copy-btn" id="copy-pair">Kopyala</button>
      <p>Kod girildiğinde ekran otomatik güncellenecektir.</p>
      <script>
        (function () {
          var btn = document.getElementById("copy-pair");
          var code = document.getElementById("pair-code");
          if (!btn || !code) return;
          btn.addEventListener("click", function () {
            var text = (code.textContent || "").trim();
            if (!text || text === "...") return;
            var done = function () {
              btn.textContent = "Kopyalandı ✓";
              btn.classList.add("done");
              setTimeout(function () {
                btn.textContent = "Kopyala";
                btn.classList.remove("done");
              }, 1600);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done).catch(function () {
                var area = document.createElement("textarea");
                area.value = text;
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                area.remove();
                done();
              });
            } else {
              var area = document.createElement("textarea");
              area.value = text;
              document.body.appendChild(area);
              area.select();
              document.execCommand("copy");
              area.remove();
              done();
            }
          });
        })();
        setTimeout(function () { location.reload(); }, 4000);
      <\/script>
    `}
  </div>
</body>
</html>`;

// Home Assistant Ingress Yerel Web Sunucusu
http.createServer((req, res) => {
  if (req.method === "POST" && req.url.endsWith("/reset")) {
    try { fs.unlinkSync(PAIR_FILE); } catch (e) {}
    state = { status: "connecting", code: null, agentId: null };
    res.writeHead(302, { Location: "./" });
    res.end();
    return setTimeout(() => process.exit(0), 300);
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderHtml());
}).listen(8099, "0.0.0.0");

function supervisorRequest(method, urlPath, payload) {
  const hasBody = payload !== undefined;
  const data = hasBody ? JSON.stringify(payload == null ? {} : payload) : "";
  return new Promise((resolve, reject) => {
    const headers = { Authorization: `Bearer ${TOKEN}` };
    if (hasBody) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = http.request({
      hostname: "supervisor",
      port: 80,
      path: urlPath,
      method: method || "GET",
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (hasBody) req.write(data);
    req.end();
  });
}

function supervisorPost(urlPath, payload) {
  return supervisorRequest("POST", urlPath, payload == null ? {} : payload);
}

function supervisorGet(urlPath) {
  return supervisorRequest("GET", urlPath);
}

function automationReply(ws, reqId, ok, error, category) {
  const message = { type: "save_ha_automation_result", reqId, ok: Boolean(ok) };
  if (!ok) message.error = String(error || "Kayıt başarısız.");
  else if (category) message.category = category;
  try { ws.send(JSON.stringify(message)); } catch (e) {}
}

function sceneReply(ws, reqId, ok, error, executedCount) {
  const message = {
    type: "run_scene_result",
    reqId,
    ok: Boolean(ok),
    executedCount: Number(executedCount) || 0
  };
  if (!ok) message.error = String(error || "Sahne çalıştırılamadı.").replace(/\s+/g, " ").trim().slice(0, 180);
  try { ws.send(JSON.stringify(message)); } catch (e) {}
}

const SCENE_SERVICE_DOMAINS = new Set([
  "light", "switch", "climate", "cover", "lock", "fan", "media_player",
  "vacuum", "scene", "script", "input_boolean", "input_number", "input_select",
  "humidifier", "water_heater", "remote", "button"
]);

function normalizeSceneAction(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const entityId = String(item.entity_id || item.entity || "").trim();
  if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(entityId)) return null;
  const domain = String(item.domain || entityId.split(".")[0] || "").trim().toLowerCase();
  const service = String(item.service || item.action || "").trim();
  if (!domain || !service || !SCENE_SERVICE_DOMAINS.has(domain)) return null;
  if (!/^[a-z][a-z0-9_]*$/.test(service)) return null;
  const data = item.service_data && typeof item.service_data === "object" && !Array.isArray(item.service_data)
    ? item.service_data
    : item.data && typeof item.data === "object" && !Array.isArray(item.data)
      ? item.data
      : {};
  const payload = Object.assign({}, data, { entity_id: entityId });
  return { domain, service, payload };
}

async function runScene(message) {
  const actions = Array.isArray(message && message.actions) ? message.actions : [];
  if (!actions.length) throw new Error("Sahne aksiyonu yok.");
  if (actions.length > 80) throw new Error("Sahne aksiyon limiti aşıldı.");
  let executedCount = 0;
  for (const raw of actions) {
    const action = normalizeSceneAction(raw);
    if (!action) throw new Error("Geçersiz sahne aksiyonu.");
    const result = await supervisorPost(
      `/core/api/services/${encodeURIComponent(action.domain)}/${encodeURIComponent(action.service)}`,
      action.payload
    );
    if (result.status < 200 || result.status >= 300) {
      const detail = String(result.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(detail || `${action.domain}.${action.service} reddedildi.`);
    }
    executedCount += 1;
  }
  return { ok: true, executedCount };
}

function versionPayload(type) {
  return {
    type: type || "addon_version",
    addonVersion: ADDON_VERSION,
    version: ADDON_VERSION,
    agentId: state.agentId || null
  };
}

function reportVersion(ws, type) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try { ws.send(JSON.stringify(versionPayload(type || "addon_version"))); } catch (e) {}
}

function sendHello(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const creds = getCreds();
  try {
    ws.send(JSON.stringify({
      type: creds ? "register" : "hello",
      addonVersion: ADDON_VERSION,
      version: ADDON_VERSION,
      agentId: (creds && creds.agentId) || state.agentId || null
    }));
  } catch (e) {}
}

function updateAddonReply(ws, reqId, ok, error, extra) {
  const message = {
    type: "update_addon_result",
    reqId,
    ok: Boolean(ok),
    addonVersion: ADDON_VERSION,
    version: ADDON_VERSION
  };
  if (extra && typeof extra === "object") Object.assign(message, extra);
  if (!ok) message.error = String(error || "Güncelleme başarısız.").replace(/\s+/g, " ").trim().slice(0, 180);
  try { ws.send(JSON.stringify(message)); } catch (e) {}
}

function supervisorOk(result) {
  return result && result.status >= 200 && result.status < 300;
}

function parseSupervisorJson(result) {
  try { return JSON.parse((result && result.body) || "{}"); } catch (e) { return {}; }
}

async function updateAddon() {
  if (!TOKEN) throw new Error("SUPERVISOR_TOKEN yok.");
  const reloaded = await supervisorPost("/store/reload", {});
  if (!supervisorOk(reloaded)) {
    const detail = String(reloaded && reloaded.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(detail || "Store yenilenemedi.");
  }
  const info = await supervisorGet("/addons/self/info");
  if (!supervisorOk(info)) {
    const detail = String(info && info.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(detail || "Eklenti bilgisi alınamadı.");
  }
  const payload = parseSupervisorJson(info);
  const data = payload && payload.data && typeof payload.data === "object" ? payload.data : payload;
  const updateAvailable = data && data.update_available === true;
  const action = updateAvailable ? "update" : "rebuild";
  const triggered = updateAvailable
    ? await supervisorPost("/addons/self/update", {})
    : await supervisorPost("/addons/self/rebuild", {});
  if (!supervisorOk(triggered)) {
    const detail = String(triggered && triggered.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(detail || (updateAvailable ? "Güncelleme başlatılamadı." : "Rebuild başlatılamadı."));
  }
  return { ok: true, status: "updating", action };
}

function haCommandSocket() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket("ws://supervisor/core/websocket");
    const pending = new Map();
    let nextId = 1;
    let settled = false;
    const timer = setTimeout(() => fail(new Error("Home Assistant soketi zaman aşımına uğradı.")), 8000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      reject(error);
    }
    function send(type, fields) {
      const id = nextId++;
      return new Promise((res, rej) => {
        const commandTimer = setTimeout(() => {
          pending.delete(id);
          rej(new Error("Home Assistant komutu zaman aşımına uğradı."));
        }, 8000);
        pending.set(id, {
          res: (value) => { clearTimeout(commandTimer); res(value); },
          rej: (error) => { clearTimeout(commandTimer); rej(error); }
        });
        socket.send(JSON.stringify(Object.assign({ id, type }, fields || {})));
      });
    }
    socket.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg.type === "auth_required") {
        socket.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
        return;
      }
      if (msg.type === "auth_invalid") return fail(new Error(msg.message || "auth_invalid"));
      if (msg.type === "auth_ok") {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          send,
          close: () => { try { socket.close(); } catch (e) {} }
        });
        return;
      }
      if (msg.type === "result" && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.success) waiter.res(msg.result);
        else waiter.rej(new Error((msg.error && msg.error.message) || "Komut reddedildi."));
      }
    });
    socket.on("error", (err) => fail(err));
    socket.on("close", () => {
      for (const waiter of pending.values()) waiter.rej(new Error("Soket kapandı."));
      pending.clear();
    });
  });
}

function sameText(value, expected) {
  return String(value || "").trim().toLowerCase() === String(expected || "").trim().toLowerCase();
}

async function findSavedEntity(link, kind, id, config) {
  const direct = kind + "." + id;
  const alias = String((config && (config.alias || config.name)) || "").trim();
  let states = [];
  try { states = await link.send("get_states"); } catch (e) { return direct; }
  const list = (Array.isArray(states) ? states : []).filter((item) => String(item.entity_id || "").startsWith(kind + "."));
  const byObject = list.find((item) => item.entity_id === direct);
  if (byObject) return byObject.entity_id;
  const byConfig = list.find((item) => String(item.attributes && item.attributes.id || "") === id);
  if (byConfig) return byConfig.entity_id;
  if (alias) {
    const byName = list.find((item) => sameText(item.attributes && (item.attributes.friendly_name || item.attributes.alias), alias));
    if (byName) return byName.entity_id;
  }
  return direct;
}

async function assignNexusCategory(kind, id, config) {
  const link = await haCommandSocket();
  try {
    const listed = await link.send("config/category_registry/list", { scope: kind });
    const existing = (Array.isArray(listed) ? listed : []).find((item) => sameText(item && item.name, "NexusHA AI"));
    let categoryId = existing && existing.category_id;
    if (!categoryId) {
      const created = await link.send("config/category_registry/create", { scope: kind, name: "NexusHA AI", icon: "mdi:creation" });
      categoryId = created && created.category_id;
    }
    if (!categoryId) throw new Error("Kategori kimliği alınamadı.");
    const entityId = await findSavedEntity(link, kind, id, config);
    const categories = {};
    categories[kind] = categoryId;
    await link.send("config/entity_registry/update", { entity_id: entityId, categories });
  } finally {
    link.close();
  }
}

async function saveHaAutomation(message) {
  const kind = message.kind === "scene" ? "scene" : message.kind === "automation" ? "automation" : "";
  const id = String(message.id || "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 80);
  if (!kind || !id || !message.config || typeof message.config !== "object" || Array.isArray(message.config)) {
    throw new Error("Eksik otomasyon verisi.");
  }
  const saved = await supervisorPost(`/core/api/config/${kind}/config/${encodeURIComponent(id)}`, message.config);
  if (saved.status < 200 || saved.status >= 300) {
    const detail = saved.body.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(detail || "Home Assistant kaydı reddetti.");
  }
  const reloaded = await supervisorPost(`/core/api/services/${kind}/reload`, {});
  if (reloaded.status < 200 || reloaded.status >= 300) {
    const detail = reloaded.body.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(detail || "Kaydedildi ama yeniden yüklenemedi.");
  }
  try {
    await assignNexusCategory(kind, id, message.config);
  } catch (error) {
    console.error("[NexusHA] Kategori atanamadi:", error.message);
  }
  return "NexusHA AI";
}

let tunnel = null;
const STATE_DOMAINS = new Set([
  "light", "switch", "climate", "cover", "lock", "fan", "media_player",
  "vacuum", "binary_sensor", "person", "alarm_control_panel", "automation", "scene"
]);

function sendHaState(newState) {
  if (!newState || typeof newState !== "object" || !newState.entity_id) return;
  const domain = String(newState.entity_id).split(".")[0];
  if (!STATE_DOMAINS.has(domain)) return;
  if (!tunnel || tunnel.readyState !== WebSocket.OPEN) return;
  try {
    tunnel.send(JSON.stringify({ type: "ha_state_changed", state: newState }));
  } catch (e) {}
}

function listenHaStates() {
  const socket = new WebSocket("ws://supervisor/core/websocket");
  let closed = false;
  let pingTimer = null;
  const reconnect = () => {
    if (closed) return;
    closed = true;
    if (pingTimer) clearInterval(pingTimer);
    try { socket.close(); } catch (e) {}
    setTimeout(listenHaStates, 5000);
  };
  socket.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.type === "auth_required") {
      socket.send(JSON.stringify({ type: "auth", access_token: TOKEN }));
      return;
    }
    if (msg.type === "auth_invalid") {
      console.error("[NexusHA] HA olay auth:", msg.message || "auth_invalid");
      reconnect();
      return;
    }
    if (msg.type === "auth_ok") {
      socket.send(JSON.stringify({ id: 1, type: "subscribe_events", event_type: "state_changed" }));
      pingTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try { socket.send(JSON.stringify({ id: Date.now(), type: "ping" })); } catch (e) {}
      }, 30000);
      console.log("[NexusHA] state_changed dinleniyor");
      return;
    }
    if (msg.type === "event" && msg.event && msg.event.event_type === "state_changed") {
      sendHaState(msg.event.data && msg.event.data.new_state);
    }
  });
  socket.on("close", () => {
    console.error("[NexusHA] HA olay soketi kapandi, 5 sn sonra yeniden baglanacak");
    reconnect();
  });
  socket.on("error", (err) => {
    console.error("[NexusHA] HA olay soketi:", err.message);
    reconnect();
  });
}

function connect() {
  const creds = getCreds();
  const url = creds
    ? `${cloudBaseUrl}?agentId=${encodeURIComponent(creds.agentId)}&secret=${encodeURIComponent(creds.secret)}`
    : cloudBaseUrl;

  if (creds) state.agentId = creds.agentId;

  const ws = new WebSocket(url);
  tunnel = ws;
  let keepAlive = null;

  ws.on("open", () => {
    state.status = "connected";
    if (creds) console.log("[NexusHA] Tunel aktif:", creds.agentId, "v" + ADDON_VERSION);
    else console.log("[NexusHA] Tunel baglandi, surum:", ADDON_VERSION);
    sendHello(ws);
    reportVersion(ws, "addon_version");
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try { ws.ping(); } catch (e) {}
      try {
        ws.send(JSON.stringify({
          type: "heartbeat",
          addonVersion: ADDON_VERSION,
          version: ADDON_VERSION,
          agentId: state.agentId || null
        }));
      } catch (e) {}
    }, 20000);
  });

  ws.on("ping", () => ws.pong());

  ws.on("message", (raw) => {
    try {
      const r = JSON.parse(raw.toString());

      if (r.type === "pair_code") {
        state.code = r.code;
        return console.log("[NexusHA] Eslesme Kodu:", r.code);
      }

      if (r.type === "paired") {
        fs.writeFileSync(PAIR_FILE, JSON.stringify({ agentId: r.agentId, secret: r.secret }));
        state.agentId = r.agentId;
        state.code = null;
        sendHello(ws);
        reportVersion(ws, "register");
        return console.log("[NexusHA] Eslesme basarili:", r.agentId, "v" + ADDON_VERSION);
      }

      if (r.type === "save_ha_automation") {
        saveHaAutomation(r)
          .then((category) => automationReply(ws, r.reqId, true, "", category))
          .catch((err) => automationReply(ws, r.reqId, false, err.message));
        return;
      }

      if (r.type === "run_scene" || r.type === "execute_scene") {
        runScene(r)
          .then((result) => sceneReply(ws, r.reqId, true, "", result.executedCount))
          .catch((err) => sceneReply(ws, r.reqId, false, err.message, 0));
        return;
      }

      if (r.type === "update_addon") {
        updateAddon()
          .then((result) => updateAddonReply(ws, r.reqId, true, "", {
            status: result.status || "updating",
            action: result.action || ""
          }))
          .catch((err) => updateAddonReply(ws, r.reqId, false, err.message));
        return;
      }

      if (!r.path) return;
      const targetPath = r.path.startsWith("/api") ? `/core${r.path}` : `/core/api${r.path}`;
      const haReq = http.request({
        hostname: "supervisor",
        port: 80,
        path: targetPath,
        method: r.method || "GET",
        headers: {
          "Authorization": `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }, (haRes) => {
        const chunks = [];
        haRes.on("data", (d) => chunks.push(d));
        haRes.on("end", () => {
          ws.send(JSON.stringify({
            requestId: r.requestId,
            status: haRes.statusCode,
            headers: { "Content-Type": haRes.headers["content-type"] || "application/json" },
            body: Buffer.concat(chunks).toString("utf8")
          }));
        });
      });

      haReq.on("error", (err) => {
        ws.send(JSON.stringify({ requestId: r.requestId, status: 502, body: err.message }));
      });

      if (r.body) haReq.write(r.body);
      haReq.end();
    } catch (e) {
      console.error("[NexusHA] Hata:", e.message);
    }
  });

  ws.on("close", () => {
    if (keepAlive) clearInterval(keepAlive);
    if (tunnel === ws) tunnel = null;
    setTimeout(connect, 5000);
  });
  ws.on("error", (err) => console.error("[NexusHA] WS Hatasi:", err.message));
}

connect();
listenHaStates();
