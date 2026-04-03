import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ======================================================
// 1) CONFIG — Replace these with your actual credentials
// ======================================================
const SUPABASE_URL      = "https://vtckfnjdriltxqxqvduv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_lJi0HkSGjhRSj0i4n0kn-g_uHtxnAjc";
const HF_TOKEN          = "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"; // 👈 paste your hf_xxx token here
const HF_MODEL          = "Amod/mental-health-therapy-mistral-7b-ins-SFT";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ======================================================
// 2) DOM REFS
// ======================================================
const authScreen    = document.getElementById("auth-screen");
const chatScreen    = document.getElementById("chat-screen");
const showLoginBtn  = document.getElementById("show-login");
const showSignupBtn = document.getElementById("show-signup");
const authSubmitBtn = document.getElementById("auth-submit");
const authForm      = document.getElementById("auth-form");
const authMsg       = document.getElementById("auth-msg");
const emailInput    = document.getElementById("email");
const passwordInput = document.getElementById("password");
const userEmailText = document.getElementById("user-email");
const logoutBtn     = document.getElementById("logout-btn");
const newChatBtn    = document.getElementById("new-chat-btn");
const historyList   = document.getElementById("history-list");
const chatBox       = document.getElementById("chat-box");
const chatForm      = document.getElementById("chat-form");
const chatInput     = document.getElementById("chat-input");
const sendBtn       = document.getElementById("send-btn");
const charCount     = document.getElementById("char-count");
const moodBadge     = document.getElementById("current-mood-badge");
const crisisModal   = document.getElementById("crisis-modal");
const crisisClose   = document.getElementById("crisis-close");
const breathingWidget = document.getElementById("breathing-widget");
const breathingRing   = document.getElementById("breathing-ring");
const breathingText   = document.getElementById("breathing-text");
const breathingStop   = document.getElementById("breathing-stop");
const btnText = authSubmitBtn.querySelector(".btn-text");
const btnLoader = authSubmitBtn.querySelector(".btn-loader");

let authMode    = "login";
let currentUser = null;
let isSending   = false;
let breathingTimer = null;
let chatHistory = []; // local in-memory conversation context
let allChats    = []; // loaded from DB
let renderGeneration = 0; // prevents stale re-render race condition

// ======================================================
// 3) AUTH UI
// ======================================================
showLoginBtn.addEventListener("click", () => {
  authMode = "login";
  showLoginBtn.classList.add("active");
  showSignupBtn.classList.remove("active");
  btnText.textContent = "Sign In";
  clearMsg();
});

showSignupBtn.addEventListener("click", () => {
  authMode = "signup";
  showSignupBtn.classList.add("active");
  showLoginBtn.classList.remove("active");
  btnText.textContent = "Sign Up";
  clearMsg();
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email    = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) return;

  setAuthLoading(true);
  clearMsg();

  try {
    if (authMode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: "https://health-buddy-mauve.vercel.app" } });
      if (error) throw error;
      showMsg("Account created! Check your email to confirm, then sign in.", "success");
      showLoginBtn.click();
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showMsg(err.message || "Authentication failed. Please try again.", "error");
  } finally {
    setAuthLoading(false);
  }
});

function setAuthLoading(on) {
  authSubmitBtn.disabled = on;
  btnText.classList.toggle("hidden", on);
  btnLoader.classList.toggle("hidden", !on);
}

function showMsg(text, type = "") {
  authMsg.textContent = text;
  authMsg.className = `msg ${type}`;
}
function clearMsg() {
  authMsg.textContent = "";
  authMsg.className = "msg";
}

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

newChatBtn.addEventListener("click", () => {
  chatHistory = [];
  chatBox.innerHTML = "";
  renderEmptyState();
  chatInput.focus();
});

// ======================================================
// 4) SESSION
// ======================================================
supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) onLoggedIn(session.user);
  else onLoggedOut();
});

async function initSession() {
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) onLoggedIn(data.session.user);
  else onLoggedOut();
}

function onLoggedIn(user) {
  currentUser = user;
  userEmailText.textContent = user.email;
  authScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  loadChats();
}

function onLoggedOut() {
  currentUser = null;
  chatHistory = [];
  allChats = [];
  chatScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  chatBox.innerHTML = "";
  historyList.innerHTML = "";
}

