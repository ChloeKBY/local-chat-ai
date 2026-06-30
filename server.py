import os
import uuid
import json
import logging
import requests
from fastapi import FastAPI, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# CONFIG
MODEL_NAME = "mistral:7b"
OLLAMA_BASE = "http://127.0.0.1:11434"
CHAR_DIR = "characters"
CHAT_DIR = "chats"
PERSONA_DIR = "personas"
PERSONA_IMG_DIR = "personas/image"
GALLERY_DIR = "gallery"
N_SWIPES = 4        # extra alternates generated alongside main response
HISTORY_LIMIT = 20  # how many past messages to include in prompt

os.makedirs(CHAR_DIR, exist_ok=True)
os.makedirs(CHAT_DIR, exist_ok=True)
os.makedirs(PERSONA_DIR, exist_ok=True)
os.makedirs(PERSONA_IMG_DIR, exist_ok=True)
os.makedirs(GALLERY_DIR, exist_ok=True)
os.makedirs(os.path.join(CHAR_DIR, "character_images"), exist_ok=True)

logger = logging.getLogger("uvicorn.error")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/ui", StaticFiles(directory="ui"), name="ui")
app.mount("/characters/character_images", StaticFiles(directory="characters/character_images"), name="character_images")
app.mount("/personas/image", StaticFiles(directory="personas/image"), name="persona_images")
app.mount("/gallery", StaticFiles(directory="gallery"), name="gallery")

# ── UTILITIES ────────────────────────────────────────────────────────────────

def load_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def chat_path(chat_id: str):
    return os.path.join(CHAT_DIR, f"{chat_id}.json")

def load_character(name: str):
    return load_json(os.path.join(CHAR_DIR, f"{name}.json"))

# ── GALLERY ───────────────────────────────────────────────────────────────────

@app.get("/gallery-images")
def api_gallery_images():
    return [
        f"/gallery/{f}"
        for f in os.listdir(GALLERY_DIR)
        if f.lower().endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
    ]

# ── PERSONAS ──────────────────────────────────────────────────────────────────

@app.get("/personas")
def api_get_personas():
    personas = []
    for filename in os.listdir(PERSONA_DIR):
        if filename.endswith(".json"):
            data = load_json(os.path.join(PERSONA_DIR, filename))
            if data:
                personas.append(data)
    return personas

@app.get("/personas/{persona_id}")
def api_get_persona(persona_id: str):
    return load_json(os.path.join(PERSONA_DIR, f"{persona_id}.json")) or {"error": "not found"}

