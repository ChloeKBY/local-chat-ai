/* ===========================
   CONFIG & STATE
=========================== */

const API = "http://127.0.0.1:8000";

const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");

const menuButton = document.getElementById("menuButton");
const sideDrawer = document.getElementById("sideDrawer");

const openHistoryBtn = document.getElementById("openHistoryBtn");
const historyDrawer = document.getElementById("historyDrawer");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const historyList = document.getElementById("historyList");
const historyNewChatBtn = document.getElementById("historyNewChatBtn");

const personaSelect = document.getElementById("personaSelect");
const memoryBox = document.getElementById("memoryBox");
const saveMemoryBtn = document.getElementById("saveMemoryBtn");

const charNameEl = document.getElementById("charName");
const charAvatarEl = document.getElementById("charAvatar");
const drawerAvatarEl = document.getElementById("drawerAvatar");
const drawerNameEl = document.getElementById("drawerName");
const drawerDescEl = document.getElementById("drawerDesc");

const typingIndicator = document.getElementById("typingIndicator");

const params = new URLSearchParams(window.location.search);
const character = params.get("character");

let sessions = [];
let currentChatId = null;

let personas = [];
let currentPersona = null;

let characterMeta = {
  name: "Character",
  avatarUrl: "/ui/fallback.png"
};

/* ===========================
   UI HELPERS
=========================== */

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function clearChatWindow() {
  chatWindow.innerHTML = "";
}

/**
 * Add a chat bubble with avatar + name above it.
 * type: "user" | "bot"
 * returns the inner .bubble-text element (for streaming/editing)
 */
function addBubble(text, type, messageId = null, typing = false) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;

  // Header (avatar + name)
  const header = document.createElement("div");
  header.className = "msg-header";

  const avatar = document.createElement("img");
  avatar.className = "avatar";

  const nameSpan = document.createElement("span");
  nameSpan.className = "name";

  if (type === "user") {
    const persona = currentPersona;
    avatar.src = persona && persona.image_url
      ? `${API}/${persona.image_url.replace(/^\/?/, "")}`
      : "/ui/fallback.png";
    nameSpan.textContent = persona ? persona.name : "You";
  } else {
    avatar.src = characterMeta.avatarUrl;
    nameSpan.textContent = characterMeta.name;
  }

  header.appendChild(avatar);
  header.appendChild(nameSpan);

  // Bubble
  const bubble = document.createElement("div");
  bubble.className = `bubble ${type === "user" ? "user-bubble" : "bot-bubble"}`;
  if (typing) bubble.classList.add("typing");
  if (messageId) bubble.dataset.id = messageId;

  const content = document.createElement("div");
  content.className = "bubble-text";

  if (typing) {
    content.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
  } else {
    content.textContent = text;
  }

  bubble.appendChild(content);

  if (type === "bot" && messageId) {
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.textContent = "Edit";
    bubble.appendChild(editBtn);
  }

  messageDiv.appendChild(header);
  messageDiv.appendChild(bubble);

  chatWindow.appendChild(messageDiv);
  scrollToBottom();

  return content;
}

/* Typing Indicator */
function showTyping() {
  typingIndicator.classList.remove("hidden");
  typingIndicator.classList.add("fade-in");
}

function hideTyping() {
  typingIndicator.classList.add("fade-out");
  setTimeout(() => {
    typingIndicator.classList.add("hidden");
    typingIndicator.classList.remove("fade-in", "fade-out");
  }, 250);
}

/* ===========================
   CHARACTER & PERSONAS
=========================== */

async function loadCharacter() {
  try {
    const res = await fetch(`${API}/character/${character}`);
    const data = await res.json();

    charNameEl.textContent = data.name;
    drawerNameEl.textContent = data.name;
    drawerDescEl.textContent = data.description;

    const resolved = data.image_url
      ? `${API}/${data.image_url.replace(/^\/?/, "")}`
      : "/ui/fallback.png";

    charAvatarEl.src = resolved;
    drawerAvatarEl.src = resolved;

    characterMeta = {
      name: data.name || "Character",
      avatarUrl: resolved
    };
  } catch (err) {
    console.error("loadCharacter failed:", err);
  }
}