// ======================================================
// 5) TEXTAREA AUTO-RESIZE + CHAR COUNT
// ======================================================
chatInput.addEventListener("input", () => {
  // auto-resize
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";

  // char counter
  const len = chatInput.value.length;
  const max = 500;
  charCount.textContent = `${len}/${max}`;
  charCount.className = "char-count" +
    (len > 480 ? " danger" : len > 400 ? " warn" : "");
});

// Send on Enter (Shift+Enter for newline)
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!isSending && chatInput.value.trim()) {
      chatForm.dispatchEvent(new Event("submit"));
    }
  }
});

// ======================================================
// 6) CHAT SUBMIT
// ======================================================
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || isSending) return;

  const message = chatInput.value.trim();
  if (!message) return;

  isSending = true;
  sendBtn.disabled = true;
  chatInput.disabled = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  charCount.textContent = "0/500";

  // Append user bubble immediately
  appendBubble("user", message);

  // Crisis check
  if (detectEmergency(message)) {
    crisisModal.classList.remove("hidden");
    chatBox.scrollTop = chatBox.scrollHeight;
    const crisisResponse = "I'm really glad you reached out. Please know you are not alone — and help is available right now. Take your time, I'm here with you.";
    appendBubble("bot", crisisResponse);
    updateMoodBadge("emergency");
    await saveChat({ user_id: currentUser.id, message, response: crisisResponse, mood: "emergency" });
    await loadChats(false);
    unlock();
    return;
  }

  // Show typing indicator
  const typingEl = showTyping();

  let response = "";
  let mood = "neutral";

  try {
    // Add to local context
    chatHistory.push({ role: "user", content: message });

    // Call Claude API
    response = await callClaudeAPI(chatHistory);

    // Detect mood from message
    mood = detectMoodByKeywords(message);

    // Update context with assistant reply
    chatHistory.push({ role: "assistant", content: response });

  } catch (err) {
    console.error("HF API error:", err);
    response = err.message.includes("warming up") ? err.message : "I'm having a bit of trouble connecting right now. But I'm still here — want to try again?";
    mood = detectMoodByKeywords(message);
  }

  // Remove typing, add bot bubble
  typingEl.remove();
  appendBubble("bot", response, null, mood);
  updateMoodBadge(mood);

  // Show breathing widget for stress/anxiety
  if (["stressed", "anxious"].includes(mood)) {
    setTimeout(() => showBreathing(), 800);
  }

  // Save + reload sidebar (false = don't re-render chat box)
  await saveChat({ user_id: currentUser.id, message, response, mood });
  await loadChats(false);

  unlock();
});

function unlock() {
  isSending = false;
  sendBtn.disabled = false;
  chatInput.disabled = false;
  chatInput.focus();
}

// ======================================================
// 7) HUGGING FACE MENTAL HEALTH MODEL CALL
// ======================================================

// Build Mistral instruct prompt — last 6 turns max
function buildPrompt(history) {
  const recent = history.slice(-6);
  let prompt = "<s>";
  for (const msg of recent) {
    if (msg.role === "user") {
      prompt += "[INST] " + msg.content + " [/INST]";
    } else if (msg.role === "assistant") {
      prompt += " " + msg.content + " </s>";
    }
  }
  return prompt;
}

// Strip prompt echoes, tags, repeated user message from output
function cleanOutput(raw, lastUserMsg) {
  let text = (raw || "");
  text = text.replace(/\[INST\][\s\S]*?\[\/INST\]/g, "");
  text = text.replace(/<\/?s>/g, "");
  if (lastUserMsg) {
    const escaped = lastUserMsg.replace(/[.*+?^${}()|[\]\]/g, "\$&");
    text = text.replace(new RegExp(escaped, "gi"), "");
  }
  text = text.replace(/
{3,}/g, "

").trim();
  return text;
}

async function callClaudeAPI(history) {
  const prompt = buildPrompt(history);
  const lastUserMsg = [...history].reverse().find(m => m.role === "user")?.content || "";

  let res;
  try {
    res = await fetch(
      "https://api-inference.huggingface.co/models/" + HF_MODEL,
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + HF_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 250,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.2,
            do_sample: true,
            return_full_text: false,
          },
          options: {
            wait_for_model: true,
            use_cache: false,
          },
        }),
      }
    );
  } catch (networkErr) {
    throw new Error("Network error — check your connection and try again.");
  }

  // 503 = model cold starting, tell user to wait
  if (res.status === 503) {
    const body = await res.json().catch(() => ({}));
    const secs = body.estimated_time ? Math.ceil(body.estimated_time) : 40;
    throw new Error("The AI is warming up (~" + secs + "s). Please wait a moment and resend your message.");
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error("HF token is invalid or expired — please update it.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Model error (" + res.status + "). Please try again.");
  }

  const data = await res.json();

  let raw = "";
  if (Array.isArray(data)) {
    raw = data[0]?.generated_text || "";
  } else if (data && typeof data === "object") {
    raw = data.generated_text || "";
  }

  const cleaned = cleanOutput(raw, lastUserMsg);
  if (!cleaned || cleaned.length < 5) {
    return "I hear you. Can you tell me a little more about what's been on your mind?";
  }
  return cleaned;
}


