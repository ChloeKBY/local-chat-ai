/* ===========================
   CONFIG & STATE
=========================== */

const API = "http://127.0.0.1:8000";

const chatWindow       = document.getElementById("chatWindow");
const userInput        = document.getElementById("userInput");
const sendBtn          = document.getElementById("sendBtn");
const menuButton       = document.getElementById("menuButton");
const sideDrawer       = document.getElementById("sideDrawer");
const openHistoryBtn   = document.getElementById("openHistoryBtn");
const historyDrawer    = document.getElementById("historyDrawer");
const closeHistoryBtn  = document.getElementById("closeHistoryBtn");
const historyList      = document.getElementById("historyList");
const historyNewChatBtn = document.getElementById("historyNewChatBtn");
const personaSelect    = document.getElementById("personaSelect");
const memoryBox        = document.getElementById("memoryBox");
const saveMemoryBtn    = document.getElementById("saveMemoryBtn");
const charNameEl       = document.getElementById("charName");
const charAvatarEl     = document.getElementById("charAvatar");
const drawerAvatarEl   = document.getElementById("drawerAvatar");
const drawerNameEl     = document.getElementById("drawerName");
const drawerDescEl     = document.getElementById("drawerDesc");
const typingIndicator  = document.getElementById("typingIndicator");

const params    = new URLSearchParams(window.location.search);
const character = params.get("character");

let sessions      = [];
let currentChatId = null;
let personas      = [];
let currentPersona = null;
let isGenerating  = false;

let characterMeta = { name: "Character", avatarUrl: "/ui/fallback.png" };

/* ===========================
   UI HELPERS
=========================== */

function scrollToBottom() { chatWindow.scrollTop = chatWindow.scrollHeight; }
function clearChatWindow() { chatWindow.innerHTML = ""; }

/**
 * Build a message row (avatar + name header + bubble).
 * Returns { messageDiv, bubbleEl, contentEl } so callers can do
 * further customisation (add swipe controls, edit button, etc.)
 */
function buildMessageRow(text, type, messageId = null) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;
  if (messageId) messageDiv.dataset.msgId = messageId;

  // ── header ─────────────────────────────────────────────
  const header   = document.createElement("div");
  header.className = "msg-header";

  const avatar   = document.createElement("img");
  avatar.className = "avatar";

  const nameSpan = document.createElement("span");
  nameSpan.className = "name";

  if (type === "user") {
    const p = currentPersona;
    avatar.src       = p?.image_url ? `${API}/${p.image_url.replace(/^\/?/, "")}` : "/ui/fallback.png";
    nameSpan.textContent = p ? p.name : "You";
  } else {
    avatar.src       = characterMeta.avatarUrl;
    nameSpan.textContent = characterMeta.name;
  }

  header.appendChild(avatar);
  header.appendChild(nameSpan);

  // ── bubble ─────────────────────────────────────────────
  const bubbleEl  = document.createElement("div");
  bubbleEl.className = `bubble ${type === "user" ? "user-bubble" : "bot-bubble"}`;
  if (messageId) bubbleEl.dataset.id = messageId;

  const contentEl = document.createElement("div");
  contentEl.className = "bubble-text";
  contentEl.textContent = text;

  bubbleEl.appendChild(contentEl);
  messageDiv.appendChild(header);
  messageDiv.appendChild(bubbleEl);

  return { messageDiv, bubbleEl, contentEl };
}

/** Add a plain bubble with no controls (used for streaming placeholder). */
function addRawBubble(text, type) {
  const { messageDiv, contentEl } = buildMessageRow(text, type);
  chatWindow.appendChild(messageDiv);
  scrollToBottom();
  return contentEl;
}

/**
 * Render a full message row with controls (edit, delete, swipes for bot).
 * swipes: array of all alternatives. swipeIndex: which one is currently shown.
 */
function renderMessage(msg) {
  const type = msg.role === "user" ? "user" : "bot";
  const { messageDiv, bubbleEl, contentEl } = buildMessageRow(msg.text, type, msg.id);

  if (type === "bot") {
    attachBotControls(messageDiv, bubbleEl, contentEl, msg);
  } else {
    attachUserControls(messageDiv, bubbleEl, contentEl, msg);
  }

  chatWindow.appendChild(messageDiv);
  scrollToBottom();
  return { messageDiv, bubbleEl, contentEl };
}