async function loadPersonas() {
  const res = await fetch(`${API}/personas`);
  personas = await res.json();

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
  sessions = await res.json();

  renderHistoryList();

  if (!currentChatId) {
    if (sessions.length > 0) {
      selectSession(sessions[0].id);
    } else {
      await createNewSession();
    }
  }
}

function renderHistoryList() {
  historyList.innerHTML = "";

  sessions.forEach(session => {
    const row = document.createElement("div");
    row.className = "chat-row";

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
  if (existing) {
    existing.remove();
    return;
  }

  const panel = document.createElement("div");
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
  const input = document.createElement("input");
  input.type = "text";
  input.value = session.title;
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
          body: JSON.stringify({
            character,
            chat_id: session.id,
            title: newTitle
          })
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

  if (!currentChatId && sessions.length > 0) {
    selectSession(sessions[0].id);
  }
}

async function selectSession(chatId) {
  currentChatId = chatId;
  clearChatWindow();

  const res = await fetch(`${API}/chat-history/${character}/${chatId}`);
  const data = await res.json();

  personaSelect.value = data.persona_id || "";
  updateCurrentPersona();

  memoryBox.value = data.memory || "";

  data.history.forEach(msg => {
    addBubble(
      msg.text,
      msg.role === "user" ? "user" : "bot",
      msg.id
    );
  });
}
async function savePersonaSelection() {
  if (!currentChatId) return;

  await fetch(`${API}/chat-session/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      character,
      chat_id: currentChatId,
      persona_id: personaSelect.value
    })
  });
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
   SWIPES (extra generations)
=========================== */

function renderSwipeBlock(replies, userText, botContent) {
  if (!replies || replies.length === 0) return;

  let index = 0;

  const container = document.createElement("div");
  container.className = "bot-swipe-block";

  const controls = document.createElement("div");
  controls.className = "swipe-controls";

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "◀";

  const indexSpan = document.createElement("span");
  indexSpan.className = "swipe-index";
  indexSpan.textContent = `${index + 1} / ${replies.length}`;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "▶";

  controls.appendChild(prevBtn);
  controls.appendChild(indexSpan);
  controls.appendChild(nextBtn);

  const selectBtn = document.createElement("button");
  selectBtn.className = "select-btn";
  selectBtn.textContent = "Select";

  container.appendChild(controls);
  container.appendChild(selectBtn);

  const botBubble = botContent.parentNode;
  botBubble.after(container);

  function updateBubble() {
    botContent.textContent = replies[index];
    indexSpan.textContent = `${index + 1} / ${replies.length}`;
    scrollToBottom();
  }

  updateBubble();

  prevBtn.onclick = () => {
    if (index > 0) {
      index--;
      updateBubble();
    }
  };

  nextBtn.onclick = () => {
    if (index < replies.length - 1) {
      index++;
      updateBubble();
    }
  };

  selectBtn.onclick = async () => {
    const chosen = replies[index];

    await fetch(`${API}/chat/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character,
        chat_id: currentChatId,
        message: userText,
        reply: chosen
      })
    });

    container.remove();
  };
}

/* ===========================
   STREAMING CHAT
=========================== */