// ======================================================
// 8) DETECTION HELPERS
// ======================================================
function detectEmergency(text) {
  const t = text.toLowerCase();
  const phrases = [
    "want to die", "kill myself", "end my life", "suicide",
    "self harm", "hurt myself", "don't want to be here anymore",
    "no reason to live", "take my own life"
  ];
  return phrases.some((p) => t.includes(p));
}

function detectMoodByKeywords(text) {
  const t = text.toLowerCase();
  const map = [
    ["happy",   ["happy","great","good","excited","joy","awesome","grateful","wonderful","love","amazing"]],
    ["sad",     ["sad","down","depressed","lonely","cry","upset","hopeless","empty","numb","miss"]],
    ["angry",   ["angry","mad","furious","annoyed","hate","rage","frustrated","pissed"]],
    ["stressed",["stressed","anxious","overwhelmed","tired","burnout","pressure","panic","worry","nervous","tense"]],
  ];
  for (const [mood, words] of map) {
    if (words.some((w) => t.includes(w))) return mood;
  }
  return "neutral";
}

// ======================================================
// 9) BUBBLE RENDERING
// ======================================================
function appendBubble(type, text, timestamp = null, mood = null) {
  // Remove empty state if present
  const emptyState = chatBox.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const wrap = document.createElement("div");
  wrap.className = `bubble-wrap ${type}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${type}`;
  bubble.textContent = text;
  wrap.appendChild(bubble);

  const meta = document.createElement("div");
  meta.className = "bubble-meta";

  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (type === "bot" && mood) {
    const pill = document.createElement("span");
    pill.className = `mood-pill mood-${mood}`;
    pill.textContent = mood;
    meta.appendChild(pill);
  }

  const timeEl = document.createElement("span");
  timeEl.textContent = time;
  meta.appendChild(timeEl);
  wrap.appendChild(meta);

  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "bubble-wrap bot";
  const indicator = document.createElement("div");
  indicator.className = "typing-indicator";
  indicator.innerHTML = `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`;
  wrap.appendChild(indicator);
  chatBox.appendChild(wrap);
  chatBox.scrollTop = chatBox.scrollHeight;
  return wrap;
}

function renderEmptyState() {
  const existing = chatBox.querySelector(".empty-state");
  if (existing) return;
  const div = document.createElement("div");
  div.className = "empty-state";
  div.innerHTML = `
    <div class="big-emoji">💙</div>
    <h2>How are you feeling today?</h2>
    <p>This is your safe space. Share anything on your mind — I'm here to listen.</p>
  `;
  chatBox.appendChild(div);
}

function updateMoodBadge(mood) {
  moodBadge.className = `mood-badge mood-${mood}`;
  const icons = { happy: "😊", sad: "💙", angry: "😤", stressed: "😰", neutral: "😐", emergency: "🆘" };
  moodBadge.textContent = `${icons[mood] || "💙"} ${mood}`;
  moodBadge.classList.remove("hidden");
}

// ======================================================
// 10) SUPABASE LOAD / SAVE
// ======================================================
async function saveChat(row) {
  const { error } = await supabase.from("chats").insert([row]);
  if (error) console.error("saveChat error:", error.message);
}

// renderChat: true = rebuild chatBox (on page load), false = sidebar only
async function loadChats(renderChat = true) {
  if (!currentUser) return;

  const gen = ++renderGeneration;

  const { data, error } = await supabase
    .from("chats")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: true });

  if (error) { console.error("loadChats error:", error.message); return; }
  if (gen !== renderGeneration) return; // stale, abort

  allChats = data || [];

  if (renderChat) {
    chatBox.innerHTML = "";
    if (allChats.length === 0) {
      renderEmptyState();
    } else {
      for (const c of allChats) {
        appendBubble("user", c.message, c.created_at);
        appendBubble("bot", c.response, c.created_at, c.mood);
      }
      // Rebuild local context from DB for continuity
      chatHistory = allChats.flatMap((c) => [
        { role: "user", content: c.message },
        { role: "assistant", content: c.response },
      ]);
      if (allChats.length > 0) {
        updateMoodBadge(allChats[allChats.length - 1].mood);
      }
    }
  }

  // Always update sidebar
  renderSidebar(allChats);
  renderMoodChart(allChats);
}