@app.post("/personas")
async def api_create_persona(
    name: str = Form(...),
    description: str = Form(...),
    image: UploadFile = File(None)
):
    persona_id = str(uuid.uuid4())
    persona = {"id": persona_id, "name": name, "description": description, "image_url": None}
    if image:
        ext = os.path.splitext(image.filename)[1]
        filename = f"{persona_id}{ext}"
        filepath = os.path.join(PERSONA_IMG_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(image.file.read())
        persona["image_url"] = f"/personas/image/{filename}"
    save_json(os.path.join(PERSONA_DIR, f"{persona_id}.json"), persona)
    return persona

@app.put("/personas/{persona_id}")
async def api_update_persona(
    persona_id: str,
    name: str = Form(...),
    description: str = Form(...),
    image: UploadFile = File(None)
):
    path = os.path.join(PERSONA_DIR, f"{persona_id}.json")
    persona = load_json(path) or {}
    persona["name"] = name
    persona["description"] = description
    if image:
        ext = os.path.splitext(image.filename)[1]
        filename = f"{persona_id}{ext}"
        filepath = os.path.join(PERSONA_IMG_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(image.file.read())
        persona["image_url"] = f"/personas/image/{filename}"
    save_json(path, persona)
    return persona

@app.delete("/personas/{persona_id}")
def api_delete_persona(persona_id: str):
    path = os.path.join(PERSONA_DIR, f"{persona_id}.json")
    if os.path.exists(path):
        os.remove(path)
    return {"status": "ok"}

# ── CHARACTERS ────────────────────────────────────────────────────────────────

@app.get("/characters")
def api_get_characters():
    chars = []
    for filename in os.listdir(CHAR_DIR):
        if filename.endswith(".json"):
            data = load_json(os.path.join(CHAR_DIR, filename))
            if data:
                data["id"] = filename.replace(".json", "")
                chars.append(data)
    return chars

@app.get("/character/{char_id}")
def api_get_character(char_id: str):
    data = load_character(char_id)
    if not data:
        return {"error": "Character not found"}
    data["id"] = char_id
    return data

@app.post("/characters")
async def api_create_character(
    id: str = Form(...),
    name: str = Form(...),
    description: str = Form(""),
    opening_scene: str = Form(""),
    first_message: str = Form(""),
    persona_identity: str = Form(""),
    persona_personality: str = Form(""),
    persona_knowledge_scope: str = Form(""),
    persona_improv_rules: str = Form(""),
    persona_behavior_rules: str = Form(""),
    persona_boundaries: str = Form(""),
    style_voice: str = Form(""),
    style_formatting: str = Form(""),
    style_pacing: str = Form(""),
    image: UploadFile = File(None)
):
    char_id = id.strip().lower().replace(" ", "_")
    char = {
        "name": name,
        "description": description,
        "opening_scene": opening_scene,
        "first_message": first_message,
        "image_url": None,
        "persona": {
            "identity": persona_identity,
            "personality": persona_personality,
            "knowledge_scope": persona_knowledge_scope,
            "improv_rules": persona_improv_rules,
            "behavior_rules": persona_behavior_rules,
            "boundaries": persona_boundaries,
        },
        "dialogue_style": {
            "voice": style_voice,
            "formatting": style_formatting,
            "pacing": style_pacing,
        }
    }
    if image and image.filename:
        ext = os.path.splitext(image.filename)[1]
        img_path = os.path.join(CHAR_DIR, "character_images", f"{char_id}{ext}")
        with open(img_path, "wb") as f:
            f.write(image.file.read())
        char["image_url"] = f"/characters/character_images/{char_id}{ext}"
    save_json(os.path.join(CHAR_DIR, f"{char_id}.json"), char)
    return {"id": char_id, **char}

@app.put("/characters/{char_id}")
async def api_update_character(
    char_id: str,
    name: str = Form(...),
    description: str = Form(""),
    opening_scene: str = Form(""),
    first_message: str = Form(""),
    persona_identity: str = Form(""),
    persona_personality: str = Form(""),
    persona_knowledge_scope: str = Form(""),
    persona_improv_rules: str = Form(""),
    persona_behavior_rules: str = Form(""),
    persona_boundaries: str = Form(""),
    style_voice: str = Form(""),
    style_formatting: str = Form(""),
    style_pacing: str = Form(""),
    image: UploadFile = File(None)
):
    path = os.path.join(CHAR_DIR, f"{char_id}.json")
    char = load_json(path) or {}
    char["name"] = name
    char["description"] = description
    char["opening_scene"] = opening_scene
    char["first_message"] = first_message
    char["persona"] = {
        "identity": persona_identity,
        "personality": persona_personality,
        "knowledge_scope": persona_knowledge_scope,
        "improv_rules": persona_improv_rules,
        "behavior_rules": persona_behavior_rules,
        "boundaries": persona_boundaries,
    }
    char["dialogue_style"] = {
        "voice": style_voice,
        "formatting": style_formatting,
        "pacing": style_pacing,
    }
    if image and image.filename:
        ext = os.path.splitext(image.filename)[1]
        img_path = os.path.join(CHAR_DIR, "character_images", f"{char_id}{ext}")
        with open(img_path, "wb") as f:
            f.write(image.file.read())
        char["image_url"] = f"/characters/character_images/{char_id}{ext}"
    save_json(path, char)
    return {"id": char_id, **char}

@app.delete("/characters/{char_id}")
def api_delete_character(char_id: str):
    path = os.path.join(CHAR_DIR, f"{char_id}.json")
    if os.path.exists(path):
        os.remove(path)
    # Also clean up any chats for this character
    for filename in os.listdir(CHAT_DIR):
        if filename.endswith(".json"):
            data = load_json(os.path.join(CHAT_DIR, filename))
            if isinstance(data, dict) and data.get("character") == char_id:
                os.remove(os.path.join(CHAT_DIR, filename))
    return {"status": "ok"}

# ── CHAT SESSIONS ─────────────────────────────────────────────────────────────

def load_sessions(character: str):
    sessions = []
    for filename in os.listdir(CHAT_DIR):
        if filename.endswith(".json"):
            data = load_json(os.path.join(CHAT_DIR, filename))
            if isinstance(data, dict) and data.get("character") == character:
                sessions.append(data)
    sessions.sort(key=lambda x: x.get("id"), reverse=True)
    return sessions

def create_session(character: str, persona_id: str | None = None):
    chat_id = str(uuid.uuid4())
    session = {
        "id": chat_id,
        "character": character,
        "title": "New Chat",
        "persona_id": persona_id,
        "history": [],
        "memory": ""
    }
    save_json(chat_path(chat_id), session)
    return session

@app.post("/chat-session")
def api_new_session(data: dict = Body(...)):
    character = data.get("character")
    persona_id = data.get("persona_id")
    session = create_session(character, persona_id)
    char_data = load_character(character)
    if char_data:
        if char_data.get("opening_scene"):
            session["history"].append({
                "id": str(uuid.uuid4()), "role": "bot",
                "text": char_data["opening_scene"], "swipes": [], "swipe_index": 0
            })
        if char_data.get("first_message"):
            session["history"].append({
                "id": str(uuid.uuid4()), "role": "bot",
                "text": char_data["first_message"], "swipes": [], "swipe_index": 0
            })
    save_json(chat_path(session["id"]), session)
    return session

@app.get("/chat-sessions/{character}")
def api_get_sessions(character: str):
    return load_sessions(character)

@app.get("/chat-history/{character}/{chat_id}")
def api_get_history(character: str, chat_id: str):
    return load_json(chat_path(chat_id)) or {"error": "not found"}

@app.post("/chat-session/delete")
def api_delete_session(data: dict = Body(...)):
    chat_id = data.get("chat_id")
    path = chat_path(chat_id)
    if os.path.exists(path):
        os.remove(path)
    return {"status": "ok"}

@app.post("/chat-session/rename")
def api_rename_session(data: dict = Body(...)):
    chat_id = data.get("chat_id")
    title = data.get("title")
    session = load_json(chat_path(chat_id))
    if session:
        session["title"] = title
        save_json(chat_path(chat_id), session)
    return {"status": "ok"}

@app.post("/chat-memory/{character}/{chat_id}")
def api_save_memory(character: str, chat_id: str, data: dict = Body(...)):
    session = load_json(chat_path(chat_id)) or {}
    session["memory"] = data.get("memory", "")
    save_json(chat_path(chat_id), session)
    return {"status": "ok"}

# ── MESSAGE CRUD ──────────────────────────────────────────────────────────────

@app.patch("/chat/{character}/{chat_id}/message/{msg_id}")
def api_edit_message(character: str, chat_id: str, msg_id: str, data: dict = Body(...)):
    """Edit the text of any message. Also clears swipes since they no longer match."""
    new_text = data.get("new_text", "")
    session = load_json(chat_path(chat_id)) or {}
    history = session.get("history", [])
    for msg in history:
        if msg.get("id") == msg_id:
            msg["text"] = new_text
            msg["swipes"] = []
            msg["swipe_index"] = 0
            break
    session["history"] = history
    save_json(chat_path(chat_id), session)
    return {"status": "ok"}

@app.delete("/chat/{character}/{chat_id}/message/{msg_id}")
def api_delete_message(character: str, chat_id: str, msg_id: str):
    """Delete a single message from the history."""
    session = load_json(chat_path(chat_id)) or {}
    history = session.get("history", [])
    session["history"] = [m for m in history if m.get("id") != msg_id]
    save_json(chat_path(chat_id), session)
    return {"status": "ok"}

@app.post("/chat/{character}/{chat_id}/message/{msg_id}/swipe")
def api_set_swipe(character: str, chat_id: str, msg_id: str, data: dict = Body(...)):
    """Persist which swipe index the user has landed on."""
    new_index = data.get("swipe_index", 0)
    session = load_json(chat_path(chat_id)) or {}
    history = session.get("history", [])
    for msg in history:
        if msg.get("id") == msg_id:
            swipes = msg.get("swipes", [])
            if 0 <= new_index < len(swipes):
                msg["swipe_index"] = new_index
                msg["text"] = swipes[new_index]
            break
    session["history"] = history
    save_json(chat_path(chat_id), session)
    return {"status": "ok"}

# ── PROMPT BUILDER ────────────────────────────────────────────────────────────

def build_prompt(character_data, history, user_message, persona, memory):
    char_name = character_data.get("name", "The character")
    persona_block = character_data.get("persona", {}) or {}
    style_block = character_data.get("dialogue_style", {}) or {}

    system_prompt = f"""
You are {char_name}, a fictional character in a roleplay chat.

You speak, think, and act ONLY as {char_name}.
You NEVER write actions, thoughts, or dialogue for the user.
You NEVER switch POV away from {char_name}.
You NEVER describe what the user feels, thinks, or does.
You ONLY write your own dialogue, actions, and internal thoughts.

Roleplay Formatting:
- Use *asterisks* for your actions. Example: *he leans back in his chair*
- Use quotes for your spoken dialogue. Example: "So, you really mean that?"
- You may include internal thoughts in italics or plain text, but clearly as your own.
- Stay immersive, emotional, and character-driven. Avoid meta commentary.
- Do NOT add content warnings, disclaimers, or moral lectures.
- Do NOT break character to talk about being an AI or a model.

Character Profile:
- Identity: {persona_block.get("identity", "")}
- Personality: {persona_block.get("personality", "")}
- Knowledge Scope: {persona_block.get("knowledge_scope", "")}
- Improv Rules: {persona_block.get("improv_rules", "")}
- Behavior Rules: {persona_block.get("behavior_rules", "")}
- Boundaries: {persona_block.get("boundaries", "")}

Dialogue Style:
- Voice: {style_block.get("voice", "")}
- Formatting: {style_block.get("formatting", "")}
- Pacing: {style_block.get("pacing", "")}
"""

    if persona:
        system_prompt += f"""
User Context (for reference only, do NOT write their actions or thoughts):
- Name: {persona.get("name","")}
- Description: {persona.get("description","")}
"""

    if memory:
        system_prompt += f"\nPinned Memory (things you should remember about the user and story):\n{memory}\n"

    messages = [{"role": "system", "content": system_prompt.strip()}]

    for msg in history[-HISTORY_LIMIT:]:
        if msg["role"] == "user":
            messages.append({"role": "user", "content": msg["text"]})
        else:
            messages.append({"role": "assistant", "content": msg["text"]})

    messages.append({"role": "user", "content": user_message})
    return messages

def messages_to_prompt(messages):
    parts = []
    for m in messages:
        role = m.get("role", "")
        text = m.get("content", "")
        parts.append(f"{role.upper()}: {text}")
    return "\n".join(parts)

def ollama_generate(prompt_text: str, stream: bool = False):
    return requests.post(
        f"{OLLAMA_BASE}/api/generate",
        json={
            "model": MODEL_NAME,
            "prompt": prompt_text,
            "stream": stream,
            "temperature": 1.2,
            "top_p": 0.95,
            "top_k": 40,
            "repeat_penalty": 1.1,
            "num_predict": 400,
        },
        stream=stream,
        timeout=120
    )

# ── CHAT ──────────────────────────────────────────────────────────────────────

@app.post("/chat")
def api_chat(data: dict = Body(...)):
    character = data.get("character")
    chat_id = data.get("chat_id")
    raw_message = (data.get("message") or "").strip()

    session = load_json(chat_path(chat_id)) or {}
    char_data = load_character(character) or {}
    persona_id = session.get("persona_id")
    persona = load_json(os.path.join(PERSONA_DIR, f"{persona_id}.json")) if persona_id else None

    history = session.get("history", [])
    memory = session.get("memory", "")
    user_message = raw_message if raw_message else "Continue the previous response."

    messages = build_prompt(char_data, history, user_message, persona, memory)
    prompt_text = messages_to_prompt(messages)

    def stream_reply():
        try:
            with ollama_generate(prompt_text, stream=True) as r:
                for line in r.iter_lines():
                    if not line:
                        continue
                    data_r = json.loads(line.decode("utf-8"))
                    if "response" in data_r:
                        yield data_r["response"]
                    if data_r.get("done"):
                        break
        except Exception as e:
            logger.error(f"Generation error: {e}")
            yield "\n[Error generating response]"

    return StreamingResponse(stream_reply(), media_type="text/plain")


@app.post("/chat-swipes")
def api_chat_swipes(data: dict = Body(...)):
    """Generate N alternative replies without committing anything to history."""
    character = data.get("character")
    chat_id = data.get("chat_id")
    raw_message = (data.get("message") or "").strip()

    session = load_json(chat_path(chat_id)) or {}
    char_data = load_character(character) or {}
    persona_id = session.get("persona_id")
    persona = load_json(os.path.join(PERSONA_DIR, f"{persona_id}.json")) if persona_id else None

    history = session.get("history", [])
    memory = session.get("memory", "")
    user_message = raw_message if raw_message else "Continue the previous response."

    messages = build_prompt(char_data, history, user_message, persona, memory)
    prompt_text = messages_to_prompt(messages)

    replies = []
    for _ in range(N_SWIPES):
        try:
            r = ollama_generate(prompt_text, stream=False)
            r.raise_for_status()
            reply = (r.json().get("response") or "").strip() or "…"
        except Exception as e:
            logger.error(f"Generation error (swipes): {e}")
            reply = "…"
        replies.append(reply)

    return {"replies": replies}


@app.post("/chat/commit")
def api_chat_commit(data: dict = Body(...)):
    """
    Save a user message + chosen bot reply to history.
    Also stores all swipe alternatives so they persist across reloads.
    """
    chat_id = data.get("chat_id")
    message = (data.get("message") or "").strip()
    reply = (data.get("reply") or "").strip()
    swipes = data.get("swipes") or []   # full list of alternatives including chosen

    session = load_json(chat_path(chat_id)) or {}
    history = session.get("history", [])

    if message:
        history.append({"id": str(uuid.uuid4()), "role": "user", "text": message, "swipes": [], "swipe_index": 0})

    if reply:
        # Put the chosen reply first, then the rest
        chosen_index = 0
        if reply in swipes:
            chosen_index = swipes.index(reply)
        history.append({
            "id": str(uuid.uuid4()),
            "role": "bot",
            "text": reply,
            "swipes": swipes,
            "swipe_index": chosen_index
        })

    session["history"] = history
    save_json(chat_path(chat_id), session)
    return {"status": "ok"}


@app.post("/chat/regenerate")
def api_regenerate(data: dict = Body(...)):
    """
    Remove the last bot message and regenerate it.
    Returns new swipes; caller must call /chat/commit to save.
    Also removes the last user message from history so the prompt
    is built correctly (caller re-commits it with the reply).
    """
    character = data.get("character")
    chat_id = data.get("chat_id")

    session = load_json(chat_path(chat_id)) or {}
    char_data = load_character(character) or {}
    persona_id = session.get("persona_id")
    persona = load_json(os.path.join(PERSONA_DIR, f"{persona_id}.json")) if persona_id else None

    history = session.get("history", [])
    memory = session.get("memory", "")

    # Pop the last bot message (and remember the last user message to re-send)
    last_user_text = ""
    if history and history[-1]["role"] == "bot":
        history = history[:-1]
    if history and history[-1]["role"] == "user":
        last_user_text = history[-1]["text"]
        history = history[:-1]

    # Temporarily save trimmed history for prompt building
    session["history"] = history
    save_json(chat_path(chat_id), session)

    user_message = last_user_text if last_user_text else "Continue the previous response."
    messages = build_prompt(char_data, history, user_message, persona, memory)
    prompt_text = messages_to_prompt(messages)

    replies = []
    for _ in range(N_SWIPES + 1):
        try:
            r = ollama_generate(prompt_text, stream=False)
            r.raise_for_status()
            reply = (r.json().get("response") or "").strip() or "…"
        except Exception as e:
            logger.error(f"Regenerate error: {e}")
            reply = "…"
        replies.append(reply)

    return {"replies": replies, "user_message": last_user_text}


# ── HEALTH ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "server running", "model": MODEL_NAME}
