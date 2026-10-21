// Voice-engine switch for testers, injected into the demo pages by nginx.
// Hidden from ordinary visitors: open any demo page once with ?voicelab=1 to
// show it in this browser (?voicelab=0 hides it again). The choice is read by
// elevenlabs-shim.js when a call starts; ?voice=local|elevenlabs also sets it.
(() => {
  const LAB = "reps.voice.lab";
  const ENGINE = "reps.voice.engine";

  // The pages fetch an ElevenLabs signed URL *before* starting a call when the
  // site runs a private agent. On the local engine that request is pointless
  // (and fails if the ElevenLabs key lacks agent access), so answer it here;
  // elevenlabs-shim.js ignores the URL. ElevenLabs engine: untouched.
  const isLocal = () => {
    try {
      return localStorage.getItem(ENGINE) === "local";
    } catch {
      return false;
    }
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (isLocal() && new URL(url, location.href).pathname === "/api/voice/signed-url") {
      return Promise.resolve(
        new Response(JSON.stringify({ signed_url: "local" }), { headers: { "content-type": "application/json" } }),
      );
    }
    return realFetch(input, init);
  };

  let lab = false;
  try {
    const q = new URLSearchParams(location.search);
    if (q.get("voicelab") === "1") localStorage.setItem(LAB, "1");
    if (q.get("voicelab") === "0") localStorage.removeItem(LAB);
    const v = q.get("voice");
    if (v === "local" || v === "elevenlabs") localStorage.setItem(ENGINE, v);
    lab = localStorage.getItem(LAB) === "1";
  } catch {
    return;
  }
  if (!lab) return;

  const get = () => (localStorage.getItem(ENGINE) === "local" ? "local" : "elevenlabs");
  const box = document.createElement("div");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Voice engine (testing)");
  box.style.cssText =
    "position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:6px;padding:6px 8px;" +
    "background:#172438;color:#fff;border-radius:999px;font:600 12px/1 Arial,sans-serif;box-shadow:0 6px 24px #0003";
  const label = document.createElement("span");
  label.textContent = "VOICE";
  label.style.cssText = "padding:0 4px;opacity:.7;letter-spacing:.08em";
  box.append(label);
  const buttons = [
    ["elevenlabs", "ElevenLabs"],
    ["local", "Local (test)"],
  ].map(([value, text]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = "border:0;border-radius:999px;padding:6px 10px;cursor:pointer;font:inherit";
    b.onclick = () => {
      localStorage.setItem(ENGINE, value);
      paint();
    };
    box.append(b);
    return [value, b];
  });
  const paint = () =>
    buttons.forEach(([value, b]) => {
      const on = get() === value;
      b.setAttribute("aria-pressed", String(on));
      b.style.background = on ? "#e8ef74" : "transparent";
      b.style.color = on ? "#172438" : "#fff";
    });
  paint();
  document.body.append(box);
})();