function renderSidebar(data) {
  historyList.innerHTML = "";
  if (!data.length) {
    historyList.innerHTML = `<p class="muted small" style="padding:8px 4px">No history yet</p>`;
    return;
  }
  [...data].reverse().forEach((c) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="preview">${escapeHtml(c.message.slice(0, 45))}${c.message.length > 45 ? "…" : ""}</div>
      <div class="meta-row">
        <span class="mood-pill mood-${escapeHtml(c.mood)}">${escapeHtml(c.mood)}</span>
        <span>${new Date(c.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
      </div>
    `;
    historyList.appendChild(item);
  });
}

// ======================================================
// 11) MOOD CHART (canvas bar chart)
// ======================================================
const MOOD_COLORS = {
  happy:    "#4ade80",
  sad:      "#7c9ef8",
  angry:    "#f87171",
  stressed: "#fb923c",
  neutral:  "#64748b",
  emergency:"#f87171",
};

function renderMoodChart(data) {
  const canvas = document.getElementById("mood-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Count mood occurrences
  const counts = {};
  for (const c of data) {
    counts[c.mood] = (counts[c.mood] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) {
    ctx.fillStyle = "rgba(100,116,139,0.3)";
    ctx.font = "11px DM Sans, sans-serif";
    ctx.fillText("Chat to see mood data", 20, H / 2);
    return;
  }

  const total = data.length;
  const barH = 14;
  const gap = 8;
  const labelW = 62;
  const maxBarW = W - labelW - 40;

  entries.sort((a, b) => b[1] - a[1]);

  entries.forEach(([mood, count], i) => {
    const y = i * (barH + gap) + 10;
    const barW = (count / total) * maxBarW;
    const color = MOOD_COLORS[mood] || "#94a3b8";

    // background track
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.roundRect(labelW, y, maxBarW, barH, 4);
    ctx.fill();

    // bar
    ctx.fillStyle = color + "cc";
    ctx.beginPath();
    ctx.roundRect(labelW, y, Math.max(barW, 4), barH, 4);
    ctx.fill();

    // label
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px DM Sans, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(mood, labelW - 6, y + barH - 3);

    // count
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.fillText(count, labelW + barW + 6, y + barH - 3);
  });

  // Legend
  const legend = document.getElementById("mood-legend");
  legend.innerHTML = "";
  for (const [mood, color] of Object.entries(MOOD_COLORS)) {
    if (!counts[mood]) continue;
    const wrap = document.createElement("div");
    wrap.className = "legend-dot";
    wrap.innerHTML = `<span style="background:${color}"></span>${mood}`;
    legend.appendChild(wrap);
  }
}

// ======================================================
// 12) BREATHING EXERCISE (4-7-8)
// ======================================================
const BREATHING_PHASES = [
  { label: "Breathe In",  cls: "inhale",  dur: 4000 },
  { label: "Hold",        cls: "hold",    dur: 7000 },
  { label: "Breathe Out", cls: "exhale",  dur: 8000 },
];
let breathPhase = 0;

function showBreathing() {
  breathingWidget.classList.remove("hidden");
  runBreathCycle();
}

function runBreathCycle() {
  if (breathingWidget.classList.contains("hidden")) return;
  const phase = BREATHING_PHASES[breathPhase % BREATHING_PHASES.length];
  breathingRing.className = "breathing-ring " + phase.cls;
  breathingText.textContent = phase.label;
  breathPhase++;
  breathingTimer = setTimeout(runBreathCycle, phase.dur);
}

breathingStop.addEventListener("click", () => {
  clearTimeout(breathingTimer);
  breathPhase = 0;
  breathingRing.className = "breathing-ring";
  breathingWidget.classList.add("hidden");
});

// ======================================================
// 13) CRISIS MODAL
// ======================================================
crisisClose.addEventListener("click", () => {
  crisisModal.classList.add("hidden");
  chatInput.focus();
});
crisisModal.addEventListener("click", (e) => {
  if (e.target === crisisModal) crisisModal.classList.add("hidden");
});

// ======================================================
// 14) UTILS
// ======================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ======================================================
// 15) START
// ======================================================
initSession();