async function sendMessage() {
  const text = userInput.value.trim();

  if (!text) {
    return continueMessage();
  }
  if (!currentChatId) return;

  addBubble(text, "user");
  const userText = text;
  userInput.value = "";

  const botContent = addBubble("", "bot");

  showTyping();

  let fullText = "";

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character,
        chat_id: currentChatId,
        message: userText
      })
    });

    if (!res.ok || !res.body) {
      hideTyping();
      botContent.textContent = "The server didn't respond. Try again?";
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      fullText += chunk;

      botContent.textContent += chunk;
      scrollToBottom();
    }

    hideTyping();

    let swipeReplies = [];
    try {
      const swipeRes = await fetch(`${API}/chat-swipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character,
          chat_id: currentChatId,
          message: userText
        })
      });

      if (swipeRes.ok) {
        const data = await swipeRes.json();
        swipeReplies = data.replies || [];
      }
    } catch (e) {
      console.warn("Swipe fetch failed", e);
    }

    const allReplies = [fullText, ...swipeReplies];

    renderSwipeBlock(allReplies, userText, botContent);
  } catch (e) {
    console.error(e);
    hideTyping();
    botContent.textContent = "I'm having trouble responding right now. Try again?";
  }
}

async function continueMessage() {
  if (!currentChatId) return;

  const botContent = addBubble("", "bot", null, true);

  showTyping();

  let fullText = "";

  try {
    const res = await fetch(`${API}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character,
        chat_id: currentChatId,
        message: ""
      })
    });

    if (!res.ok || !res.body) {
      hideTyping();
      botContent.textContent = "The server didn't respond. Try again?";
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      fullText += chunk;

      botContent.textContent = fullText;
      scrollToBottom();
    }

    hideTyping();

    await fetch(`${API}/chat/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character,
        chat_id: currentChatId,
        message: "",
        reply: fullText
      })
    });
  } catch (e) {
    console.error(e);
    hideTyping();
    botContent.textContent = "I'm having trouble responding right now. Try again?";
  }
}

/* ===========================
   DRAWERS & EVENTS
=========================== */

console.log("Character param:", character);

menuButton.onclick = () => sideDrawer.classList.toggle("open");
openHistoryBtn.onclick = () => historyDrawer.classList.add("open");
closeHistoryBtn.onclick = () => historyDrawer.classList.remove("open");

document.addEventListener("click", (e) => {
  const insideMain = sideDrawer.contains(e.target);
  const insideHistory = historyDrawer.contains(e.target);
  const clickedMenu = menuButton.contains(e.target);

  if (!insideMain && !clickedMenu && !insideHistory) {
    sideDrawer.classList.remove("open");
    historyDrawer.classList.remove("open");
  }
});

saveMemoryBtn.onclick = saveMemory;
historyNewChatBtn.onclick = createNewSession;
sendBtn.onclick = sendMessage;

personaSelect.addEventListener("change", () => {
  updateCurrentPersona();
});

userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (e.shiftKey) {
      e.preventDefault();
      const start = userInput.selectionStart;
      const end = userInput.selectionEnd;
      userInput.value =
        userInput.value.substring(0, start) +
        "\n" +
        userInput.value.substring(end);
      userInput.selectionStart = userInput.selectionEnd = start + 1;
      return;
    }

    e.preventDefault();
    sendMessage();
  }
});

document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("edit-btn")) {
    const bubble = e.target.closest(".bubble");
    const content = bubble.querySelector(".bubble-text");
    const original = content.textContent;

    bubble.dataset.original = original;

    content.innerHTML = `
      <textarea class="edit-area">${original}</textarea>
      <div class="edit-controls">
        <button class="save-edit">Save</button>
        <button class="cancel-edit">Cancel</button>
      </div>
    `;
    return;
  }

  if (e.target.classList.contains("save-edit")) {
    const bubble = e.target.closest(".bubble");
    const id = bubble.dataset.id;
    const newText = bubble.querySelector(".edit-area").value;

    await fetch(`${API}/chat/${character}/${currentChatId}/message/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_text: newText })
    });

    bubble.querySelector(".bubble-text").textContent = newText;
    return;
  }

  if (e.target.classList.contains("cancel-edit")) {
    const bubble = e.target.closest(".bubble");
    const original = bubble.dataset.original;
    bubble.querySelector(".bubble-text").textContent = original;
    return;
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