/* ──────────────────── BOT controls ────────────────────── */

function attachBotControls(messageDiv, bubbleEl, contentEl, msg) {
  const swipes      = msg.swipes || [];
  let   swipeIndex  = msg.swipe_index ?? 0;

  // ── action row (edit / delete / regenerate) ─────────
  const actionRow = document.createElement("div");
  actionRow.className = "msg-action-row";

  const editBtn   = makeActionBtn("✏️ Edit",      "edit-btn");
  const deleteBtn = makeActionBtn("🗑️ Delete",    "delete-btn");
  const regenBtn  = makeActionBtn("🔄 Regenerate","regen-btn");

  actionRow.appendChild(editBtn);
  actionRow.appendChild(deleteBtn);
  actionRow.appendChild(regenBtn);

  // ── swipe controls (only if more than 1 swipe stored) ─
  let swipeRow = null;
  if (swipes.length > 1) {
    swipeRow = buildSwipeRow(swipes, swipeIndex, contentEl, msg.id);
  }

  if (swipeRow) bubbleEl.after(swipeRow);
  bubbleEl.after(actionRow);

  // ── EDIT ──────────────────────────────────────────────
  editBtn.onclick = () => {
    if (editBtn.dataset.editing === "1") return;
    editBtn.dataset.editing = "1";

    const original = contentEl.textContent;
    contentEl.innerHTML = "";

    const ta = document.createElement("textarea");
    ta.className = "edit-area";
    ta.value = original;
    contentEl.appendChild(ta);

    const controls = document.createElement("div");
    controls.className = "edit-controls";

    const saveEl   = document.createElement("button");
    saveEl.textContent = "Save";
    saveEl.className = "save-edit";

    const cancelEl = document.createElement("button");
    cancelEl.textContent = "Cancel";
    cancelEl.className = "cancel-edit";

    controls.appendChild(saveEl);
    controls.appendChild(cancelEl);
    contentEl.appendChild(controls);
    ta.focus();

    saveEl.onclick = async () => {
      const newText = ta.value.trim();
      if (newText) {
        await fetch(`${API}/chat/${character}/${currentChatId}/message/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_text: newText })
        });
        msg.text = newText;
      }
      contentEl.textContent = msg.text;
      delete editBtn.dataset.editing;
    };

    cancelEl.onclick = () => {
      contentEl.textContent = original;
      delete editBtn.dataset.editing;
    };
  };

  // ── DELETE ────────────────────────────────────────────
  deleteBtn.onclick = async () => {
    if (!confirm("Delete this message?")) return;
    await fetch(`${API}/chat/${character}/${currentChatId}/message/${msg.id}`, {
      method: "DELETE"
    });
    messageDiv.remove();
    if (swipeRow) swipeRow.remove();
    actionRow.remove();
  };

  // ── REGENERATE ────────────────────────────────────────
  regenBtn.onclick = async () => {
    if (isGenerating) return;
    isGenerating = true;
    regenBtn.disabled = true;
    regenBtn.textContent = "⏳ Regenerating…";

    try {
      const res = await fetch(`${API}/chat/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character, chat_id: currentChatId })
      });
      const data = await res.json();
      const newSwipes    = data.replies || [];
      const userMessage  = data.user_message || "";

      if (newSwipes.length === 0) return;

      // Update visual
      msg.swipes      = newSwipes;
      msg.swipe_index = 0;
      msg.text        = newSwipes[0];
      contentEl.textContent = newSwipes[0];

      // Rebuild swipe row
      if (swipeRow) swipeRow.remove();
      swipeRow = buildSwipeRow(newSwipes, 0, contentEl, msg.id);
      actionRow.before(swipeRow);

      // Commit to server
      await fetch(`${API}/chat/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character,
          chat_id: currentChatId,
          message: userMessage,
          reply: newSwipes[0],
          swipes: newSwipes
        })
      });
    } finally {
      isGenerating = false;
      regenBtn.disabled = false;
      regenBtn.textContent = "🔄 Regenerate";
    }
  };
}

/** Build a swipe navigation row for a bot bubble. */
function buildSwipeRow(swipes, initialIndex, contentEl, msgId) {
  let index = initialIndex;

  const row = document.createElement("div");
  row.className = "swipe-row";

  const prevBtn   = document.createElement("button");
  prevBtn.textContent = "◀";
  prevBtn.className = "swipe-nav";

  const counter   = document.createElement("span");
  counter.className = "swipe-counter";

  const nextBtn   = document.createElement("button");
  nextBtn.textContent = "▶";
  nextBtn.className = "swipe-nav";

  row.appendChild(prevBtn);
  row.appendChild(counter);
  row.appendChild(nextBtn);

  function update() {
    contentEl.textContent = swipes[index];
    counter.textContent   = `${index + 1} / ${swipes.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === swipes.length - 1;
  }

  update();

  prevBtn.onclick = async () => {
    if (index > 0) { index--; update(); await persistSwipe(msgId, index); }
  };
  nextBtn.onclick = async () => {
    if (index < swipes.length - 1) { index++; update(); await persistSwipe(msgId, index); }
  };

  return row;
}

async function persistSwipe(msgId, newIndex) {
  await fetch(`${API}/chat/${character}/${currentChatId}/message/${msgId}/swipe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ swipe_index: newIndex })
  });
}

/* ──────────────────── USER controls ───────────────────── */

function attachUserControls(messageDiv, bubbleEl, contentEl, msg) {
  const actionRow = document.createElement("div");
  actionRow.className = "msg-action-row user-action-row";

  const editBtn   = makeActionBtn("✏️ Edit",   "edit-btn");
  const deleteBtn = makeActionBtn("🗑️ Delete", "delete-btn");

  actionRow.appendChild(editBtn);
  actionRow.appendChild(deleteBtn);
  bubbleEl.after(actionRow);

  editBtn.onclick = () => {
    if (editBtn.dataset.editing === "1") return;
    editBtn.dataset.editing = "1";
    const original = contentEl.textContent;
    contentEl.innerHTML = "";

    const ta = document.createElement("textarea");
    ta.className = "edit-area";
    ta.value = original;
    contentEl.appendChild(ta);

    const controls = document.createElement("div");
    controls.className = "edit-controls";
    const saveEl   = document.createElement("button");
    saveEl.textContent = "Save";
    saveEl.className = "save-edit";
    const cancelEl = document.createElement("button");
    cancelEl.textContent = "Cancel";
    cancelEl.className = "cancel-edit";
    controls.appendChild(saveEl);
    controls.appendChild(cancelEl);
    contentEl.appendChild(controls);
    ta.focus();

    saveEl.onclick = async () => {
      const newText = ta.value.trim();
      if (newText) {
        await fetch(`${API}/chat/${character}/${currentChatId}/message/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_text: newText })
        });
        msg.text = newText;
      }
      contentEl.textContent = msg.text;
      delete editBtn.dataset.editing;
    };
    cancelEl.onclick = () => { contentEl.textContent = original; delete editBtn.dataset.editing; };
  };

  deleteBtn.onclick = async () => {
    if (!confirm("Delete this message?")) return;
    await fetch(`${API}/chat/${character}/${currentChatId}/message/${msg.id}`, { method: "DELETE" });
    messageDiv.remove();
    actionRow.remove();
  };
}

