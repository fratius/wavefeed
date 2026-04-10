import { useState, useRef, useEffect, useCallback } from "react";

// ─── Storage helpers (localStorage for PWA, no window.storage) ───────────────
const store = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, val); } catch {} },
};

// ─── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(prompt, apiKey) {
  const headers = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  } else {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const MAX = apiKey ? 2 : 6;
  for (let i = 0; i < MAX; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 600));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const raw = await res.text();
      if (!raw || raw.length < 10) continue;
      if (!res.ok) throw new Error(`API ${res.status}: ${JSON.parse(raw)?.error?.message || raw.slice(0, 80)}`);
      const data = JSON.parse(raw);
      const text = data.content?.find(b => b.type === "text")?.text || "";
      if (!text) continue;
      const stripped = text.replace(/```json|```/gi, "").trim();
      const s = stripped.indexOf("{"), e = stripped.lastIndexOf("}");
      if (s === -1 || e === -1) throw new Error("No JSON in response");
      return JSON.parse(stripped.slice(s, e + 1));
    } catch (e) {
      if (i === MAX - 1) throw e;
    }
  }
  throw new Error("API not responding — try again");
}

const ANALYZE_PROMPT = (input) =>
  `Analyze this song, respond ONLY in JSON no markdown:
{"title":"...","artist":"...","genre":{"primary":"...","secondary":"..."},"mood":{"emotion":"...","energy":"Low|Medium|High"},"mood_tags":["...","...","..."],"tempo":{"bpm_range":"...","label":"Slow|Mid-tempo|Fast|Very Fast"},"era":"...","use_cases":["...","..."],"summary":"one evocative sentence","color":"#hexcolor"}
Song: ${input}`;

const RECO_PROMPT = (song) =>
  `Recommend 5 songs similar to "${song.title}" by ${song.artist}. Genre: ${song.genre?.primary||"?"}, Mood: ${song.mood?.emotion||"?"}, Era: ${song.era||"?"}.
Respond ONLY in JSON no markdown:
{"recommendations":[{"title":"...","artist":"...","reason":"one sentence","mood_tags":["...","..."],"mood_contrast":"Aligned|Adjacent|Opposite","energy":"Low|Medium|High","color":"#hex","mood_score":80,"bpm_score":75,"vibe_score":85,"theme_score":70}]}`;

// ─── Streaming deep links ─────────────────────────────────────────────────────
function getStreamLinks(title, artist) {
  const q = encodeURIComponent(`${title} ${artist}`);
  const qPlain = `${title} ${artist}`;
  return [
    {
      id: "ytmusic",
      name: "YT Music",
      color: "#ff0000",
      icon: "▶",
      // Deep link: tries to open YT Music app, falls back to web
      getUrl: () => {
        // On iOS, youtube music:// scheme opens the app
        // We use a universal link that iOS will route to the app if installed
        return `https://music.youtube.com/search?q=${q}`;
      },
      getAppUrl: () => `youtubemusic://search/${q}`,
    },
    {
      id: "spotify",
      name: "Spotify",
      color: "#1db954",
      icon: "♫",
      getUrl: () => `https://open.spotify.com/search/${q}`,
      getAppUrl: () => `spotify:search:${qPlain}`,
    },
    {
      id: "apple",
      name: "Apple Music",
      color: "#fc3c44",
      icon: "♪",
      getUrl: () => `https://music.apple.com/search?term=${q}`,
      getAppUrl: () => `music://music.apple.com/search?term=${q}`,
    },
  ];
}

