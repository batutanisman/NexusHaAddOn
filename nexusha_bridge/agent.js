const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");

const TOKEN = process.env.SUPERVISOR_TOKEN;
const PAIR_FILE = "/data/pairing.json";
const OPTIONS_FILE = "/data/options.json";

let cloudBaseUrl = "wss://nexusha.app/tunnel";
try {
  const opts = JSON.parse(fs.readFileSync(OPTIONS_FILE, "utf8"));
  if (opts.cloud_url) cloudBaseUrl = opts.cloud_url;
} catch (e) {}

let state = { status: "connecting", code: null, agentId: null };

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
    .code { font-size: 2.4rem; font-weight: 800; letter-spacing: .15em; background: #0f172a; padding: 1rem; border-radius: .75rem; margin: 1rem 0; border: 1px dashed #38bdf8; color: #38bdf8; user-select: all; }
    button { background: #ef4444; color: #fff; border: none; padding: .75rem 1.25rem; border-radius: .5rem; font-weight: 600; cursor: pointer; margin-top: 1.5rem; width: 100%; }
    button:hover { background: #dc2626; }
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
      <div class="code">${state.code || "..."}</div>
      <p>Kod girildiğinde ekran otomatik güncellenecektir.</p>
      <script>setTimeout(() => location.reload(), 4000);<\/script>
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

function connect() {
  const creds = getCreds();
  const url = creds
    ? `${cloudBaseUrl}?agentId=${encodeURIComponent(creds.agentId)}&secret=${encodeURIComponent(creds.secret)}`
    : cloudBaseUrl;

  if (creds) state.agentId = creds.agentId;

  const ws = new WebSocket(url);

  ws.on("open", () => {
    state.status = "connected";
    if (creds) console.log("[NexusHA] Tunel aktif:", creds.agentId);
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
        return console.log("[NexusHA] Eslesme basarili:", r.agentId);
      }

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

  ws.on("close", () => setTimeout(connect, 5000));
  ws.on("error", (err) => console.error("[NexusHA] WS Hatasi:", err.message));
}

connect();