function makeActionBtn(label, cls) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.className = `msg-action-btn ${cls}`;
  return btn;
}

/* Typing Indicator */
function showTyping() {
  typingIndicator.classList.remove("hidden");
}
function hideTyping() {
  typingIndicator.classList.add("hidden");
}

/* ===========================
   CHARACTER & PERSONAS
=========================== */

async function loadCharacter() {
  try {
    const res  = await fetch(`${API}/character/${character}`);
    const data = await res.json();

    charNameEl.textContent  = data.name;
    drawerNameEl.textContent = data.name;
    drawerDescEl.textContent = data.description;

    const resolved = data.image_url
      ? `${API}/${data.image_url.replace(/^\/?/, "")}`
      : "/ui/fallback.png";

    charAvatarEl.src  = resolved;
    drawerAvatarEl.src = resolved;
    characterMeta = { name: data.name || "Character", avatarUrl: resolved };
  } catch (err) {
    console.error("loadCharacter failed:", err);
  }
}

async function loadPersonas() {
  const res = await fetch(`${API}/personas`);
  personas  = await res.json();

  personaSelect.innerHTML = "<option value=''>No persona</option>";
  personas.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    personaSelect.appendChild(opt);
  });

  updateCurrentPersona();
}

function updateCurrentPersona() {
  const id = personaSelect.value || "";
  currentPersona = personas.find(p => p.id === id) || null;
}