// Try app deep link first, fallback to web URL
function openStreamLink(appUrl, webUrl) {
  // On iOS Safari, try the app scheme; if it fails after 500ms, open web
  const start = Date.now();
  const fallbackTimer = setTimeout(() => {
    if (Date.now() - start < 1500) {
      window.open(webUrl, "_blank");
    }
  }, 500);
  window.location.href = appUrl;
  // Clear timer if page hides (app opened)
  window.addEventListener("blur", () => clearTimeout(fallbackTimer), { once: true });
  window.addEventListener("pagehide", () => clearTimeout(fallbackTimer), { once: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hexRgb(hex = "#b44aff") {
  const c = (hex || "#b44aff").replace("#", "").padEnd(6, "0");
  return `${parseInt(c.slice(0,2),16)||180},${parseInt(c.slice(2,4),16)||74},${parseInt(c.slice(4,6),16)||255}`;
}

const CONTRAST = {
  Aligned:  { color: "#4aff9e", icon: "≈" },
  Adjacent: { color: "#ffb44a", icon: "~" },
  Opposite: { color: "#ff4a6a", icon: "≠" },
};

// ─── Score Bar ────────────────────────────────────────────────────────────────
function ScoreBar({ label, score, color }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
      <span style={{ fontSize:"0.55rem", color:"rgba(255,255,255,0.28)", textTransform:"uppercase", letterSpacing:"0.08em", width:38, flexShrink:0 }}>{label}</span>
      <div style={{ flex:1, height:2, background:"rgba(255,255,255,0.07)", borderRadius:2, overflow:"hidden" }}>
        <div style={{ width:`${score||0}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.6s ease" }}/>
      </div>
      <span style={{ fontSize:"0.6rem", color, fontFamily:"'Bebas Neue',cursive", width:22, textAlign:"right", flexShrink:0 }}>{score||0}</span>
    </div>
  );
}

// ─── Stream Buttons ───────────────────────────────────────────────────────────
function StreamButtons({ title, artist, size = "normal" }) {
  const links = getStreamLinks(title, artist);
  const isSmall = size === "small";
  return (
    <div style={{ display:"flex", gap: isSmall ? 4 : 6 }}>
      {links.map(({ id, name, color, icon, getUrl, getAppUrl }) => (
        <button key={id}
          onClick={() => openStreamLink(getAppUrl(), getUrl())}
          style={{
            flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap: isSmall ? 3 : 4,
            fontSize: isSmall ? "0.52rem" : "0.6rem",
            color, background:`${color}10`, border:`1px solid ${color}28`,
            borderRadius: isSmall ? 5 : 7,
            padding: isSmall ? "0.22rem 0.3rem" : "0.35rem 0.4rem",
            fontFamily:"'DM Mono',monospace", cursor:"pointer",
            WebkitTapHighlightColor:"transparent",
            transition:"background 0.15s",
          }}
          onTouchStart={e => e.currentTarget.style.background = `${color}22`}
          onTouchEnd={e => e.currentTarget.style.background = `${color}10`}
        >
          <span style={{ fontSize: isSmall ? "0.6rem" : "0.7rem" }}>{icon}</span>
          {isSmall ? name.split(" ")[0] : name}
        </button>
      ))}
    </div>
  );
}

// ─── Reco Card ────────────────────────────────────────────────────────────────
function RecoCard({ reco, depth = 0, apiKey }) {
  const [children, setChildren] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [err,      setErr]      = useState("");
  const [showKids, setShowKids] = useState(true);
  const color = reco.color || "#b44aff";
  const rgb   = hexRgb(color);
  const cc    = CONTRAST[reco.mood_contrast];
  const overall = Math.round(((reco.mood_score||0)+(reco.bpm_score||0)+(reco.vibe_score||0)+(reco.theme_score||0))/4);
  const oColor  = overall >= 80 ? "#b44aff" : overall >= 60 ? "#4a9eff" : "#555568";

  async function findSimilar() {
    setLoading(true); setErr("");
    try { setChildren((await callClaude(RECO_PROMPT(reco), apiKey)).recommendations || []); setShowKids(true); }
    catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ marginLeft: Math.min(depth * 10, 30) }}>
      <div style={{ background: depth%2===0 ? "#0e0e1a" : "#0b0b14", border:`1px solid rgba(${rgb},0.12)`, borderLeft:`2px solid ${color}`, borderRadius:7, padding:"0.75rem", marginBottom:5 }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, marginBottom:5 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"0.95rem", color:"#f0ebe0", letterSpacing:"0.04em" }}>{reco.title}</div>
            <div style={{ fontSize:"0.65rem", color:"rgba(255,255,255,0.3)", marginTop:1 }}>{reco.artist}</div>
          </div>
          <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"1rem", color:oColor, border:`1px solid ${oColor}33`, borderRadius:4, padding:"0.1rem 0.35rem", flexShrink:0 }}>
            {overall}
          </div>
        </div>

        {(reco.mood_tags?.length > 0 || cc) && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:3, marginBottom:6, alignItems:"center" }}>
            {(reco.mood_tags||[]).map((t,i) => (
              <span key={i} style={{ fontSize:"0.52rem", color:"rgba(255,255,255,0.4)", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:3, padding:"0.08rem 0.3rem" }}>{t}</span>
            ))}
            {cc && (
              <span style={{ marginLeft:"auto", fontSize:"0.52rem", color:cc.color, background:`${cc.color}12`, border:`1px solid ${cc.color}30`, borderRadius:3, padding:"0.08rem 0.35rem", fontFamily:"'Bebas Neue',cursive" }}>
                {cc.icon} {reco.mood_contrast}
              </span>
            )}
          </div>
        )}

        <p style={{ fontSize:"0.62rem", color:"rgba(255,255,255,0.28)", fontStyle:"italic", lineHeight:1.4, marginBottom:7 }}>{reco.reason}</p>

        <div style={{ display:"flex", flexDirection:"column", gap:3, marginBottom:7 }}>
          <ScoreBar label="Mood"  score={reco.mood_score}  color="#ff4a6a" />
          <ScoreBar label="BPM"   score={reco.bpm_score}   color="#4a9eff" />
          <ScoreBar label="Vibe"  score={reco.vibe_score}  color="#b44aff" />
          <ScoreBar label="Theme" score={reco.theme_score} color="#4aff9e" />
        </div>

        <StreamButtons title={reco.title} artist={reco.artist} size="small" />

        <div style={{ marginTop:7 }}>
          {!children && !loading && (
            <button onClick={findSimilar} style={{ width:"100%", background:"none", border:`1px dashed rgba(${rgb},0.25)`, color:`rgba(${rgb},0.6)`, fontFamily:"'DM Mono',monospace", fontSize:"0.58rem", letterSpacing:"0.06em", padding:"0.28rem", borderRadius:4, cursor:"pointer", WebkitTapHighlightColor:"transparent" }}>
              ✦ drill deeper
            </button>
          )}
          {loading && <LoadingDots color={color} label="Finding…" />}
          {err && <ErrorRow msg={err} onRetry={findSimilar} />}
          {children && (
            <button onClick={() => setShowKids(v => !v)} style={{ background:"none", border:"none", color:`rgba(${rgb},0.6)`, fontFamily:"'DM Mono',monospace", fontSize:"0.58rem", cursor:"pointer", padding:0 }}>
              {showKids ? "▾ hide" : `▸ show ${children.length} similar`}
            </button>
          )}
        </div>
      </div>
      {children && showKids && children.map((c,i) => <RecoCard key={`${c.title}-${depth}-${i}`} reco={c} depth={depth+1} apiKey={apiKey} />)}
    </div>
  );
}

// ─── Shared micro-components ──────────────────────────────────────────────────
function LoadingDots({ color, label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, color:"rgba(255,255,255,0.25)", fontSize:"0.62rem" }}>
      {[0,.15,.3].map((d,i) => <div key={i} style={{ width:5, height:5, background:color, borderRadius:"50%", animation:`dot 1.1s ${d}s ease-in-out infinite` }}/>)}
      <span>{label}</span>
    </div>
  );
}
function ErrorRow({ msg, onRetry }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
      <span style={{ fontSize:"0.62rem", color:"#ff4a6a", flex:1 }}>⚠ {msg}</span>
      <button onClick={onRetry} style={{ background:"none", border:"1px solid rgba(255,74,106,0.3)", color:"#ff4a6a", fontFamily:"'DM Mono',monospace", fontSize:"0.58rem", padding:"0.15rem 0.4rem", borderRadius:4, cursor:"pointer", flexShrink:0 }}>Retry</button>
    </div>
  );
}

// ─── Song Card ────────────────────────────────────────────────────────────────
function SongCard({ song, onRemove, index, apiKey }) {
  const color = song.color || "#b44aff";
  const rgb   = hexRgb(color);
  const [recos,      setRecos]      = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [err,        setErr]        = useState("");
  const [showRecos,  setShowRecos]  = useState(true);

  async function findSimilar() {
    setLoading(true); setErr("");
    try { setRecos((await callClaude(RECO_PROMPT(song), apiKey)).recommendations || []); setShowRecos(true); }
    catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background:"#0f0f1c", border:`1px solid rgba(${rgb},0.15)`, borderTop:`2px solid ${color}`, borderRadius:12, padding:"1.25rem", position:"relative", animation:`cardIn 0.4s ease ${index*0.06}s both` }}>
      <button onClick={onRemove} style={{ position:"absolute", top:"0.9rem", right:"0.9rem", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"rgba(255,255,255,0.25)", cursor:"pointer", fontSize:"0.65rem", width:24, height:24, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", WebkitTapHighlightColor:"transparent" }}>✕</button>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", gap:11, marginBottom:"0.8rem" }}>
        <div style={{ width:42, height:42, minWidth:42, background:`rgba(${rgb},0.08)`, border:`1px solid rgba(${rgb},0.18)`, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"1.2rem", color, flexShrink:0 }}>♫</div>
        <div style={{ flex:1, minWidth:0, paddingRight:"1.8rem" }}>
          <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"1.3rem", color:"#f0ebe0", lineHeight:1.1, letterSpacing:"0.04em" }}>{song.title}</div>
          <div style={{ fontSize:"0.72rem", color:"rgba(255,255,255,0.38)", marginTop:2 }}>{song.artist}</div>
        </div>
      </div>

      {/* Summary */}
      <p style={{ fontSize:"0.7rem", color:"rgba(255,255,255,0.32)", fontStyle:"italic", lineHeight:1.5, marginBottom:"0.9rem", borderLeft:`2px solid rgba(${rgb},0.25)`, paddingLeft:"0.6rem" }}>"{song.summary}"</p>

      {/* Meta grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.6rem", marginBottom:"0.85rem" }}>
        {[
          ["Genre", song.genre?.primary, song.genre?.secondary],
          ["Mood",  song.mood?.emotion,  song.mood?.energy],
          ["Tempo", song.tempo?.label,   `${song.tempo?.bpm_range} BPM`],
          ["Era",   song.era],
        ].map(([label, val, sub]) => (
          <div key={label} style={{ display:"flex", flexDirection:"column", gap:2 }}>
            <span style={{ fontSize:"0.52rem", color:"rgba(255,255,255,0.22)", textTransform:"uppercase", letterSpacing:"0.14em" }}>{label}</span>
            <span style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"0.85rem", color:"#d0ccc0", letterSpacing:"0.04em" }}>{val}</span>
            {sub && <span style={{ fontSize:"0.62rem", color:"rgba(255,255,255,0.28)" }}>{sub}</span>}
          </div>
        ))}
      </div>

      {/* Mood tags */}
      {song.mood_tags?.length > 0 && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:"0.85rem" }}>
          {song.mood_tags.map((t,i) => (
            <span key={i} style={{ fontSize:"0.58rem", color:`rgba(${rgb},0.7)`, background:`rgba(${rgb},0.07)`, border:`1px solid rgba(${rgb},0.18)`, borderRadius:4, padding:"0.1rem 0.38rem" }}>{t}</span>
          ))}
        </div>
      )}

      {/* Stream buttons — the main feature */}
      <div style={{ marginBottom:"1rem" }}>
        <div style={{ fontSize:"0.52rem", color:"rgba(255,255,255,0.2)", letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:5 }}>Open in</div>
        <StreamButtons title={song.title} artist={song.artist} />
      </div>

      {/* Recommendations */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:"0.85rem" }}>
        {!recos && !loading && (
          <button onClick={findSimilar} style={{ width:"100%", background:`rgba(${rgb},0.04)`, border:`1px dashed rgba(${rgb},0.3)`, color:`rgba(${rgb},0.75)`, fontFamily:"'DM Mono',monospace", fontSize:"0.65rem", letterSpacing:"0.1em", padding:"0.52rem", borderRadius:7, cursor:"pointer", WebkitTapHighlightColor:"transparent" }}>
            ✦ Find Similar Songs
          </button>
        )}
        {loading && <LoadingDots color={color} label="Generating recommendations…" />}
        {err && <ErrorRow msg={err} onRetry={findSimilar} />}
        {recos && (
          <>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
              <span style={{ fontSize:"0.6rem", color, letterSpacing:"0.1em", textTransform:"uppercase" }}>✦ {recos.length} Similar Songs</span>
              <button onClick={() => setShowRecos(v => !v)} style={{ background:"none", border:"none", color:"rgba(255,255,255,0.22)", fontFamily:"'DM Mono',monospace", fontSize:"0.58rem", cursor:"pointer" }}>
                {showRecos ? "hide" : "show"}
              </button>
            </div>
            {showRecos && recos.map((r,i) => <RecoCard key={`${r.title}-${i}`} reco={r} depth={0} apiKey={apiKey} />)}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ apiKey, onSave, onClose }) {
  const [input,  setInput]  = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [result,  setResult]  = useState(null);

  async function test() {
    const k = input.trim();
    if (!k) return;
    setTesting(true); setResult(null);
    try {
      await callClaude('Say only: {"ok":true}', k);
      setResult({ ok:true, msg:"Connection successful ✦" });
    } catch(e) {
      setResult({ ok:false, msg:e.message });
    } finally { setTesting(false); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(5,5,12,0.96)", backdropFilter:"blur(20px)", display:"flex", alignItems:"center", justifyContent:"center", padding:"1.25rem", zIndex:300, animation:"fadeIn 0.2s ease" }}
      onClick={e => { if(e.target===e.currentTarget) onClose(); }}>
      <div style={{ width:"100%", maxWidth:440, background:"#0d0d1a", border:"1px solid rgba(255,255,255,0.08)", borderRadius:18, padding:"1.75rem", animation:"slideUp 0.22s ease" }}>
        <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"1.5rem", color:"#f0ebe0", letterSpacing:"0.06em", marginBottom:4 }}>API Key</div>
        <p style={{ fontSize:"0.65rem", color:"rgba(255,255,255,0.28)", lineHeight:1.65, marginBottom:"1.25rem" }}>
          Your own Anthropic key gives you a direct, reliable connection with no proxy throttling. Get one free at <span style={{ color:"#b44aff" }}>console.anthropic.com</span>.
        </p>

        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:"1rem", padding:"0.55rem 0.75rem", background:"rgba(255,255,255,0.03)", borderRadius:8, border:`1px solid ${apiKey?"rgba(74,255,158,0.18)":"rgba(255,255,255,0.05)"}` }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:apiKey?"#4aff9e":"rgba(255,255,255,0.15)", flexShrink:0 }}/>
          <span style={{ fontSize:"0.62rem", color:apiKey?"#4aff9e":"rgba(255,255,255,0.28)" }}>
            {apiKey ? `Active: sk-ant-...${apiKey.slice(-6)}` : "No key — using proxy"}
          </span>
        </div>

        <input value={input} onChange={e => { setInput(e.target.value); setResult(null); }}
          placeholder="sk-ant-api03-..." type="password"
          style={{ width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:9, padding:"0.65rem 0.9rem", color:"#fff", fontFamily:"'DM Mono',monospace", fontSize:"0.82rem", outline:"none", marginBottom:"0.7rem" }}
        />

        {result && (
          <div style={{ marginBottom:"0.7rem", padding:"0.45rem 0.7rem", background:result.ok?"rgba(74,255,158,0.06)":"rgba(255,74,106,0.06)", border:`1px solid ${result.ok?"rgba(74,255,158,0.22)":"rgba(255,74,106,0.22)"}`, borderRadius:7, fontSize:"0.62rem", color:result.ok?"#4aff9e":"#ff4a6a" }}>
            {result.ok ? "✦ " : "⚠ "}{result.msg}
          </div>
        )}

        <div style={{ display:"flex", gap:7 }}>
          <button onClick={() => { onSave(input.trim()); onClose(); }} style={{ flex:1, background:"#b44aff", border:"none", color:"#fff", borderRadius:9, padding:"0.62rem", fontFamily:"'Bebas Neue',cursive", fontSize:"0.95rem", letterSpacing:"0.08em", cursor:"pointer" }}>
            Save
          </button>
          <button onClick={test} disabled={testing || !input.trim()} style={{ background:"none", border:`1px solid ${testing||!input.trim()?"rgba(74,255,158,0.2)":"rgba(74,255,158,0.4)"}`, color:testing||!input.trim()?"rgba(74,255,158,0.3)":"#4aff9e", borderRadius:9, padding:"0.62rem 0.9rem", fontFamily:"'DM Mono',monospace", fontSize:"0.65rem", cursor:testing||!input.trim()?"not-allowed":"pointer", whiteSpace:"nowrap" }}>
            {testing ? "…" : "Test"}
          </button>
          {apiKey && (
            <button onClick={() => { onSave(""); onClose(); }} style={{ background:"none", border:"1px solid rgba(255,74,106,0.28)", color:"#ff4a6a", borderRadius:9, padding:"0.62rem 0.75rem", fontFamily:"'DM Mono',monospace", fontSize:"0.65rem", cursor:"pointer" }}>
              Clear
            </button>
          )}
        </div>

        <p style={{ fontSize:"0.58rem", color:"rgba(255,255,255,0.15)", marginTop:"1rem", lineHeight:1.6 }}>
          Key is stored in your browser only and sent directly to api.anthropic.com.
        </p>
      </div>
    </div>
  );
}

// ─── Add Song Modal ───────────────────────────────────────────────────────────
function AddModal({ onAdd, onClose }) {
  const [input,     setInput]     = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [err,       setErr]       = useState("");

  async function submit(apiKey) {
    const q = input.trim();
    if (!q) return;
    setAnalyzing(true); setErr("");
    try {
      const song = await callClaude(ANALYZE_PROMPT(q), apiKey);
      onAdd(song);
      onClose();
    } catch(e) { setErr(e.message); }
    finally { setAnalyzing(false); }
  }

  return null; // Rendered from App with apiKey
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [songs,        setSongs]        = useState([]);
  const [apiKey,       setApiKey]       = useState("");
  const [showAdd,      setShowAdd]      = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [input,        setInput]        = useState("");
  const [analyzing,    setAnalyzing]    = useState(false);
  const [addErr,       setAddErr]       = useState("");
  const [toast,        setToast]        = useState(null);
  const toastTimer = useRef(null);
  const inputRef = useRef(null);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = store.get("wf-songs");
    const key   = store.get("wf-apikey");
    if (saved) { try { setSongs(JSON.parse(saved)); } catch {} }
    if (key)   setApiKey(key);
  }, []);

  function saveSongs(s) { store.set("wf-songs", JSON.stringify(s)); }

  function showToast(text, color = "#4aff9e") {
    setToast({ text, color });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  function saveApiKey(k) {
    setApiKey(k);
    store.set("wf-apikey", k);
    showToast(k ? "API key saved ✦" : "API key removed", k ? "#4aff9e" : "#ffb44a");
  }

  async function addSong() {
    const q = input.trim();
    if (!q || analyzing) return;
    setAnalyzing(true); setAddErr("");
    try {
      const song = await callClaude(ANALYZE_PROMPT(q), apiKey);
      setSongs(prev => { const u = [song, ...prev]; saveSongs(u); return u; });
      setInput(""); setShowAdd(false);
      showToast(`Added "${song.title}"`);
    } catch(e) { setAddErr(e.message); }
    finally { setAnalyzing(false); }
  }

  function removeSong(i) {
    setSongs(prev => { const u = prev.filter((_,j) => j !== i); saveSongs(u); return u; });
  }

  // Open add modal & focus input after animation
  function openAdd() {
    setShowAdd(true); setAddErr("");
    setTimeout(() => inputRef.current?.focus(), 120);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #080810; color: #fff; font-family: 'DM Mono', monospace; min-height: 100%; min-height: 100dvh; overscroll-behavior: none; }
        ::-webkit-scrollbar { display: none; }
        @keyframes cardIn  { from { opacity:0; transform:translateY(18px) } to { opacity:1; transform:translateY(0) } }
        @keyframes dot     { 0%,80%,100% { opacity:.2; transform:scale(.75) } 40% { opacity:1; transform:scale(1) } }
        @keyframes fadeIn  { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { transform:translateY(28px); opacity:0 } to { transform:translateY(0); opacity:1 } }
        @keyframes toastIn { from { transform:translateX(-50%) translateY(-8px); opacity:0 } to { transform:translateX(-50%) translateY(0); opacity:1 } }
        input::placeholder { color: rgba(255,255,255,0.2); }
        button { -webkit-tap-highlight-color: transparent; }
      `}</style>

      <div style={{ minHeight:"100dvh", background:"#080810", backgroundImage:"radial-gradient(ellipse 70% 45% at 15% -5%, rgba(180,74,255,0.08) 0%, transparent 55%), radial-gradient(ellipse 50% 30% at 85% 90%, rgba(74,158,255,0.05) 0%, transparent 50%)", paddingBottom:"5rem" }}>

        {/* Header */}
        <header style={{ padding:"env(safe-area-inset-top, 0) 1.15rem 0", paddingTop:`max(env(safe-area-inset-top, 14px), 14px)`, paddingBottom:"0.75rem", display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"rgba(8,8,16,0.9)", backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", zIndex:50, borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
          <div>
            <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"1.6rem", letterSpacing:"0.1em", lineHeight:1 }}>
              WAVE<span style={{ color:"#b44aff" }}>FEED</span>
            </div>
            <div style={{ fontSize:"0.48rem", color:"rgba(255,255,255,0.2)", letterSpacing:"0.2em", textTransform:"uppercase" }}>AI Music · Your Algorithm</div>
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <button onClick={() => setShowSettings(true)}
              style={{ background:"none", border:`1px solid ${apiKey?"rgba(74,255,158,0.28)":"rgba(255,255,255,0.08)"}`, color:apiKey?"#4aff9e":"rgba(255,255,255,0.28)", borderRadius:20, padding:"0.2rem 0.6rem", fontFamily:"'DM Mono',monospace", fontSize:"0.52rem", letterSpacing:"0.06em", cursor:"pointer", display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:5, height:5, borderRadius:"50%", background:apiKey?"#4aff9e":"rgba(255,255,255,0.18)", display:"inline-block", flexShrink:0 }}/>
              {apiKey ? "key set" : "no key"}
            </button>
            <button onClick={openAdd}
              style={{ background:"#b44aff", border:"none", color:"#fff", borderRadius:"50%", width:38, height:38, fontSize:"1.3rem", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 2px 20px rgba(180,74,255,0.45)", flexShrink:0 }}>+</button>
          </div>
        </header>

        {/* Feed */}
        <main style={{ maxWidth:620, margin:"0 auto", padding:"1rem 0.9rem" }}>
          {songs.length === 0 ? (
            <div style={{ textAlign:"center", padding:"5rem 1.5rem 3rem", color:"rgba(255,255,255,0.18)" }}>
              <div style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"5rem", opacity:0.06, letterSpacing:"0.1em", lineHeight:1, marginBottom:"1.5rem" }}>♬</div>
              <p style={{ fontFamily:"'Bebas Neue',cursive", fontSize:"1.8rem", textTransform:"uppercase", lineHeight:1.1, letterSpacing:"0.08em", marginBottom:"0.75rem" }}>Your Feed is Empty</p>
              <p style={{ fontSize:"0.62rem", letterSpacing:"0.12em", textTransform:"uppercase", lineHeight:2, opacity:0.7 }}>
                Tap <span style={{ color:"#b44aff" }}>+</span> to add a song<br/>
                Get AI recommendations<br/>
                Open directly in YT Music, Spotify or Apple Music
              </p>
              <button onClick={openAdd} style={{ marginTop:"2rem", background:"#b44aff", border:"none", color:"#fff", borderRadius:10, padding:"0.75rem 2rem", fontFamily:"'Bebas Neue',cursive", fontSize:"1rem", letterSpacing:"0.1em", cursor:"pointer", boxShadow:"0 2px 20px rgba(180,74,255,0.4)" }}>
                Add First Song
              </button>
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:"0.85rem" }}>
              {songs.map((song, i) => (
                <SongCard key={`${song.title}-${song.artist}-${i}`} song={song} index={i} onRemove={() => removeSong(i)} apiKey={apiKey} />
              ))}
            </div>
          )}
        </main>

        {/* Toast */}
        {toast && (
          <div style={{ position:"fixed", top:72, left:"50%", transform:"translateX(-50%)", background:"rgba(8,8,16,0.95)", backdropFilter:"blur(12px)", border:`1px solid ${toast.color}35`, borderRadius:20, padding:"0.4rem 1rem", fontSize:"0.6rem", color:toast.color, letterSpacing:"0.05em", zIndex:400, animation:"toastIn 0.18s ease", whiteSpace:"nowrap", maxWidth:"88vw", overflow:"hidden", textOverflow:"ellipsis" }}>
            {toast.text}
          </div>
        )}

        {/* Add Song Sheet */}
        {showAdd && (
          <div style={{ position:"fixed", inset:0, background:"rgba(5,5,12,0.93)", backdropFilter:"blur(18px)", WebkitBackdropFilter:"blur(18px)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", paddingBottom:`max(env(safe-area-inset-bottom, 24px), 24px)`, zIndex:200, animation:"fadeIn 0.18s ease" }}
            onClick={e => { if(e.target===e.currentTarget) { setShowAdd(false); setAddErr(""); } }}>
            <div style={{ width:"100%", maxWidth:500, padding:"0 1.1rem", animation:"slideUp 0.2s ease" }}>
              <div style={{ fontSize:"0.55rem", letterSpacing:"0.22em", color:"rgba(255,255,255,0.2)", textTransform:"uppercase", marginBottom:10 }}>Add a song</div>
              <div style={{ display:"flex", gap:7, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:12, padding:"0.25rem 0.25rem 0.25rem 0.9rem" }}>
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addSong()}
                  placeholder="Artist – Song Title"
                  style={{ flex:1, background:"none", border:"none", outline:"none", color:"#fff", fontFamily:"'DM Mono',monospace", fontSize:"0.9rem", padding:"0.5rem 0" }}
                />
                <button onClick={addSong} disabled={analyzing || !input.trim()}
                  style={{ background:analyzing||!input.trim()?"rgba(255,255,255,0.03)":"#b44aff", color:analyzing||!input.trim()?"rgba(255,255,255,0.15)":"#fff", border:"none", borderRadius:9, padding:"0.5rem 1rem", fontFamily:"'Bebas Neue',cursive", fontSize:"0.85rem", letterSpacing:"0.08em", cursor:analyzing||!input.trim()?"not-allowed":"pointer" }}>
                  {analyzing ? "…" : "Add →"}
                </button>
              </div>
              {addErr && <div style={{ color:"#ff4a6a", fontSize:"0.62rem", marginTop:7 }}>⚠ {addErr}</div>}
              <button onClick={() => { setShowAdd(false); setAddErr(""); }}
                style={{ marginTop:10, width:"100%", background:"none", border:"1px solid rgba(255,255,255,0.07)", color:"rgba(255,255,255,0.2)", fontFamily:"'DM Mono',monospace", fontSize:"0.58rem", letterSpacing:"0.1em", textTransform:"uppercase", padding:"0.46rem", borderRadius:9, cursor:"pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Settings */}
        {showSettings && (
          <SettingsModal apiKey={apiKey} onSave={saveApiKey} onClose={() => setShowSettings(false)} />
        )}
      </div>
    </>
  );
}