/* ===========================
   SESSIONS
=========================== */

async function loadSessions() {
  const res = await fetch(`${API}/chat-sessions/${character}`);
  sessions  = await res.json();
  renderHistoryList();

  if (!currentChatId) {
    if (sessions.length > 0) selectSession(sessions[0].id);
    else await createNewSession();
  }
}

function renderHistoryList() {
  historyList.innerHTML = "";
  sessions.forEach(session => {
    const row = document.createElement("div");
    row.className = "chat-row";
    if (session.id === currentChatId) row.classList.add("active");

    const titleSpan = document.createElement("span");
    titleSpan.textContent = session.title;

    const menuBtn = document.createElement("button");
    menuBtn.className = "chat-row-menu";
    menuBtn.textContent = "⋮";

    row.appendChild(titleSpan);
    row.appendChild(menuBtn);

    row.addEventListener("click", (e) => {
      if (e.target === menuBtn) return;
      selectSession(session.id);
      historyDrawer.classList.remove("open");
      sideDrawer.classList.remove("open");
    });

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openSessionMenu(session, row, titleSpan);
    });

    historyList.appendChild(row);
  });
}

function openSessionMenu(session, row, titleSpan) {
  const existing = row.querySelector(".chat-row-menu-panel");
  if (existing) { existing.remove(); return; }

  const panel     = document.createElement("div");
  panel.className = "chat-row-menu-panel";

  const renameBtn = document.createElement("button");
  renameBtn.textContent = "Rename";
  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "Delete";

  panel.appendChild(renameBtn);
  panel.appendChild(deleteBtn);
  row.appendChild(panel);

  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.remove();
    startRenameSession(session, titleSpan);
  });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    panel.remove();
    await deleteSession(session.id);
  });
}

function startRenameSession(session, titleSpan) {
  const input    = document.createElement("input");
  input.type     = "text";
  input.value    = session.title;
  input.className = "chat-row-rename";

  const parent = titleSpan.parentNode;
  parent.replaceChild(input, titleSpan);
  input.focus();
  input.select();

  const finish = async (save) => {
    if (save) {
      const newTitle = input.value.trim();
      if (newTitle && newTitle !== session.title) {
        await fetch(`${API}/chat-session/rename`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character, chat_id: session.id, title: newTitle })
        });
        session.title = newTitle;
      }
    }
    const newSpan = document.createElement("span");
    newSpan.textContent = session.title;
    parent.replaceChild(newSpan, input);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

async function createNewSession() {
  const persona_id = personaSelect.value || null;
  const res = await fetch(`${API}/chat-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ character, persona_id })
  });
  const session = await res.json();
  sessions.unshift(session);
  renderHistoryList();
  selectSession(session.id);
}

async function deleteSession(chatId) {
  await fetch(`${API}/chat-session/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ character, chat_id: chatId })
  });

  sessions = sessions.filter(s => s.id !== chatId);
  if (currentChatId === chatId) {
    currentChatId = null;
    clearChatWindow();
    memoryBox.value = "";
  }
  renderHistoryList();
  if (!currentChatId && sessions.length > 0) selectSession(sessions[0].id);
}

async function selectSession(chatId) {
  currentChatId = chatId;
  clearChatWindow();

  const res  = await fetch(`${API}/chat-history/${character}/${chatId}`);
  const data = await res.json();

  personaSelect.value = data.persona_id || "";
  updateCurrentPersona();
  memoryBox.value = data.memory || "";

  (data.history || []).forEach(msg => renderMessage(msg));
  renderHistoryList(); // refresh active highlight
}

/* ===========================
   MEMORY
=========================== */

async function saveMemory() {
  if (!currentChatId) return;
  await fetch(`${API}/chat-memory/${character}/${currentChatId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memory: memoryBox.value })
  });
}

/* ===========================
   STREAMING SEND
=========================== */

async function sendMessage() {
  if (isGenerating) return;
  const text = userInput.value.trim();
  if (!text) return continueMessage();
  if (!currentChatId) return;

  isGenerating = true;
  sendBtn.disabled = true;

  // Optimistically render user bubble
  const userMsgId = "temp-" + Date.now();
  const userMsg   = { id: userMsgId, role: "user", text, swipes: [], swipe_index: 0 };
  renderMessage(userMsg);
  userInput.value = "";

  // Placeholder bot bubble for streaming
  const botContentEl = addRawBubble("", "bot");
  showTyping();

  let fullText = "";

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, chat_id: currentChatId, message: text })
    });

    if (!res.ok || !res.body) {
      hideTyping();
      botContentEl.textContent = "The server didn't respond. Try again?";
      isGenerating = false;
      sendBtn.disabled = false;
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullText += chunk;
      botContentEl.textContent = fullText;
      scrollToBottom();
    }

    hideTyping();

    // Generate swipes in parallel
    let swipeReplies = [];
    try {
      const swipeRes = await fetch(`${API}/chat-swipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character, chat_id: currentChatId, message: text })
      });
      if (swipeRes.ok) swipeReplies = (await swipeRes.json()).replies || [];
    } catch (e) { console.warn("Swipe fetch failed", e); }

    const allSwipes = [fullText, ...swipeReplies];

    // Commit everything to server
    const commitRes = await fetch(`${API}/chat/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character,
        chat_id: currentChatId,
        message: text,
        reply: fullText,
        swipes: allSwipes
      })
    });
    const committed = await commitRes.json();

    // Replace temp bubbles with properly persisted ones (reload session)
    clearChatWindow();
    const histRes  = await fetch(`${API}/chat-history/${character}/${currentChatId}`);
    const histData = await histRes.json();
    (histData.history || []).forEach(m => renderMessage(m));

  } catch (e) {
    console.error(e);
    hideTyping();
    botContentEl.textContent = "I'm having trouble responding right now. Try again?";
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
  }
}

async function continueMessage() {
  if (isGenerating || !currentChatId) return;
  isGenerating = true;
  sendBtn.disabled = true;

  const botContentEl = addRawBubble("", "bot");
  showTyping();
  let fullText = "";

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, chat_id: currentChatId, message: "" })
    });

    if (!res.ok || !res.body) {
      hideTyping();
      botContentEl.textContent = "The server didn't respond. Try again?";
      return;
    }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      fullText += chunk;
      botContentEl.textContent = fullText;
      scrollToBottom();
    }

    hideTyping();

    await fetch(`${API}/chat/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character, chat_id: currentChatId, message: "", reply: fullText, swipes: [fullText] })
    });

    // Reload to get proper IDs and controls
    clearChatWindow();
    const histRes  = await fetch(`${API}/chat-history/${character}/${currentChatId}`);
    const histData = await histRes.json();
    (histData.history || []).forEach(m => renderMessage(m));

  } catch (e) {
    console.error(e);
    hideTyping();
    botContentEl.textContent = "I'm having trouble responding right now. Try again?";
  } finally {
    isGenerating = false;
    sendBtn.disabled = false;
  }
}

/* ===========================
   DRAWERS & EVENTS
=========================== */

menuButton.onclick  = () => sideDrawer.classList.toggle("open");
openHistoryBtn.onclick = () => historyDrawer.classList.add("open");
closeHistoryBtn.onclick = () => historyDrawer.classList.remove("open");

document.addEventListener("click", (e) => {
  const insideMain    = sideDrawer.contains(e.target);
  const insideHistory = historyDrawer.contains(e.target);
  const clickedMenu   = menuButton.contains(e.target);
  if (!insideMain && !clickedMenu && !insideHistory) {
    sideDrawer.classList.remove("open");
    historyDrawer.classList.remove("open");
  }
});

saveMemoryBtn.onclick    = saveMemory;
historyNewChatBtn.onclick = createNewSession;
sendBtn.onclick          = sendMessage;

personaSelect.addEventListener("change", updateCurrentPersona);

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (e.shiftKey) {
      e.preventDefault();
      const s = userInput.selectionStart, end = userInput.selectionEnd;
      userInput.value = userInput.value.substring(0, s) + "\n" + userInput.value.substring(end);
      userInput.selectionStart = userInput.selectionEnd = s + 1;
      return;
    }
    e.preventDefault();
    sendMessage();
  }
});

/* ===========================
   INIT
=========================== */

(async function init() {
  await loadCharacter();
  await loadPersonas();
  await loadSessions();
})();
