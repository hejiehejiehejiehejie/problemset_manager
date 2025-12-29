/* 题单管理器（含：主题切换、宽屏侧栏可调、触屏抽屉、更多菜单、随机CF、标签库、Supabase 登录与手动同步、定期版本更新） */

const APP_VERSION = "1.0.0"; // 手动更新版本时可修改，便于诊断
const STORAGE_KEY = "problem-lists:v1";
const UNCATEGORIZED_NAME = "未分类";
const SIDEBAR_W_KEY = "plm:sidebar-w";
const SIDEBAR_COLLAPSED_KEY = "plm:sidebar:collapsed";
const THEME_KEY = "plm:theme";
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

const uid = () => Math.random().toString(36).slice(2, 10);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const dedup = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
const byNameAsc = (a, b) => String(a || "").localeCompare(String(b || ""));
function normalizeTag(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

// 图标：细线风格
const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

/* 主题 */
function getSystemTheme() {
  try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
  catch { return "dark"; }
}
function applyTheme(theme) {
  const t = (theme === "light" || theme === "dark") ? theme : "dark";
  document.documentElement.setAttribute("data-theme", t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "light" ? "#ffffff" : "#161b22");
  const btn = el("#theme-toggle");
  if (btn) {
    if (t === "light") {
      btn.innerHTML = ICON_SUN;
      btn.title = "切换到深色模式";
      btn.setAttribute("aria-label", "切换到深色模式");
    } else {
      btn.innerHTML = ICON_MOON;
      btn.title = "切换到浅色模式";
      btn.setAttribute("aria-label", "切换到浅色模式");
    }
  }
}
function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch {}
  const initial = saved || getSystemTheme();
  applyTheme(initial);
  const btn = el("#theme-toggle");
  if (btn) {
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = (cur === "light") ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch {}
    });
  }
}

/* 短标题解析：CF/洛谷/AtCoder */
function parseCodeforcesShort(url) {
  if (!url) return "";
  let raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u; try { u = new URL(raw); } catch { return ""; }
  const host = u.hostname.toLowerCase();
  if (!(host === "codeforces.com" || host === "m.codeforces.com" || host === "www.codeforces.com")) return "";
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "contest" && parts[2]?.toLowerCase() === "problem") {
    const num = parts[1], letter = (parts[3] || "").toUpperCase();
    if (/^\d+$/.test(num) && /^[0-9A-Z]+$/.test(letter)) return `CF${num}${letter}`;
  }
  if (parts[0]?.toLowerCase() === "problemset" && parts[1]?.toLowerCase() === "problem") {
    const num = parts[2], letter = (parts[3] || "").toUpperCase();
    if (/^\d+$/.test(num) && /^[0-9A-Z]+$/.test(letter)) return `CF${num}${letter}`;
  }
  if (parts[0]?.toLowerCase() === "gym" && parts[2]?.toLowerCase() === "problem") {
    const num = parts[1], letter = (parts[3] || "").toUpperCase();
    if (/^\d+$/.test(num) && /^[0-9A-Z]+$/.test(letter)) return `CF${num}${letter}`;
  }
  return "";
}
function parseLuoguShort(url) {
  if (!url) return "";
  let raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u; try { u = new URL(raw); } catch { return ""; }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)luogu\.com\.cn$/.test(host)) return "";
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "problem" && parts[1]) return `洛谷${parts[1].toUpperCase()}`;
  return "";
}
function parseAtcoderShort(url) {
  if (!url) return "";
  let raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  let u; try { u = new URL(raw); } catch { return ""; }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)atcoder\.jp$/.test(host)) return "";
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "contests" && parts[2] === "tasks") {
    const task = (parts[3] || "").trim();
    if (task) return `AT_${task}`;
  }
  return "";
}
function parseShortTitle(url) { return parseCodeforcesShort(url) || parseLuoguShort(url) || parseAtcoderShort(url) || ""; }
function trySetTitleFromUrl(problem) {
  const code = parseShortTitle(problem.url);
  if (code && !String(problem.title || "").trim()) { problem.title = code; return true; }
  return false;
}

/* 拖拽重排 */
function enableDragSort(container, itemSelector, onReorder) {
  if (container.__dndCleanup) container.__dndCleanup();
  container.querySelectorAll(".drag-placeholder").forEach((n) => n.remove());
  let dragEl = null, fromIndex = -1;
  const placeholder = document.createElement("div"); placeholder.className = "drag-placeholder";
  const itemsAll = () => Array.from(container.querySelectorAll(itemSelector));
  const clear = () => {
    container.querySelectorAll(".drag-placeholder").forEach((n) => n.remove());
    if (dragEl) dragEl.classList.remove("dragging"); stopAutoScroll();
    dragEl = null; fromIndex = -1;
  };
  function insertPlaceholderAtPointer(evt) {
    const items = itemsAll().filter((el) => el !== dragEl);
    container.querySelectorAll(".drag-placeholder").forEach((n) => n.remove());
    if (!items.length) { container.appendChild(placeholder); return; }
    let inserted = false;
    for (const it of items) {
      const rect = it.getBoundingClientRect(); const mid = rect.top + rect.height / 2;
      if (evt.clientY < mid) { it.insertAdjacentElement("beforebegin", placeholder); inserted = true; break; }
    }
    if (!inserted) items[items.length - 1].insertAdjacentElement("afterend", placeholder);
  }
  function calcToIndex() {
    let idx = 0;
    for (const child of container.children) {
      if (child === placeholder) return idx;
      if (child.matches && child.matches(itemSelector)) { if (child !== dragEl) idx++; }
    }
    return idx;
  }
  function getScrollParent(node) {
    let n = node; while (n && n !== document.body) {
      const cs = getComputedStyle(n), oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  const scrollEl = getScrollParent(container);
  let autoScrollTimer = null;
  function stopAutoScroll() { if (autoScrollTimer) { cancelAnimationFrame(autoScrollTimer); autoScrollTimer = null; } }
  function autoScrollIfNeeded(evt) {
    const el = scrollEl, rect = el.getBoundingClientRect();
    const margin = Math.min(60, rect.height / 4), maxSpeed = 20;
    let speed = 0;
    if (evt.clientY < rect.top + margin) {
      const t = rect.top + margin - evt.clientY; speed = -Math.min(maxSpeed, Math.ceil((t / margin) * maxSpeed));
    } else if (evt.clientY > rect.bottom - margin) {
      const t = evt.clientY - (rect.bottom - margin); speed = Math.min(maxSpeed, Math.ceil((t / margin) * maxSpeed));
    }
    if (speed === 0) { stopAutoScroll(); return; }
    if (autoScrollTimer) return;
    const step = () => { el.scrollTop += speed; autoScrollTimer = requestAnimationFrame(step); };
    autoScrollTimer = requestAnimationFrame(step);
  }
  const onDragStart = (e) => {
    if (e.target.closest('input, textarea, select, button, [contenteditable="true"]')) { e.preventDefault(); return; }
    dragEl = e.currentTarget; dragEl.classList.add("dragging");
    fromIndex = itemsAll().indexOf(dragEl);
    e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "");
    container.querySelectorAll(".drag-placeholder").forEach((n) => n.remove());
    dragEl.insertAdjacentElement("afterend", placeholder);
  };
  const commitIfPossible = () => {
    if (dragEl && fromIndex !== -1 && placeholder.isConnected) {
      const toIndex = calcToIndex();
      if (toIndex !== -1 && typeof onReorder === "function") onReorder(fromIndex, toIndex);
    }
  };
  const onDragOver = (e) => { e.preventDefault(); insertPlaceholderAtPointer(e); autoScrollIfNeeded(e); };
  const onDrop = (e) => { e.preventDefault(); commitIfPossible(); clear(); };
  const onDragEnd = () => { commitIfPossible(); clear(); };

  const onDragEnter = (e) => e.preventDefault();

  const itemHandlers = new WeakMap();
  function bindItem(it) { const h = { dragstart: onDragStart, dragend: onDragEnd }; it.setAttribute("draggable", "true"); it.classList.add("draggable"); Object.entries(h).forEach(([t, fn]) => it.addEventListener(t, fn)); itemHandlers.set(it, h); }
  function unbindItem(it) { const h = itemHandlers.get(it); if (!h) return; Object.entries(h).forEach(([t, fn]) => it.removeEventListener(t, fn)); itemHandlers.delete(it); }
  function bindAll() { itemsAll().forEach(bindItem); container.addEventListener("dragenter", onDragEnter); container.addEventListener("dragover", onDragOver); container.addEventListener("drop", onDrop); }
  function unbindAll() { itemsAll().forEach(unbindItem); container.removeEventListener("dragenter", onDragEnter); container.removeEventListener("dragover", onDragOver); container.removeEventListener("drop", onDrop); clear(); }
  container.__dndCleanup = unbindAll; bindAll();
  return { refresh() { unbindAll(); bindAll(); }, cleanup() { unbindAll(); delete container.__dndCleanup; } };
}

/* 状态存取与迁移 */
function rebuildFlatTagsFromProblems(st) {
  const all = []; (st.lists || []).forEach((l) => (l.problems || []).forEach((p) => all.push(...(p.tags || []))));
  return dedup(all).sort(byNameAsc);
}
function ensureTagLibrary(st) {
  if (!st.tagLibrary) st.tagLibrary = { categories: [] };
  if (!Array.isArray(st.tagLibrary.categories)) st.tagLibrary.categories = [];
  if (!st.tagLibrary.categories.find((c) => c.name === UNCATEGORIZED_NAME)) {
    st.tagLibrary.categories.push({ id: uid(), name: UNCATEGORIZED_NAME, tags: [] });
  }
  st.tagLibrary.categories.forEach((c) => { c.tags = dedup(c.tags || []).sort(byNameAsc); });
}
function migrateState(data) {
  if (!data.tagLibrary) data.tagLibrary = { categories: [{ id: uid(), name: UNCATEGORIZED_NAME, tags: rebuildFlatTagsFromProblems(data) }] };
  else if (Array.isArray(data.tagLibrary)) data.tagLibrary = { categories: [{ id: uid(), name: UNCATEGORIZED_NAME, tags: dedup(data.tagLibrary).sort(byNameAsc) }] };
  ensureTagLibrary(data);
}
function loadState() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return null;
    const data = JSON.parse(raw); if (!data || !Array.isArray(data.lists)) return null; migrateState(data); return data;
  } catch { return null; }
}
function saveState(state) { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function createDefaultState() {
  const id = uid();
  const problems = [{ id: uid(), title: "示例：两数之和", url: "https://example.com/problem/two-sum", difficulty: "简单/入门", tags: ["数组","哈希表"], codeUrl: "" }];
  const st = { lists: [{ id, name: "我的第一个题单", problems }], activeListId: id, tagLibrary: { categories: [{ id: uid(), name: UNCATEGORIZED_NAME, tags: dedup(problems.flatMap(p=>p.tags)) }] } };
  ensureTagLibrary(st); return st;
}

/* 标签库（CRUD） */
function getCategories() { return state.tagLibrary.categories; }
function findCatById(id) { return getCategories().find((c) => c.id === id); }
function findOrCreateUncategorized() {
  let c = getCategories().find((x) => x.name === UNCATEGORIZED_NAME);
  if (!c) { c = { id: uid(), name: UNCATEGORIZED_NAME, tags: [] }; state.tagLibrary.categories.push(c); }
  return c;
}
function hasTagAnywhere(tag) { const n = normalizeTag(tag); return getCategories().some((c) => (c.tags || []).map(normalizeTag).includes(n)); }
function addCategory(name) {
  const nm = String(name || "").trim(); if (!nm || nm === UNCATEGORIZED_NAME) return null;
  if (getCategories().some((c) => c.name === nm)) return null;
  const c = { id: uid(), name: nm, tags: [] }; state.tagLibrary.categories.push(c); ensureTagLibrary(state); persist(); return c;
}
function renameCategory(id, newName) {
  const c = findCatById(id); const nm = String(newName || "").trim();
  if (!c || !nm || nm === UNCATEGORIZED_NAME) return false;
  if (getCategories().some((x) => x.name === nm && x.id !== id)) return false;
  c.name = nm; ensureTagLibrary(state); persist(); return true;
}
function deleteCategory(id) {
  const c = findCatById(id); if (!c) return false;
  if (c.name === UNCATEGORIZED_NAME) { alert("不能删除「未分类」"); return false; }
  const unc = findOrCreateUncategorized();
  unc.tags = dedup([...(unc.tags||[]), ...(c.tags||[])]).sort(byNameAsc);
  state.tagLibrary.categories = getCategories().filter((x)=>x.id!==id);
  ensureTagLibrary(state); persist(); return true;
}
function addTagToCategory(catId, tag) {
  const c = findCatById(catId); const raw = String(tag||"").trim(); const norm = normalizeTag(raw);
  if (!c || !raw) return false;
  const from = getCategories().find((x)=> (x.tags||[]).map(normalizeTag).includes(norm));
  if (from && from.id !== catId) from.tags = from.tags.filter((x)=> normalizeTag(x)!==norm);
  if (!c.tags.map(normalizeTag).includes(norm)) c.tags.push(raw);
  c.tags.sort(byNameAsc); persist(); return true;
}
function renameTag(catId, oldName, newName) {
  const c = findCatById(catId); const nm = String(newName||"").trim(); const nOld=normalizeTag(oldName); const nNew=normalizeTag(nm);
  if (!c || !nm || !c.tags.map(normalizeTag).includes(nOld)) return false;
  const other = getCategories().find((x)=> x.tags.map(normalizeTag).includes(nNew));
  if (other && other.id !== catId) other.tags = other.tags.filter((x)=> normalizeTag(x)!==nNew);
  c.tags = c.tags.map((x)=> normalizeTag(x)===nOld ? nm : x).sort(byNameAsc);
  persist(); return true;
}
function deleteTag(catId, tag) {
  const c = findCatById(catId); if (!c) return false;
  const n=normalizeTag(tag); c.tags = c.tags.filter((x)=> normalizeTag(x)!==n);
  persist(); return true;
}
function moveTag(tag, fromId, toId) {
  if (fromId===toId) return true;
  const from=findCatById(fromId), to=findCatById(toId); if (!from||!to) return false;
  const n=normalizeTag(tag);
  from.tags = from.tags.filter((x)=> normalizeTag(x)!==n);
  if (!to.tags.map(normalizeTag).includes(n)) to.tags.push(tag);
  to.tags.sort(byNameAsc); persist(); return true;
}
function addTagToProblem(problem, tag) {
  const raw = String(tag||"").trim(); if (!raw) return false;
  const norm = normalizeTag(raw);
  problem.tags = Array.isArray(problem.tags)?problem.tags:[];
  const owned = new Set(problem.tags.map(normalizeTag));
  if (!owned.has(norm)) problem.tags.push(raw);
  if (!hasTagAnywhere(raw)) {
    const unc=findOrCreateUncategorized();
    if (!unc.tags.map(normalizeTag).includes(norm)) { unc.tags.push(raw); unc.tags.sort(byNameAsc); }
  }
  persist(); return true;
}

/* 全局状态 */
let state = loadState() || createDefaultState();
saveState(state);

/* 高级筛选（新增） */
const filters = { diffMin: null, diffMax: null, tagsAll: [], tagsAny: [], sites: new Set() };
function parseTagsInput(s) { return String(s || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean); }
function getProblemNumericDifficulty(p) {
  const d = Number(String(p.difficulty || "").trim());
  return Number.isFinite(d) ? d : null;
}
function siteOfProblem(p) {
  const u = String(p.url || "").toLowerCase();
  if (/codeforces\.com/.test(u)) return "cf";
  if (/atcoder\.jp/.test(u)) return "at";
  if (/luogu\.com\.cn/.test(u)) return "luogu";
  return "other";
}

/* Supabase 集成（登录 + 手动上传/下载） */
const CLIENT_ID_KEY = "plm:client-id";
function ensureClientId() {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) { id = uid(); localStorage.setItem(CLIENT_ID_KEY, id); }
    return id;
  } catch { return uid(); }
}
const CLIENT_ID = ensureClientId();

const SUPA_CONF = (window.SUPABASE_CONFIG || null);
let supa = null;
let authUser = null;
const STATE_TABLE = "plm_states";

function getRedirectTo() {
  try {
    const conf = window.SUPABASE_CONFIG || {};
    if (conf.redirectToOverride) return conf.redirectToOverride;
    const { origin, pathname } = window.location;
    const path = pathname.replace(/\/index\.html$/, "/");
    return origin + path;
  } catch {
    return window.location.origin + "/";
  }
}

function initSupabase() {
  try {
    if (!window.supabase || !SUPA_CONF || !SUPA_CONF.url || !SUPA_CONF.anonKey) { updateAccountUI(); return; }
    supa = window.supabase.createClient(SUPA_CONF.url, SUPA_CONF.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    supa.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) onLogin(session.user);
      updateAccountUI();
    });
    supa.auth.onAuthStateChange((_event, session) => {
      if (session?.user) onLogin(session.user); else onLogout();
    });
  } catch (e) { console.warn("Supabase init failed", e); updateAccountUI(); }
}
function updateAccountUI() {
  const emailEl = el("#account-email");
  const loginBtn = el("#login-btn");
  const logoutBtn = el("#logout-btn");
  const upBtn = el("#sync-upload-btn");
  const downBtn = el("#sync-download-btn");

  if (emailEl) {
    emailEl.textContent = authUser ? (authUser.email || "已登录") : "未登录";
    emailEl.classList.toggle("is-logged-in", !!authUser); // 登录后淡色小字
  }

  if (loginBtn) loginBtn.classList.toggle("hidden", !!authUser);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !authUser);

  const disabled = !authUser;
  if (upBtn) upBtn.disabled = disabled;
  if (downBtn) downBtn.disabled = disabled;
}
function onLogin(user) { authUser = user; updateAccountUI(); }
function onLogout() { authUser = null; updateAccountUI(); }

async function loadRemoteState() {
  if (!supa || !authUser) return null;
  const { data, error } = await supa.from(STATE_TABLE).select("data,updated_at").eq("user_id", authUser.id).single();
  if (error && error.code !== "PGRST116") throw error;
  return data?.data || null;
}
async function saveRemoteState() {
  if (!supa || !authUser) return { ok: false, error: new Error("未登录") };
  const payload = {
    user_id: authUser.id,
    data: { ...state, _meta: { client_id: CLIENT_ID, ts: Date.now() } },
    updated_at: new Date().toISOString(),
  };
  const { error } = await supa.from(STATE_TABLE).upsert(payload, { onConflict: "user_id" });
  if (error) return { ok: false, error };
  return { ok: true };
}

/* 单元格渲染（标题/难度/链接/代码） */
function renderTitleCell(p, cell) {
  cell.setAttribute("data-label","标题");
  cell.innerHTML = "";
  const showView = () => {
    cell.innerHTML = "";
    const wrap = document.createElement("div"); wrap.style.display="inline-flex"; wrap.style.alignItems="center"; wrap.style.gap="8px";
    const t = String(p.title||"").trim();
    if (t) { const span=document.createElement("span"); span.textContent=t; wrap.appendChild(span);
      const btn=document.createElement("button"); btn.textContent="修改"; btn.className="btn-ghost btn-xs"; btn.title="修改标题";
      btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } else {
      const btn=document.createElement("button"); btn.textContent="添加"; btn.className="btn-ghost btn-xs"; btn.title="添加标题";
      btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    }
    cell.appendChild(wrap);
  };
  const showEdit = () => {
    cell.innerHTML=""; const form=document.createElement("div"); form.style.display="inline-flex"; form.style.alignItems="center"; form.style.gap="6px";
    const input=document.createElement("input"); input.type="text"; input.placeholder="输入标题"; input.value=p.title||""; input.className="input-sm";
    const save=document.createElement("button"); save.textContent="保存"; save.className="btn-primary btn-xxs";
    const cancel=document.createElement("button"); cancel.textContent="取消"; cancel.className="btn-xxs";
    const actions=document.createElement("div"); actions.className="edit-actions"; actions.appendChild(save); actions.appendChild(cancel);
    save.addEventListener("click", ()=>{ p.title=input.value.trim(); persist(); renderLists(); showView(); });
    cancel.addEventListener("click", showView);
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){e.preventDefault();save.click();} else if(e.key==="Escape"){e.preventDefault();cancel.click();}});
    form.appendChild(input); form.appendChild(actions); cell.appendChild(form); setTimeout(()=>input.focus(),0);
  };
  showView();
}
function renderDifficultyCell(p, cell) {
  cell.setAttribute("data-label","难度");
  cell.innerHTML=""; const showView=()=> {
    cell.innerHTML=""; const wrap=document.createElement("div"); wrap.style.display="inline-flex"; wrap.style.alignItems="center"; wrap.style.gap="8px";
    const d=String(p.difficulty||"").trim();
    if (d) { const span=document.createElement("span"); span.textContent=d; wrap.appendChild(span);
      const btn=document.createElement("button"); btn.textContent="修改"; btn.className="btn-ghost btn-xs"; btn.title="修改难度"; btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } else { const btn=document.createElement("button"); btn.textContent="添加"; btn.className="btn-ghost btn-xs"; btn.title="添加难度"; btn.addEventListener("click", showEdit); wrap.appendChild(btn); }
    cell.appendChild(wrap);
  };
  const showEdit=()=> {
    cell.innerHTML=""; const form=document.createElement("div"); form.style.display="inline-flex"; form.style.alignItems="center"; form.style.gap="6px";
    const input=document.createElement("input"); input.type="text"; input.placeholder="例如：入门 / 中等 / 困难+"; input.value=p.difficulty||""; input.className="input-sm";
    const save=document.createElement("button"); save.textContent="保存"; save.className="btn-primary btn-xxs";
    const cancel=document.createElement("button"); cancel.textContent="取消"; cancel.className="btn-xxs";
    const actions=document.createElement("div"); actions.className="edit-actions"; actions.appendChild(save); actions.appendChild(cancel);
    save.addEventListener("click", ()=>{ p.difficulty=input.value.trim(); persist(); showView(); });
    cancel.addEventListener("click", showView);
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){e.preventDefault();save.click();} else if(e.key==="Escape"){e.preventDefault();cancel.click();}});
    form.appendChild(input); form.appendChild(actions); cell.appendChild(form); setTimeout(()=>input.focus(),0);
  };
  showView();
}
function renderProblemLinkCell(p, cell) {
  cell.setAttribute("data-label","题目链接");
  cell.innerHTML=""; const showView=()=> {
    cell.innerHTML=""; const wrap=document.createElement("div"); wrap.style.display="inline-flex"; wrap.style.alignItems="center"; wrap.style.gap="8px";
    if (p.url) {
      const a=document.createElement("a"); a.href=p.url; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent="打开"; wrap.appendChild(a);
      const btn=document.createElement("button"); btn.textContent="修改"; btn.className="btn-ghost btn-xs"; btn.title="修改链接"; btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } else {
      const btn=document.createElement("button"); btn.textContent="添加"; btn.className="btn-ghost btn-xs"; btn.title="添加链接"; btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } cell.appendChild(wrap);
  };
  const showEdit=()=> {
    cell.innerHTML=""; const form=document.createElement("div"); form.style.display="inline-flex"; form.style.alignItems="center"; form.style.gap="6px";
    const input=document.createElement("input"); input.type="url"; input.placeholder="https://..."; input.value=p.url||""; input.className="input-sm";
    const save=document.createElement("button"); save.textContent="保存"; save.className="btn-primary btn-xxs";
    const cancel=document.createElement("button"); cancel.textContent="取消"; cancel.className="btn-xxs";
    const actions=document.createElement("div"); actions.className="edit-actions"; actions.appendChild(save); actions.appendChild(cancel);
    save.addEventListener("click", ()=>{ p.url=input.value.trim(); const changed=trySetTitleFromUrl(p); persist(); if(changed) { renderProblems(); renderLists(); } else { showView(); } });
    cancel.addEventListener("click", showView);
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){e.preventDefault();save.click();} else if(e.key==="Escape"){e.preventDefault();cancel.click();}});
    form.appendChild(input); form.appendChild(actions); cell.appendChild(form); setTimeout(()=>input.focus(),0);
  };
  showView();
}
function renderCodeLinkCell(p, cell) {
  cell.setAttribute("data-label","代码链接");
  cell.innerHTML=""; const showView=()=> {
    cell.innerHTML=""; const wrap=document.createElement("div"); wrap.className="code-cell-wrap";
    wrap.style.display="inline-flex"; wrap.style.alignItems="center"; wrap.style.gap="8px";
    if (p.codeUrl) {
      const a=document.createElement("a"); a.href=p.codeUrl; a.target="_blank"; a.rel="noopener noreferrer"; a.textContent="查看代码"; wrap.appendChild(a);
      const btn=document.createElement("button"); btn.textContent="修改"; btn.className="btn-ghost btn-xs"; btn.title="修改代码链接"; btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } else {
      const btn=document.createElement("button"); btn.textContent="添加"; btn.className="btn-ghost btn-xs"; btn.title="添加代码链接"; btn.addEventListener("click", showEdit); wrap.appendChild(btn);
    } cell.appendChild(wrap);
  };
  const showEdit=()=> {
    cell.innerHTML=""; const form=document.createElement("div"); form.style.display="inline-flex"; form.style.alignItems="center"; form.style.gap="6px";
    const input=document.createElement("input"); input.type="url"; input.placeholder="https://github.com/... 或其他链接"; input.value=p.codeUrl||""; input.className="input-sm";
    const save=document.createElement("button"); save.textContent="保存"; save.className="btn-primary btn-xxs";
    const cancel=document.createElement("button"); cancel.textContent="取消"; cancel.className="btn-xxs";
    const actions=document.createElement("div"); actions.className="edit-actions"; actions.appendChild(save); actions.appendChild(cancel);
    save.addEventListener("click", ()=>{ p.codeUrl=input.value.trim(); persist(); showView(); });
    cancel.addEventListener("click", showView);
    input.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){e.preventDefault();save.click();} else if(e.key==="Escape"){e.preventDefault();cancel.click();}});
    form.appendChild(input); form.appendChild(actions); cell.appendChild(form); setTimeout(()=>input.focus(),0);
  };
  showView();
}

/* 搜索匹配（叠加高级筛选） */
function matchQuery(p, q) {
  if (q) {
    const s = q.trim().toLowerCase(); if (s) {
      const hay = [p.title||"", p.url||"", p.difficulty||"", p.codeUrl||"", ...(p.tags||[])].join(" ").toLowerCase();
      if (!hay.includes(s)) return false;
    }
  }
  // 高级筛选
  const d = getProblemNumericDifficulty(p);
  if (filters.diffMin != null && d != null && d < filters.diffMin) return false;
  if (filters.diffMax != null && d != null && d > filters.diffMax) return false;
  if (filters.tagsAll.length) {
    const own = new Set((p.tags || []).map(t => String(t).toLowerCase()));
    for (const t of filters.tagsAll) if (!own.has(t)) return false;
  }
  if (filters.tagsAny.length) {
    const own = new Set((p.tags || []).map(t => String(t).toLowerCase()));
    let ok = false; for (const t of filters.tagsAny) { if (own.has(t)) { ok = true; break; } }
    if (!ok) return false;
  }
  if (filters.sites.size) {
    const st = siteOfProblem(p);
    if (!filters.sites.has(st)) return false;
  }
  return true;
}

/* --- Popover 工具 (修复版) --- */
let currentPopover = null;
let popoverCleanup = null; // 用于存储清理函数

function closePopover() {
  if (currentPopover) {
    currentPopover.remove();
    currentPopover = null;
  }
  // 执行清理函数（移除事件监听等）
  if (popoverCleanup) {
    popoverCleanup();
    popoverCleanup = null;
  }
}

// 重新定位函数：确保 Popover 始终跟随锚点
function updatePopoverPosition(pop, anchor) {
  if (!pop || !anchor || !anchor.isConnected) return;
  
  const rect = anchor.getBoundingClientRect();
  const popRect = pop.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  // 默认位置：按钮正下方，左对齐
  let top = rect.bottom + 6;
  let left = rect.left;

  // 垂直碰撞检测：如果下方空间不足，放上方
  if (top + popRect.height > viewportHeight - 10) {
    top = rect.top - popRect.height - 6;
  }

  // 水平碰撞检测：如果右边溢出，靠右对齐
  if (left + popRect.width > viewportWidth - 10) {
    left = Math.max(10, viewportWidth - popRect.width - 10);
  }

  pop.style.top = `${top + window.scrollY}px`; // 加上 scrollY 转换为绝对坐标
  pop.style.left = `${left + window.scrollX}px`;
}

// 通用的 Popover 切换和事件绑定逻辑
function togglePopover(anchor, builder) {
  // 如果点击的是当前已打开 Popover 的触发源，则关闭
  // 注意：右键菜单通常 anchor 为 null 或虚拟对象
  if (anchor && currentPopover && currentPopover._anchor === anchor) {
    closePopover();
    return;
  }
  
  // 先关闭已存在的（如果有）
  closePopover();

  const pop = builder();
  pop._anchor = anchor; // 标记触发源
  document.body.appendChild(pop);
  currentPopover = pop;
  if (anchor && anchor instanceof Element) anchor.classList.add("popover-trigger");

  // 如果有锚点（普通 Popover），进行定位
  if (anchor && anchor instanceof Element) {
    updatePopoverPosition(pop, anchor);
  } else {
    // 右键菜单的位置在 openContextMenuAt 中设置
  }

  // 动画
  requestAnimationFrame(() => {
    pop.classList.add("anim-enter");
  });

  // --- 事件处理 ---
  
  // 1. 全局监听 pointerdown 事件来关闭 Popover
  //    使用 pointerdown 响应更快，且 composedPath() 穿透性好，能解决大部分点击外部不关闭的问题
  const globalPointerdownHandler = (e) => {
    // 检查事件路径是否包含 Popover 自身或其锚点
    const path = e.composedPath(); // 获取事件的完整路径
    
    // 如果点击在 Popover 内部，不关闭
    if (path.includes(pop)) return;
    
    // 如果点击的是触发按钮本身（且不是右键菜单），不关闭
    if (anchor && anchor instanceof Element && path.includes(anchor)) return;

    closePopover();
  };

  // 2. 窗口尺寸改变时关闭
  const resizeHandler = () => closePopover();

  // 3. 滚动时：仅跟随，不关闭
  const scrollHandler = (e) => {
    // 如果是 Popover 内部滚动，不处理
    if (pop.contains(e.target)) return; 
    
    if (anchor && anchor instanceof Element) {
      updatePopoverPosition(pop, anchor);
    } else {
      // 如果是右键菜单（无锚点），页面滚动时通常建议关闭，避免位置错乱
      closePopover();
    }
  };

  // 延迟绑定事件，防止当前触发 Popover 的那次点击/右键立即触发关闭
  setTimeout(() => {
    document.addEventListener("pointerdown", globalPointerdownHandler, { capture: true });
    window.addEventListener("resize", resizeHandler);
    window.addEventListener("scroll", scrollHandler, { capture: true, passive: true });
  }, 10); 

  // 保存清理函数
  popoverCleanup = () => {
    document.removeEventListener("pointerdown", globalPointerdownHandler, { capture: true });
    window.removeEventListener("resize", resizeHandler);
    window.removeEventListener("scroll", scrollHandler, { capture: true });
    if (anchor && anchor instanceof Element) anchor.classList.remove("popover-trigger");
  };
}


/* 右键菜单（新增）：通用菜单 + 剪贴板 */
const CLIPBOARD_KEY = "plm:clipboard:problems";
function setClipboardProblems(problems) {
  try {
    const items = (problems || []).map(p => ({
      title: p.title || "",
      url: p.url || "",
      difficulty: p.difficulty || "",
      tags: Array.isArray(p.tags) ? [...p.tags] : [],
      codeUrl: p.codeUrl || ""
    }));
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ type: "problems", ts: Date.now(), items }));
    alert(`已复制 ${items.length} 个题目`);
  } catch {}
}
function getClipboardProblems() {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    if (!raw) return [];
    const obj = JSON.parse(raw);
    if (obj && obj.type === "problems" && Array.isArray(obj.items)) return obj.items;
    return [];
  } catch { return []; }
}
function hasClipboardProblems() { return getClipboardProblems().length > 0; }
function pasteClipboardToList(list) {
  if (!list) return;
  const clip = getClipboardProblems();
  if (!clip.length) { alert("剪贴板为空"); return; }
  const existingUrls = new Set((list.problems || []).map(x => (x.url || "").trim()).filter(Boolean));
  const news = clip
    .map(p => ({ id: uid(), title: p.title || "", url: p.url || "", difficulty: p.difficulty || "", tags: Array.isArray(p.tags) ? [...p.tags] : [], codeUrl: p.codeUrl || "" }))
    .filter(p => !p.url || !existingUrls.has(p.url.trim()));
  if (!news.length) { alert("剪贴板题目已存在于当前题单，无新增"); return; }
  list.problems = [...news, ...(list.problems || [])];
  persist(); renderProblems(); alert(`已粘贴 ${news.length} 个题目`);
}

// 辅助：构建菜单 DOM
function buildSimpleMenu(items) {
  const pop = document.createElement("div");
  pop.className = "popover";
  const menu = document.createElement("div");
  menu.className = "menu";
  for (const it of items) {
    if (it.type === "divider") {
      const hr = document.createElement("div"); hr.className = "menu-divider"; menu.appendChild(hr);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = `menu-item ${it.disabled ? 'disabled' : ''} ${it.danger ? 'danger' : ''}`;
    btn.textContent = it.text;
    if (it.disabled) btn.disabled = true;
    btn.onclick = (e) => {
      // 这里的关闭很重要，必须手动调用 closePopover
      closePopover(); 
      if (!it.disabled && it.onClick) it.onClick();
    };
    menu.appendChild(btn);
  }
  pop.appendChild(menu);
  return pop;
}

// 右键菜单入口函数（完全重写，复用 togglePopover）
function openContextMenuAt(pageX, pageY, items) {
  // 1. 关闭旧的
  closePopover();

  // 2. 构建菜单 DOM
  const pop = buildSimpleMenu(items);
  pop.classList.add("context-menu"); // 应用紧凑样式

  // 3. 复用 togglePopover 挂载并绑定全局事件
  //    注意：传入 null 作为 anchor，表示无触发元素
  togglePopover(null, () => pop);

  // 4. 手动计算并设置位置
  //    因为复用了 togglePopover，此时 pop 已经在 DOM 中了，可以获取尺寸
  
  const vw = window.innerWidth, vh = window.innerHeight;
  const sx = window.scrollX, sy = window.scrollY;
  const pad = 10;
  
  const w = pop.offsetWidth || 220; // 获取实际宽度
  const h = pop.offsetHeight || (items.length * 36);

  let left = pageX;
  let top = pageY;
  let originX = "left";
  let originY = "top";

  // 右侧溢出检测
  if (left + w > sx + vw - pad) {
    left = pageX - w;
    originX = "right";
  }
  // 底部溢出检测
  if (top + h > sy + vh - pad) {
    top = pageY - h;
    originY = "bottom";
  }
  
  // 确保不溢出左上边界
  left = Math.max(pad, left);
  top = Math.max(pad, top);

  pop.style.left = left + "px";
  pop.style.top = top + "px";
  pop.style.transformOrigin = `${originY} ${originX}`;
}

/* 标签选择 popover */
function buildTagPopover(problem, anchorEl, onChanged) {
  const pop=document.createElement("div"); pop.className="popover";
  const s1=document.createElement("div"); s1.className="pop-section";
  const h4a=document.createElement("h4"); h4a.textContent="添加新标签";
  const inputNew=document.createElement("input"); inputNew.type="text"; inputNew.placeholder="输入新标签后回车（加入未分类）"; inputNew.classList.add("input-sm");
  inputNew.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){e.preventDefault();
      const v=inputNew.value.trim(); if(!v) return;
      if(addTagToProblem(problem,v)){ onChanged(); inputNew.value=""; }
    }
  });
  s1.appendChild(h4a); s1.appendChild(inputNew); pop.appendChild(s1);
  const s2=document.createElement("div"); s2.className="pop-section";
  const h4b=document.createElement("h4"); h4b.textContent="从目录选择"; s2.appendChild(h4b);
  if (!getCategories().length) findOrCreateUncategorized();
  const owned = new Set((problem.tags||[]).map(normalizeTag));
  getCategories().forEach((c, idx)=>{
    const item=document.createElement("div"); item.className="cat-item";
    const head=document.createElement("div"); head.className="cat-head";
    head.innerHTML = `<div>${escapeHtml(c.name)}</div><div class="small">${c.tags.length} 个标签</div>`;
    const body=document.createElement("div"); body.className="cat-body";
    const tagBox=document.createElement("div"); tagBox.className="cat-tags";
    if (!c.tags.length) {
      const empty=document.createElement("div"); empty.className="small"; empty.textContent="该分类暂无标签";
      tagBox.appendChild(empty);
    } else {
      c.tags.forEach((t)=>{
        const chip=document.createElement("span"); chip.className="tag-chip"; chip.textContent=t;
        const isOwned = owned.has(normalizeTag(t));
        if (isOwned) { chip.style.opacity="0.6"; chip.style.cursor="not-allowed"; chip.title="已添加到当前题目"; }
        else { chip.title="点击添加此标签"; chip.style.cursor="pointer";
          chip.addEventListener("click",()=>{ if(addTagToProblem(problem,t)){ onChanged(); closePopover(); } });
        }
        tagBox.appendChild(chip);
      });
    }
    const addIn=document.createElement("input"); addIn.type="text"; addIn.placeholder=`在「${c.name}」新增标签后回车`; addIn.classList.add("input-sm"); addIn.style.marginTop="6px";
    addIn.addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ e.preventDefault(); const v=addIn.value.trim(); if(!v) return;
      if (addTagToCategory(c.id,v)) { addTagToProblem(problem,v); onChanged(); addIn.value=""; closePopover(); } }});
    body.appendChild(tagBox); body.appendChild(addIn);
    if (idx===0) body.classList.add("open");
    head.addEventListener("click", ()=> body.classList.toggle("open"));
    item.appendChild(head); item.appendChild(body); s2.appendChild(item);
  });
  pop.appendChild(s2); return pop;
}

/* 渲染题目表 */
function renderProblems() {
  const list=getActiveList(); const tbody=el("#problems-tbody"); const q=el("#search-input").value;
  tbody.innerHTML=""; if (!list) return;
  const filtered=(list.problems||[]).filter((p)=>matchQuery(p,q));
  if (!filtered.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const cols = (document.querySelector(".problems-table thead tr")?.children.length) || 6;
    td.colSpan = cols;
    td.textContent = "没有匹配的题目";
    td.style.color = "var(--muted)";
    td.style.padding = "24px";
    td.style.textAlign = "center";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  filtered.forEach((p)=>{
    const tr=el("#problem-row-tpl").content.firstElementChild.cloneNode(true);
    tr.classList.add("problem-row"); tr.dataset.pid=p.id;

    el(".cell-title", tr).setAttribute("data-label","标题");
    el(".cell-link", tr).setAttribute("data-label","题目链接");
    el(".cell-difficulty", tr).setAttribute("data-label","难度");
    el(".cell-tags", tr).setAttribute("data-label","标签");
    el(".cell-code", tr).setAttribute("data-label","代码链接");
    el(".cell-actions", tr).setAttribute("data-label","操作");

    // 右键菜单（题目行）
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      const listRef = getActiveList();
      const items = [
        { text: "复制题目", onClick: () => setClipboardProblems([p]) },
        { text: "粘贴到当前题单", disabled: !hasClipboardProblems(), onClick: () => pasteClipboardToList(listRef) },
        { type: "divider" },
        { text: "删除题目", onClick: () => {
            if (!confirm(`确认删除题目「${p.title||"未命名"}」？`)) return;
            const idx=listRef.problems.findIndex((x)=>x.id===p.id); if (idx>=0) listRef.problems.splice(idx,1);
            persist(); renderAll();
          }
        }
      ];
      openContextMenuAt(e.pageX, e.pageY, items);
    }, { passive: false });

    renderTitleCell(p, el(".cell-title", tr));
    renderProblemLinkCell(p, el(".cell-link", tr));
    renderDifficultyCell(p, el(".cell-difficulty", tr));

    const tagsCell=el(".cell-tags", tr); tagsCell.style.position="relative";
    const tagWrap=document.createElement("div"); tagWrap.className="tag-wrap centered";
    function renderSelectedTags() {
      tagWrap.innerHTML=""; (p.tags||[]).forEach((t,idx)=>{
        const chip=document.createElement("span"); chip.className="tag-chip"; chip.textContent=t;
        const x=document.createElement("span"); x.className="remove"; x.textContent="×"; x.title="移除标签";
        x.addEventListener("click",()=>{ p.tags.splice(idx,1); persist(); renderSelectedTags(); });
        chip.appendChild(x); tagWrap.appendChild(chip);
      });
      const addBtn=document.createElement("button"); addBtn.className="add-tag-btn"; addBtn.title="添加标签"; addBtn.textContent="+";
      addBtn.addEventListener("click",(e)=>{ e.stopPropagation(); togglePopover(addBtn,()=>buildTagPopover(p, addBtn, renderSelectedTags)); });
      tagWrap.appendChild(addBtn);
    }
    renderSelectedTags(); tagsCell.appendChild(tagWrap);

    renderCodeLinkCell(p, el(".cell-code", tr));

    const actCell=el(".cell-actions", tr); const rowActions=document.createElement("div"); rowActions.className="row-actions";
    const delBtn=document.createElement("button"); delBtn.textContent="删除"; delBtn.className="danger btn-xs";
    delBtn.addEventListener("click",()=>{
      if (!confirm(`确认删除题目「${p.title||"未命名"}」？`)) return;
      const idx=list.problems.findIndex((x)=>x.id===p.id); if (idx>=0) list.problems.splice(idx,1);
      persist(); renderAll();
    });
    rowActions.appendChild(delBtn); actCell.appendChild(rowActions);
    tbody.appendChild(tr);
  });

  const tbodyEl=el("#problems-tbody");
  const rows=Array.from(tbodyEl.querySelectorAll("tr.problem-row"));
  if (rows.length>0) {
    const listRef=list;
    enableDragSort(tbodyEl, "tr.problem-row", (from, to)=>{
      const all=listRef.problems||[];
      const visibleIds=Array.from(tbodyEl.querySelectorAll("tr.problem-row")).map(r=>r.dataset.pid).filter(Boolean);
      const movedId=visibleIds[from]; if (!movedId) return;
      const newVisible=visibleIds.slice(); newVisible.splice(from,1);
      const anchorId = to>=0 && to<newVisible.length ? newVisible[to] : null;
      const fromPosFull=all.findIndex((it)=>it.id===movedId); if (fromPosFull<0) return;
      const [movedItem]=all.splice(fromPosFull,1);
      if (anchorId) {
        const anchorPos=all.findIndex((it)=>it.id===anchorId); const insertAt=Math.max(0,anchorPos);
        all.splice(insertAt,0,movedItem);
      } else {
        const lastVisibleId=newVisible[newVisible.length-1];
        if (lastVisibleId) { const lastPos=all.findIndex((it)=>it.id===lastVisibleId); all.splice(lastPos+1,0,movedItem); }
        else all.push(movedItem);
      }
      listRef.problems=all; persist(); renderProblems();
    });
  }
}

/* DOM 工具 */
function escapeHtml(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function persist(){ saveState(state); }
function sanitizeFilename(s){ return String(s||"list").replace(/[\\/:*?"<>|]/g,"_").slice(0,60); }

/* 标签库管理面板 */
function openTagsModal(){ el("#tags-modal").classList.remove("hidden"); renderTagManager(); }
function closeTagsModal(){ el("#tags-modal").classList.add("hidden"); }
/* 标签库管理面板渲染 (重构版) */
function renderTagManager() {
  const wrap = document.querySelector("#taglib-cats");
  if (!wrap) return;
  wrap.innerHTML = "";

  const cats = getCategories() || [];
  if (!cats.length) ensureTagLibrary(state);

  cats.forEach((c) => {
    // 1. 创建卡片容器
    const card = document.createElement("div");
    card.className = "lib-cat";

    // 2. 创建头部 (标题 + 删除分类按钮)
    const head = document.createElement("div");
    head.className = "lib-cat-head";
    
    const title = document.createElement("span");
    title.className = "lib-cat-name";
    title.textContent = c.name;
    
    const delCatBtn = document.createElement("button");
    delCatBtn.className = "icon-btn danger";
    delCatBtn.title = "删除此分类";
    // SVG 图标：垃圾桶
    delCatBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a 2 2 0 0 1 2 2v2"></path></svg>';
    
    delCatBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (c.name === UNCATEGORIZED_NAME) { alert("不能删除「未分类」"); return; }
      if (!confirm(`确定删除分类「${c.name}」？内部标签将移动到未分类。`)) return;
      deleteCategory(c.id);
      renderTagManager();
      renderProblems(); // 刷新主界面可能受影响的标签
    });

    head.appendChild(title);
    head.appendChild(delCatBtn);

    // 3. 创建主体 (标签列表 + 添加栏)
    const body = document.createElement("div");
    body.className = "lib-cat-body";

    // 3.1 标签列表
    const chipList = document.createElement("div");
    chipList.className = "lib-chip-list";
    
    const tagsSafe = Array.isArray(c.tags) ? c.tags : [];
    if (tagsSafe.length === 0) {
        const empty = document.createElement("div");
        empty.style.color = "var(--muted)";
        empty.style.fontSize = "12px";
        empty.style.fontStyle = "italic";
        empty.textContent = "暂无标签";
        chipList.appendChild(empty);
    } else {
        tagsSafe.forEach((t) => {
            const chip = document.createElement("span");
            chip.className = "lib-chip";
            
            const txt = document.createElement("span");
            txt.textContent = t;
            
            const delTag = document.createElement("button");
            delTag.className = "chip-del";
            delTag.innerHTML = "×";
            delTag.title = "删除标签";
            delTag.addEventListener("click", () => {
                if (!confirm(`确定删除标签「${t}」？`)) return;
                deleteTag(c.id, t);
                renderTagManager();
                renderProblems();
            });
            
            chip.appendChild(txt);
            chip.appendChild(delTag);
            chipList.appendChild(chip);
        });
    }

    // 3.2 添加栏 (交互优化)
    const controls = document.createElement("div");
    controls.className = "lib-controls";
    
    // 默认显示 "添加" 按钮
    const initAddState = () => {
        controls.innerHTML = "";
        const addBtn = document.createElement("button");
        addBtn.className = "btn-ghost btn-xs";
        addBtn.textContent = "+ 添加标签";
        addBtn.style.width = "100%"; // 宽按钮方便点击
        addBtn.style.borderStyle = "dashed";
        
        addBtn.addEventListener("click", () => {
            controls.innerHTML = ""; // 清空按钮
            
            const wrapper = document.createElement("div");
            wrapper.style.display = "flex";
            wrapper.style.gap = "6px";
            wrapper.style.width = "100%";
            
            const input = document.createElement("input");
            input.type = "text";
            input.className = "input-sm";
            input.placeholder = "输入名称回车";
            
            // 自动聚焦
            setTimeout(() => input.focus(), 0);
            
            const confirmAdd = () => {
                const v = input.value.trim();
                if (!v) { initAddState(); return; } // 空值则还原
                if (addTagToCategory(c.id, v)) {
                    renderTagManager();
                    renderProblems();
                } else {
                    alert("添加失败：可能标签名为空或已存在");
                    input.select();
                }
            };

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") confirmAdd();
                if (e.key === "Escape") initAddState();
            });
            input.addEventListener("blur", () => {
                // 失去焦点时，如果内容为空则还原，否则不动作（防止误触）
                if(!input.value.trim()) initAddState(); 
            });
            
            wrapper.appendChild(input);
            controls.appendChild(wrapper);
        });
        controls.appendChild(addBtn);
    };
    initAddState();

    body.appendChild(chipList);
    body.appendChild(controls);

    card.appendChild(head);
    card.appendChild(body);
    wrap.appendChild(card);
  });

  // 启用拖拽排序
  enableDragSort(wrap, ".lib-cat", (from, to) => {
    const arr = state.tagLibrary.categories.slice();
    const [moved] = arr.splice(from, 1);
    const insertAt = Math.max(0, Math.min(to, arr.length));
    arr.splice(insertAt, 0, moved);
    state.tagLibrary.categories = arr;
    persist();
    renderTagManager();
    renderProblems();
  });
}

/* 随机 CF 抽题 */
const CF_CACHE_KEY="cf:problemset:v1"; const CF_CACHE_TTL_MS=1000*60*60*24;
const CF_PREF_KEYS = { includeTags: "cf:random:includeTags", ratingMin: "cf:random:ratingMin", ratingMax: "cf:random:ratingMax", tags: "cf:random:tags", count: "cf:random:count", handle: "cf:random:handle", excludeSolved: "cf:random:excludeSolved" };
function getPref(key, defVal=null) { try { const v = localStorage.getItem(key); return v === null ? defVal : v; } catch { return defVal; } }
function setPref(key, val) { try { if (val==null || val==="") localStorage.removeItem(key); else localStorage.setItem(key, String(val)); } catch {} }
function applyCFRandomPrefs() {
  const ck = el("#cf-include-tags"); const minEl = el("#cf-rating-min"); const maxEl = el("#cf-rating-max");
  const tagsEl = el("#cf-tags"); const countEl = el("#cf-count"); const handleEl = el("#cf-handle"); const exSolvedEl = el("#cf-exclude-solved");
  if (ck) ck.checked = getPref(CF_PREF_KEYS.includeTags, "1") !== "0";
  if (minEl) minEl.value = getPref(CF_PREF_KEYS.ratingMin, "") || "";
  if (maxEl) maxEl.value = getPref(CF_PREF_KEYS.ratingMax, "") || "";
  if (tagsEl) tagsEl.value = getPref(CF_PREF_KEYS.tags, "") || "";
  if (countEl) countEl.value = getPref(CF_PREF_KEYS.count, "1") || "1";
  if (handleEl) handleEl.value = getPref(CF_PREF_KEYS.handle, "") || "";
  if (exSolvedEl) exSolvedEl.checked = getPref(CF_PREF_KEYS.excludeSolved, "0") === "1";
}
function saveCFRandomPrefsFromForm() {
  const ck = el("#cf-include-tags"); const minEl = el("#cf-rating-min"); const maxEl = el("#cf-rating-max");
  const tagsEl = el("#cf-tags"); const countEl = el("#cf-count"); const handleEl = el("#cf-handle"); const exSolvedEl = el("#cf-exclude-solved");
  if (ck) setPref(CF_PREF_KEYS.includeTags, ck.checked ? "1" : "0");
  if (minEl) setPref(CF_PREF_KEYS.ratingMin, minEl.value.trim());
  if (maxEl) setPref(CF_PREF_KEYS.ratingMax, maxEl.value.trim());
  if (tagsEl) setPref(CF_PREF_KEYS.tags, tagsEl.value.trim());
  if (countEl) setPref(CF_PREF_KEYS.count, countEl.value.trim() || "1");
  if (handleEl) setPref(CF_PREF_KEYS.handle, handleEl.value.trim());
  if (exSolvedEl) setPref(CF_PREF_KEYS.excludeSolved, exSolvedEl.checked ? "1" : "0");
}
async function loadCFProblemset(force=false){
  try { const raw=localStorage.getItem(CF_CACHE_KEY);
    if (!force && raw) { const data=JSON.parse(raw); if (data && Array.isArray(data.problems) && Date.now()-(data.ts||0)<CF_CACHE_TTL_MS) return data; }
  } catch {}
  const resp=await fetch("https://codeforces.com/api/problemset.problems");
  const json=await resp.json(); if (json.status!=="OK") throw new Error("CF API 错误");
  const data={ problems: json.result.problems||[], ts: Date.now() }; localStorage.setItem(CF_CACHE_KEY, JSON.stringify(data)); return data;
}
const CF_SOLVED_CACHE_TTL_MS = 1000 * 60 * 60 * 12;
function cfSolvedCacheKey(handle){ return `cf:solved:${handle}`; }
async function loadCFSolvedSet(handle) {
  const h = String(handle || "").trim();
  if (!h) return new Set();
  try {
    const k = cfSolvedCacheKey(h);
    const cached = localStorage.getItem(k);
    if (cached) {
      const obj = JSON.parse(cached);
      if (obj && Array.isArray(obj.items) && (Date.now() - (obj.ts || 0)) < CF_SOLVED_CACHE_TTL_MS) {
        return new Set(obj.items);
      }
    }
    const resp = await fetch(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(h)}&from=1&count=100000`);
    const json = await resp.json();
    if (json.status !== "OK") throw new Error("CF user.status 错误");
    const items = [];
    for (const s of (json.result || [])) {
      if (s.verdict === "OK" && s.problem && s.problem.contestId && s.problem.index) {
        items.push(`${s.problem.contestId}:${String(s.problem.index).toUpperCase()}`);
      }
    }
    const ded = Array.from(new Set(items));
    localStorage.setItem(k, JSON.stringify({ ts: Date.now(), items: ded }));
    return new Set(ded);
  } catch (e) {
    console.warn("加载已AC题目失败", e);
    return new Set();
  }
}
async function validateCFHandle(handle) {
  const h = String(handle || "").trim();
  if (!h) return { ok: true, reason: "empty" };
  try {
    const cacheKey = "cf:handle:valid:" + h.toLowerCase();
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const obj = JSON.parse(cached);
      if (obj && Date.now() - (obj.ts || 0) < 1000 * 60 * 60) return { ok: obj.ok, reason: obj.reason || "cache" };
    }
    const resp = await fetch("https://codeforces.com/api/user.info?handles=" + encodeURIComponent(h));
    const json = await resp.json();
    const ok = json.status === "OK" && Array.isArray(json.result) && json.result.length > 0;
    const out = { ok, reason: ok ? "ok" : "not_found" };
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), ...out }));
    return out;
  } catch {
    return { ok: false, reason: "network" };
  }
}
function pickRandomCF(problems, { ratingMin, ratingMax, tags, count, requireRated = false, excludeSolved = false, solvedSet = null }) {
  let pool=problems.filter((p)=>{
    const r=typeof p.rating==="number"?p.rating:null;
    if (requireRated && r == null) return false;
    if (ratingMin!=null && r!=null && r<ratingMin) return false;
    if (ratingMax!=null && r!=null && r>ratingMax) return false;
    if ((p.tags || []).some(tag => tag === "*special")) return false;
    if (tags && tags.length){ const own=new Set((p.tags||[]).map(t=>t.toLowerCase())); for (const t of tags){ if(!own.has(t)) return false; } }

    if (excludeSolved && solvedSet && solvedSet.size) {
      const key = `${p.contestId}:${String(p.index).toUpperCase()}`;
      if (solvedSet.has(key)) return false;
    }
    return true;
  });
  if (!pool.length) return [];
  for (let i=pool.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [pool[i],pool[j]]=[pool[j],pool[i]]; }
  return pool.slice(0, Math.max(1, Math.min(count||1, 10)));
}
function cfProblemToAppItem(p, includeTags=true){
  const url = `https://codeforces.com/contest/${p.contestId}/problem/${p.index}`;
  const title = parseShortTitle(url) || `CF${p.contestId}${String(p.index).toUpperCase()}`;
  const tags = includeTags ? (p.tags||[]).map(t=>t) : [];
  const difficulty = typeof p.rating==="number" ? String(p.rating) : "";
  return { id: uid(), title, url, difficulty, tags, codeUrl: "" };
}
function openCFRandomModal(){ el("#cf-random-modal").classList.remove("hidden"); }
function closeCFRandomModal(){ el("#cf-random-modal").classList.add("hidden"); }

/* “更多”菜单 */
function initMoreMenu() {
  const $ = (s, r=document) => r.querySelector(s);
  const clickSel = (s) => { const n = $(s); if (n) n.click(); };

  function buildMenu(items) {
    const pop = document.createElement("div");
    pop.className = "popover";
    const menu = document.createElement("div");
    menu.className = "menu";
    for (const it of items) {
      if (it.type === "divider") { const hr = document.createElement("div"); hr.className = "menu-divider"; menu.appendChild(hr); continue; }
      const btn = document.createElement("button");
      btn.className = "menu-item";
      btn.textContent = it.text;
      if (it.disabled) btn.disabled = true;
      btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); try { it.onClick?.(); } finally { closePopover(); } });
      menu.appendChild(btn);
    }
    pop.appendChild(menu);
    return pop;
  }

  const toolbarMore = el("#toolbar-more-btn");
  if (toolbarMore) {
    toolbarMore.addEventListener("click", (e) => {
      e.preventDefault();
      const items = [
        { text: "标签库", onClick: () => clickSel("#manage-tags-btn") },
        { text: "导出题单", onClick: () => clickSel("#export-list-btn") },
        { text: "导入题单", onClick: () => clickSel("#import-list-input") },
        { type: "divider" },
        { text: "上传云端", onClick: runSyncUpload, disabled: !authUser },
        { text: "下载云端", onClick: runSyncDownload, disabled: !authUser },
        { type: "divider" },
        { text: "导出全部数据", onClick: () => clickSel("#export-btn") },
        { text: "导入全部数据", onClick: () => clickSel("#import-input") },
      ];
      togglePopover(toolbarMore, () => buildMenu(items));
    });
  }
}

/* 手动同步（抽成可调用函数，菜单可直接调用） */
function setSyncStatus(t) { const n = el("#sync-status"); if (n) n.textContent = t || ""; }

async function runSyncUpload() {
  if (!supa || !authUser) { openAuthModal(); alert("请先登录账号，再执行上传。"); return; }
  const upBtn = el("#sync-upload-btn");
  const downBtn = el("#sync-download-btn");
  try {
    if (upBtn) upBtn.disabled = true;
    if (downBtn) downBtn.disabled = true;
    setSyncStatus("上传中...");
    const { ok, error } = await saveRemoteState();
    if (!ok) { console.error(error); setSyncStatus("上传失败"); alert("上传失败：" + (error?.message || "未知错误")); }
    else { setSyncStatus("已上传"); setTimeout(()=>setSyncStatus(""), 1500); }
  } finally {
    if (upBtn) upBtn.disabled = !authUser;
    if (downBtn) downBtn.disabled = !authUser;
  }
}
async function runSyncDownload() {
  if (!supa || !authUser) { openAuthModal(); alert("请先登录账号，再执行下载。"); return; }
  const upBtn = el("#sync-upload-btn");
  const downBtn = el("#sync-download-btn");
  try {
    if (upBtn) upBtn.disabled = true;
    if (downBtn) downBtn.disabled = true;
    setSyncStatus("下载中...");
    const remote = await loadRemoteState();
    if (!remote) {
      setSyncStatus("云端为空"); setTimeout(()=>setSyncStatus(""), 1500);
      alert("云端暂无数据。可先在本设备点“上传云端”。");
      return;
    }
    migrateState(remote); state = remote; saveState(state); renderAll();
    setSyncStatus("已下载"); setTimeout(()=>setSyncStatus(""), 1500);
  } catch (e) {
    console.error(e); setSyncStatus("下载失败"); alert("下载失败：" + (e?.message || "未知错误"));
  } finally {
    if (upBtn) upBtn.disabled = !authUser;
    if (downBtn) downBtn.disabled = !authUser;
  }
}

/* SW 定期更新：自动检查 + 可视提示 + 一键更新 */
function initAutoUpdater() {
  if (!('serviceWorker' in navigator)) return;

  const banner = el("#update-banner");
  const reloadBtn = el("#update-reload-btn");
  const dismissBtn = el("#update-dismiss-btn");
  let newWorker = null;
  let refreshing = false;

  function showBanner() { if (banner) banner.classList.remove("hidden"); }
  function hideBanner() { if (banner) banner.classList.add("hidden"); }

  navigator.serviceWorker.getRegistration().then((reg) => {
    if (!reg) return;

    // 检测新 SW 安装完成但等待中
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          newWorker = installing;
          showBanner();
        }
      });
    });

    // 初始检查一次
    reg.update().catch(()=>{});

    // 定时检查
    setInterval(() => { reg.update().catch(()=>{}); }, UPDATE_CHECK_INTERVAL_MS);

    // 页面重新可见时也检查
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(()=>{});
    });

    // 一键更新：要求等待中的 SW 立即激活
    const requestSkipWaiting = () => {
      const waiting = reg.waiting || newWorker;
      if (waiting) waiting.postMessage({ type: "SKIP_WAITING" });
    };

    if (reloadBtn) reloadBtn.addEventListener("click", () => { requestSkipWaiting(); });
    if (dismissBtn) dismissBtn.addEventListener("click", () => hideBanner());

    // 新 SW 接管后刷新一次
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }).catch(()=>{});
}

/* 事件绑定 */
function bindEvents(){
  el("#add-list-btn").addEventListener("click", ()=>{
    const name=prompt("输入新题单名称：","未命名题单"); if(name===null) return;
    const list={ id: uid(), name: String(name).trim()||"未命名题单", problems: [] };
    state.lists.unshift(list); state.activeListId=list.id; persist(); renderAll();
  });
  el("#rename-list-btn").addEventListener("click", ()=>{
    const list=getActiveList(); if(!list) return;
    const name=el("#list-name-input").value.trim(); list.name=name||"未命名题单"; persist(); renderLists(); renderToolbar();
  });

  const nameInput = el("#list-name-input");
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } });
    nameInput.addEventListener("blur", () => {
      const list=getActiveList(); if(!list) return;
      const name=nameInput.value.trim(); list.name=name||"未命名题单"; persist(); renderLists();
    });
  }

  el("#delete-list-btn").addEventListener("click", ()=>{
    const list=getActiveList(); if(!list) return;
    if(!confirm(`确认删除题单「${list.name}」及其全部题目？`)) return;
    state.lists=state.lists.filter((l)=>l.id!==list.id); state.activeListId=state.lists[0]?.id||null;
    if(!state.lists.length) state=createDefaultState(); persist(); renderAll();
  });

  el("#search-input")?.addEventListener("input", ()=>{ renderProblems(); });

  el("#add-problem-btn").addEventListener("click", ()=>{
    const list=getActiveList(); if(!list) return;
    list.problems.unshift({ id: uid(), title:"", url:"", difficulty:"", tags:[], codeUrl:"" });
    persist(); renderProblems();
  });

  // 导出/导入全部
  el("#export-btn")?.addEventListener("click", ()=>{
    const dataStr="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(state,null,2));
    const a=document.createElement("a"); a.href=dataStr; const date=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download=`problem-lists-all-${date}.json`; a.click();
  });
  el("#import-input")?.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    try { const txt=await f.text(); const data=JSON.parse(txt);
      if(!data || !Array.isArray(data.lists)) { alert("导入失败：格式不正确"); return; }
      migrateState(data); state=data; if(!state.activeListId && state.lists[0]) state.activeListId=state.lists[0].id;
      persist(); renderAll(); e.target.value=""; alert("导入成功");
    } catch(err){ console.error(err); alert("导入失败：解析错误"); }
  });

  // 导出/导入题单
  el("#export-list-btn")?.addEventListener("click", ()=>{
    const list=getActiveList(); if(!list){ alert("没有可导出的题单"); return; }
    const payload={ name:list.name, problems:list.problems||[] };
    const dataStr="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(payload,null,2));
    const a=document.createElement("a"); a.href=dataStr; const date=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download=`problem-list-${sanitizeFilename(list.name)}-${date}.json`; a.click();
  });
  el("#import-list-input")?.addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    try { const txt=await f.text(); const data=JSON.parse(txt);
      if(!data || !Array.isArray(data.problems)) { alert("导入失败：格式不正确（应包含 name 和 problems）"); return; }
      const newList={ id: uid(), name: String(data.name||"导入的题单"), problems: (data.problems||[]).map((p)=>({
        id: uid(), title: p.title||"", url:p.url||"", difficulty:p.difficulty||"", tags:Array.isArray(p.tags)?dedup(p.tags):[], codeUrl:p.codeUrl||""
      })) };
      const allTags=dedup(newList.problems.flatMap((p)=>p.tags||[]));
      if(allTags.length){ const unc=findOrCreateUncategorized(); const norm=new Set((unc.tags||[]).map(normalizeTag));
        allTags.forEach((t)=>{ if(!norm.has(normalizeTag(t))) unc.tags.push(t); }); unc.tags.sort(byNameAsc);
      }
      state.lists.unshift(newList); state.activeListId=newList.id; persist(); renderAll(); e.target.value=""; alert("导入题单成功");
    } catch(err){ console.error(err); alert("导入失败：解析错误"); }
  });

  // 标签库
  el("#manage-tags-btn")?.addEventListener("click", openTagsModal);
  el("#tags-modal-close")?.addEventListener("click", closeTagsModal);
  el("#new-cat-input")?.addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); const v=el("#new-cat-input").value.trim(); if(!v) return;
      if(!addCategory(v)) { alert("创建失败：名称为空/重复/为未分类"); return; }
      el("#new-cat-input").value=""; renderTagManager(); renderProblems();
    }
  });

// 窄屏侧栏抽屉 + 手势
  const sidebar = el(".sidebar");
  const sidebarBackdrop = el("#sidebar-backdrop");
  const edgeOpen = el("#sidebar-edge-open");

  if (sidebar && sidebarBackdrop) {
    const openSidebar = () => { if (window.innerWidth > 400) return; sidebar.classList.add("open"); sidebarBackdrop.classList.add("show"); };
    const closeSidebar = () => { sidebar.classList.remove("open"); sidebarBackdrop.classList.remove("show"); };

    if (edgeOpen) {
    const onToggle = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDesktop()) {
        // 宽屏：切折叠
        if (isSidebarCollapsed()) expandSidebarDesktop(
          (w) => document.documentElement.style.setProperty("--sidebar-w", `${w}px`),
          (w) => Math.max(240, Math.min(Math.max(240, Math.min(600, Math.floor(window.innerWidth * 0.6))), w)) // clampW inline
        );
        else collapseSidebarDesktop(
          () => {
            // getCurrentW inline
            const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10);
            return Number.isFinite(v) ? v : Math.round(el(".sidebar").getBoundingClientRect().width);
          },
          (w) => { try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch {} }
        );
      } else {
        // 窄屏：切抽屉
        const openSidebar = () => { if (window.innerWidth > 900) return; sidebar.classList.add("open"); sidebarBackdrop.classList.add("show"); };
        const closeSidebar = () => { sidebar.classList.remove("open"); sidebarBackdrop.classList.remove("show"); };
        if (sidebar.classList.contains("open")) closeSidebar(); else openSidebar();
      }
    };
    edgeOpen.addEventListener("click", onToggle);
    edgeOpen.addEventListener("touchend", onToggle, { passive: false });
  }

    sidebarBackdrop.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeSidebar(); });
    window.addEventListener("resize", () => { if (window.innerWidth > 900) closeSidebar(); });

    // 题目范围内（.table-wrap）右滑打开 / 左滑关闭（仅窄屏）
    const contentArea = el(".table-wrap"); // 若想整个主区域可触发，可改为 el(".main")
    if (contentArea) {
      let startX = 0, startY = 0, startTs = 0, tracking = false, intent = null; // intent: "open" | "close"

      const OPEN_THRESHOLD = 50;     // 常规右滑打开距离
      const CLOSE_THRESHOLD = 50;    // 常规左滑关闭距离
      const FAST_PX = 120;           // 快速滑动距离
      const FAST_MS = 250;           // 快速滑动时间阈值
      const MAX_ANGLE = 28;          // 与水平夹角上限（越小越“更水平”）

      const isNarrow = () => window.innerWidth <= 900;
      const isInteractive = (target) =>
        !!target.closest('input, textarea, select, button, a, [contenteditable="true"], .popover, .modal');

      contentArea.addEventListener("touchstart", (e) => {
        if (!isNarrow()) return;
        if (isInteractive(e.target)) return;

        const t = e.touches[0];
        startX = t.clientX; startY = t.clientY; startTs = Date.now();
        // 未打开 → 右滑打开；已打开 → 左滑关闭
        intent = sidebar.classList.contains("open") ? "close" : "open";
        tracking = true;
      }, { passive: true });

      contentArea.addEventListener("touchmove", (e) => {
        if (!tracking) return;

        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        const angle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;

        // 水平方向时，阻止页面纵向滚动
        if ((intent === "open" && dx > 0 && angle < MAX_ANGLE) ||
            (intent === "close" && dx < 0 && angle < MAX_ANGLE)) {
          e.preventDefault();
        }
      }, { passive: false });

      contentArea.addEventListener("touchend", (e) => {
        if (!tracking) return;
        tracking = false;

        const t = e.changedTouches[0];
        const dx = t.clientX - startX;
        const dy = Math.abs(t.clientY - startY);
        const angle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
        const dt = Date.now() - startTs;

        const normalOpen  = (dx >=  OPEN_THRESHOLD) && angle < MAX_ANGLE;
        const fastOpen    = (dx >=  FAST_PX)       && (dt <= FAST_MS) && angle < MAX_ANGLE;
        const normalClose = (dx <= -CLOSE_THRESHOLD) && angle < MAX_ANGLE;
        const fastClose   = (dx <= -FAST_PX)         && (dt <= FAST_MS) && angle < MAX_ANGLE;

        if (intent === "open" && !sidebar.classList.contains("open") && (normalOpen || fastOpen)) {
          openSidebar();
        } else if (intent === "close" && sidebar.classList.contains("open") && (normalClose || fastClose)) {
          closeSidebar();
        }
      }, { passive: true });
    }

    // 全局左滑关闭（任意位置触发；仅窄屏且侧栏已打开时）
    (() => {
      let sx = 0, sy = 0, ts = 0, trk = false;

      const onTouchStart = (e) => {
        if (window.innerWidth > 900) return;
        if (!sidebar.classList.contains("open")) return;
        if (e.touches.length > 1) return; // 忽略多指
        const t = e.touches[0];
        sx = t.clientX;
        sy = t.clientY;
        ts = Date.now();
        trk = true;
      };

      const onTouchMove = (e) => {
        if (!trk) return;
        const t = e.touches[0];
        const dx = t.clientX - sx;
        const dy = Math.abs(t.clientY - sy);
        const angle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
        if (dx < 0 && angle < 28) e.preventDefault(); // 水平左划时阻止滚动
      };

      const onTouchEnd = (e) => {
        if (!trk) return;
        trk = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx;
        const dy = Math.abs(t.clientY - sy);
        const angle = Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
        const dt = Date.now() - ts;

        const normalClose = (dx <= -50) && angle < 28;
        const fastClose   = (dx <= -120) && (dt <= 250) && angle < 28;

        if (sidebar.classList.contains("open") && (normalClose || fastClose)) {
          closeSidebar();
        }
      };

      // 用捕获阶段确保能先于页面其他元素拿到事件；move 需 passive: false 才能 preventDefault
      window.addEventListener("touchstart", onTouchStart, { passive: true,  capture: true });
      window.addEventListener("touchmove",  onTouchMove,  { passive: false, capture: true });
      window.addEventListener("touchend",   onTouchEnd,   { passive: true,  capture: true });
    })();

  
    // 题目区域空白处右键：粘贴题目到当前题单
    const tableWrap = el(".table-wrap");
    if (tableWrap) {
      tableWrap.addEventListener("contextmenu", (e) => {
        // 跳过：已在题目行/弹层/交互控件上的右键，由各自处理
        if (e.target.closest("tr.problem-row, .menu, .popover, input, textarea, select, button, a, [contenteditable]")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();

        const list = getActiveList();
        if (!list) return;

        const items = [
          { text: "粘贴题目到当前题单", disabled: !hasClipboardProblems(), onClick: () => pasteClipboardToList(list) },
        ];
        openContextMenuAt(e.pageX, e.pageY, items); // 复用已有的右键菜单弹出
      }, { passive: false });
    }

    // 全局右键：非操作区禁用浏览器自带菜单
    document.addEventListener("contextmenu", (e) => {
      const t = e.target;

      // 允许的操作区：输入/编辑类，或显式标记了 .allow-browser-menu 的区域
      const inAllowed =
        t.closest('input, textarea, select, [contenteditable="true"], .allow-browser-menu');

      if (inAllowed) return; // 放行浏览器菜单（复制/粘贴等）

      // 其他区域禁用浏览器菜单（使用我们自己的右键菜单逻辑）
      e.preventDefault();
    }, { capture: true });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && window.innerWidth <= 900 && sidebar.classList.contains("open")) closeSidebar();
    });
  }

  // 随机 CF 抽题
  const cfBtn=el("#cf-random-btn"), cfModal=el("#cf-random-modal");
  if (cfBtn && cfModal) {
    const cfCloseTop = el("#cf-random-close");
    if (cfCloseTop) cfCloseTop.addEventListener("click", closeCFRandomModal);

    cfBtn.addEventListener("click", () => {
      applyCFRandomPrefs();
      const handleEl = el("#cf-handle");
      const handleMsg = el("#cf-handle-msg");
      if (handleEl && handleMsg) {
        let timer = 0;
        const showMsg = (st) => {
          handleMsg.className = "small";
          if (!handleEl.value.trim()) { handleMsg.textContent = ""; return; }
          handleMsg.textContent = st.ok ? "账号有效" : (st.reason === "not_found" ? "账号不存在" : "网络错误，稍后重试");
        };
        const runCheck = async () => { const st = await validateCFHandle(handleEl.value); showMsg(st); };
        handleEl.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runCheck, 350); }, { once: true });
        handleEl.addEventListener("blur", runCheck, { once: true });
      }
      openCFRandomModal();
    });

    els("#cf-presets .preset-chip").forEach((chip)=>{
      chip.addEventListener("click", ()=>{
        const min=chip.getAttribute("data-min"), max=chip.getAttribute("data-max");
        const minEl = el("#cf-rating-min"); const maxEl = el("#cf-rating-max");
        if (minEl) { minEl.value = min || ""; setPref("cf:random:ratingMin", minEl.value.trim()); }
        if (maxEl) { maxEl.value = max || ""; setPref("cf:random:ratingMax", maxEl.value.trim()); }
      });
    });

    els(".spin-mini").forEach((btn)=>{
      btn.addEventListener("click", ()=>{
        const sel=btn.getAttribute("data-target"), dir=btn.getAttribute("data-dir");
        const input=el(sel); if(!input) return; const step=Number(input.step||100) || 100;
        let v = Number(input.value); if (!Number.isFinite(v)) v=0;
        v = Math.round(v/step)*step + (dir==="up" ? step : -step);
        input.value=String(v);
        input.dispatchEvent(new Event("change",{bubbles:true}));
      });
    });

    const minEl = el("#cf-rating-min");
    const maxEl = el("#cf-rating-max");
    const tagsEl = el("#cf-tags");
    const countEl = el("#cf-count");
    const handleEl = el("#cf-handle");
    const exSolvedEl = el("#cf-exclude-solved");
    if (minEl) minEl.addEventListener("change", () => setPref(CF_PREF_KEYS.ratingMin, minEl.value.trim()));
    if (maxEl) maxEl.addEventListener("change", () => setPref(CF_PREF_KEYS.ratingMax, maxEl.value.trim()));
    if (tagsEl) tagsEl.addEventListener("change", () => setPref(CF_PREF_KEYS.tags, tagsEl.value.trim()));
    if (countEl) countEl.addEventListener("change", () => {
      const c = Math.max(1, Math.min(10, Number(countEl.value)||1));
      countEl.value = String(c);
      setPref(CF_PREF_KEYS.count, countEl.value);
    });
    if (handleEl) handleEl.addEventListener("change", () => setPref(CF_PREF_KEYS.handle, handleEl.value.trim()));
    if (exSolvedEl) exSolvedEl.addEventListener("change", () => setPref(CF_PREF_KEYS.excludeSolved, exSolvedEl.checked ? "1" : "0"));

    // app.js - 找到 el("#cf-random-run") 的事件监听器

el("#cf-random-run").addEventListener("click", async (event) => {
  // 获取按钮元素
  const runButton = event.currentTarget;
  if (!runButton) return;

  // 1. 启动加载状态
  runButton.classList.add("btn-loading");
  // 保存原始文本
  const originalText = runButton.textContent;
  runButton.textContent = "抽取中..."; // 也可以保留为空

  try {
    // -----------------------------------------------------
    // 这里是你原有的所有抽题逻辑，保持不变
    // -----------------------------------------------------
    saveCFRandomPrefsFromForm();
    const list = getActiveList();
    if (!list) {
      alert("请先创建或选择一个题单");
      return; // 记得在出错时 return，以便进入 finally 块
    }
    const ratingMinRaw = el("#cf-rating-min").value.trim();
    const ratingMaxRaw = el("#cf-rating-max").value.trim();
    const tagsRaw = el("#cf-tags").value.trim();
    const countRaw = el("#cf-count").value.trim();
    const includeTags = !!el("#cf-include-tags").checked;
    const handle = (el("#cf-handle")?.value || "").trim();
    const excludeSolved = !!el("#cf-exclude-solved")?.checked;

    if (excludeSolved) {
      if (!handle) {
        alert("已勾选“排除已AC”，请填写 CF 账号");
        return;
      }
      const st = await validateCFHandle(handle);
      if (!st.ok) {
        alert(st.reason === "not_found" ? "CF 账号不存在，请检查" : "网络错误，稍后再试");
        return;
      }
    }

    const ratingMin = ratingMinRaw ? Number(ratingMinRaw) : null;
    const ratingMax = ratingMaxRaw ? Number(ratingMaxRaw) : null;
    const requireRated = (ratingMin != null || ratingMax != null);
    const tags = tagsRaw ? tagsRaw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
    const count = countRaw ? Number(countRaw) : 1;

    // 模拟网络延迟，方便观察加载动画 (正式版可删除)
    // await new Promise(resolve => setTimeout(resolve, 1500));

    const { problems } = await loadCFProblemset(false);
    let solvedSet = null;
    if (excludeSolved && handle) {
      solvedSet = await loadCFSolvedSet(handle);
    }
    
    const picked = pickRandomCF(problems, { ratingMin, ratingMax, tags, count, requireRated, excludeSolved, solvedSet });
    if (!picked.length) {
      alert("没有匹配的题目，请调整筛选条件");
      return;
    }

    const items = picked.map(p => cfProblemToAppItem(p, includeTags));
    const existingUrls = new Set((list.problems || []).map(x => (x.url || "").trim()));
    const deduped = items.filter(x => x.url && !existingUrls.has(x.url.trim()));
    
    if (!deduped.length) {
      alert("匹配题目已存在于当前题单，无新增");
      return;
    }

    list.problems = [...deduped, ...(list.problems || [])];
    persist();
    renderProblems();
    closeCFRandomModal();
    alert(`已加入 ${deduped.length} 道题`);

  } catch (err) {
    console.error("抽题失败:", err);
    alert("抽题失败：网络错误或 CF API 异常，请稍后再试。");
  } finally {
    // 2. 无论成功或失败，都恢复按钮状态
    if (runButton) {
      runButton.classList.remove("btn-loading");
      runButton.textContent = originalText;
    }
  }
});

  }

  /* 登录 UI */
  const loginBtn = el("#login-btn");
  const logoutBtn = el("#logout-btn");
  const authClose = el("#auth-close");
  const authLogin = el("#auth-login");
  const authSignup = el("#auth-signup");
  const emailInput = el("#auth-email");
  const passInput = el("#auth-password");
  const msgEl = el("#auth-msg");

  const setMsg = (t, isErr=false) => { if (!msgEl) return; msgEl.textContent = t || ""; msgEl.style.color = isErr ? "var(--danger)" : "var(--muted)"; };

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      const sidebar = el(".sidebar"); const backdrop = el("#sidebar-backdrop");
      if (sidebar && backdrop && window.innerWidth <= 900 && sidebar.classList.contains("open")) { sidebar.classList.remove("open"); backdrop.classList.remove("show"); }
      openAuthModal();
    });
  }
  if (logoutBtn) logoutBtn.addEventListener("click", async () => { try { await supa?.auth?.signOut(); } catch {} });

  if (authClose) authClose.addEventListener("click", closeAuthModal);

  const doLogin = async () => {
    try {
      setMsg("登录中...");
      const email = (emailInput?.value || "").trim();
      const password = passInput?.value || "";
      if (!email || !password) { setMsg("请输入邮箱和密码", true); return; }
      const { error } = await supa.auth.signInWithPassword({ email, password });
      if (error) { setMsg(error.message || "登录失败", true); return; }
      setMsg(""); closeAuthModal();
    } catch { setMsg("网络错误", true); }
  };
  const doSignup = async () => {
    try {
      setMsg("注册中...");
      const email = (emailInput?.value || "").trim();
      const password = passInput?.value || "";
      if (!email || !password) { setMsg("请输入邮箱和密码", true); return; }
      const { data, error } = await supa.auth.signUp({ email, password });
      if (error) { setMsg(error.message || "注册失败", true); return; }
      if (!data.session) setMsg("注册成功。若开启邮箱验证，请前往邮箱验证后再登录。");
      else { setMsg(""); closeAuthModal(); }
    } catch { setMsg("网络错误", true); }
  };

  if (authLogin) authLogin.addEventListener("click", doLogin);
  if (authSignup) authSignup.addEventListener("click", doSignup);
  if (passInput) passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

  // OAuth
  const oauthGithub = el("#oauth-github");
  const oauthGoogle = el("#oauth-google");
  const startOAuth = async (provider) => {
    if (!supa) { alert("未配置 Supabase，无法登录。"); return; }
    try {
      const redirectTo = getRedirectTo();
      await supa.auth.signInWithOAuth({ provider, options: { redirectTo } });
    } catch (e) {
      setMsg("第三方登录失败", true);
      console.error(e);
    }
  };
  if (oauthGithub) oauthGithub.addEventListener("click", () => startOAuth("github"));
  if (oauthGoogle) oauthGoogle.addEventListener("click", () => startOAuth("google"));

  // 上传/下载按钮（供隐藏按钮和菜单共用）
  const upBtn = el("#sync-upload-btn");
  const downBtn = el("#sync-download-btn");
  if (upBtn) upBtn.addEventListener("click", runSyncUpload);
  if (downBtn) downBtn.addEventListener("click", runSyncDownload);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePopover(); closeTagsModal(); closeCFRandomModal(); closeAuthModal(); }
  });

  // 高级筛选（按钮/面板）
  el("#advanced-filter-btn")?.addEventListener("click", () => {
    el("#f-diff-min").value = filters.diffMin ?? "";
    el("#f-diff-max").value = filters.diffMax ?? "";
    el("#f-tags-all").value = (filters.tagsAll || []).join(", ");
    el("#f-tags-any").value = (filters.tagsAny || []).join(", ");
    el("#f-site-cf").checked = filters.sites.has("cf");
    el("#f-site-at").checked = filters.sites.has("at");
    el("#f-site-luogu").checked = filters.sites.has("luogu");
    el("#f-site-other").checked = filters.sites.has("other");
    el("#filter-modal").classList.remove("hidden");
  });
  el("#filter-close")?.addEventListener("click", () => el("#filter-modal").classList.add("hidden"));
  el("#filter-reset")?.addEventListener("click", () => {
    filters.diffMin = null; filters.diffMax = null;
    filters.tagsAll = []; filters.tagsAny = [];
    filters.sites = new Set();
    el("#filter-modal").classList.add("hidden");
    renderProblems();
  });
  el("#filter-apply")?.addEventListener("click", () => {
    const minRaw = el("#f-diff-min").value.trim();
    const maxRaw = el("#f-diff-max").value.trim();
    filters.diffMin = (minRaw === "") ? null : (Number.isFinite(Number(minRaw)) ? Number(minRaw) : null);
    filters.diffMax = (maxRaw === "") ? null : (Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : null);
    filters.tagsAll = parseTagsInput(el("#f-tags-all").value);
    filters.tagsAny = parseTagsInput(el("#f-tags-any").value);
    const s = new Set();
    if (el("#f-site-cf").checked) s.add("cf");
    if (el("#f-site-at").checked) s.add("at");
    if (el("#f-site-luogu").checked) s.add("luogu");
    if (el("#f-site-other").checked) s.add("other");
    filters.sites = s;
    el("#filter-modal").classList.add("hidden");
    renderProblems();
  });
}

function isDesktop() { return window.innerWidth > 900; }

function isSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1"; } catch { return false; }
}

function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    document.documentElement.setAttribute("data-sidebar", "collapsed");
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1"); } catch {}
  } else {
    document.documentElement.removeAttribute("data-sidebar");
    try { localStorage.removeItem(SIDEBAR_COLLAPSED_KEY); } catch {}
  }
}

function collapseSidebarDesktop(getCurrentW, saveW) {
  // 记住当前宽度，方便恢复
  const lastW = typeof getCurrentW === "function" ? getCurrentW() : 280;
  try { localStorage.setItem(SIDEBAR_W_KEY, String(lastW)); } catch {}
  setSidebarCollapsed(true);
}

function expandSidebarDesktop(applyW, clampW) {
  let w = 280;
  try {
    const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || "", 10);
    if (Number.isFinite(saved)) w = saved;
  } catch {}
  const ww = typeof clampW === "function" ? clampW(w) : w;
  if (typeof applyW === "function") applyW(ww);
  setSidebarCollapsed(false);
}

function applyCollapsedOnLoad(applyW, clampW) {
  if (!isDesktop()) return;
  if (isSidebarCollapsed()) {
    // 折叠态下无需设置宽度变量（布局用 CSS 覆盖），但展开时需要宽度可恢复
    setSidebarCollapsed(true);
  } else {
    // 非折叠时，照常用上次宽度
    try {
      const saved = parseInt(localStorage.getItem(SIDEBAR_W_KEY) || "", 10);
      if (Number.isFinite(saved) && typeof applyW === "function") applyW(clampW ? clampW(saved) : saved);
    } catch {}
  }
}

/* 侧栏可拖拽调宽 */
function setupSidebarResizer() {
  const handle = el("#sidebar-resizer");
  const sidebar = el(".sidebar");
  if (!handle || !sidebar) return;

  const MIN_W = 240;
  const getMaxW = () => Math.max(MIN_W, Math.min(600, Math.floor(window.innerWidth * 0.6)));
  const applyW = (w) => document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
  const saveW = (w) => { try { localStorage.setItem(SIDEBAR_W_KEY, String(w)); } catch {} };
  const getCurrentW = () => {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10);
    return Number.isFinite(v) ? v : Math.round(sidebar.getBoundingClientRect().width);
  };
  const clampW = (w) => Math.max(MIN_W, Math.min(getMaxW(), w));

  // 初始化时应用折叠/宽度
  applyCollapsedOnLoad(applyW, clampW);

  let active = false, startX = 0, startW = 0, lastRawW = 0;

  const onMove = (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    lastRawW = startW + dx; // 未夹紧的原始宽度
    const w = clampW(lastRawW);
    // 若当前是折叠态，拖动不生效（隐藏了柄）；仅在宽屏且可见时才会进入此逻辑
    if (!isSidebarCollapsed()) applyW(w);
  };

  const onUp = () => {
    if (!active) return;
    active = false;
    document.body.classList.remove("resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);

    // 宽屏：在“极左”并且用户明显继续往左拖时，触发折叠
    // 阈值：小于最小宽度 MIN_W 再额外 60px 的意图
    if (isDesktop() && lastRawW < (MIN_W * 0.2)) {
      collapseSidebarDesktop(getCurrentW, saveW);
      return;
    }

    // 否则保存当前宽度
    const w = getCurrentW();
    saveW(clampW(w));
  };

  handle.addEventListener("pointerdown", (e) => {
    if (!isDesktop()) return; // 窄屏不允许拖栏宽度
    if (isSidebarCollapsed()) return; // 折叠态无效
    e.preventDefault();
    active = true; startX = e.clientX; startW = sidebar.getBoundingClientRect().width; lastRawW = startW;
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  window.addEventListener("resize", () => {
    if (!isDesktop()) return;
    if (isSidebarCollapsed()) return; // 折叠态下保持 0 列布局
    const w = clampW(getCurrentW());
    applyW(w); saveW(w);
  });
}


/* 渲染：侧栏与工具栏 */
function renderLists() {
  const wrap = el("#lists"); wrap.innerHTML = "";
  state.lists.forEach((l) => {
    const div = document.createElement("div");
    div.className = "list-item" + (l.id === state.activeListId ? " active" : "");
    div.dataset.listId = l.id;
    div.innerHTML = `<div class="name">${escapeHtml(l.name || "未命名题单")}</div><div class="meta">${(l.problems||[]).length} 道题</div>`;

    // 左键切换题单
    div.addEventListener("click", () => { state.activeListId = l.id; persist(); renderAll(); });
    // 右键菜单（题单）
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      const listObj = state.lists.find(x => x.id === l.id);
      const items = [
        { text: "复制此题单的题目", onClick: () => setClipboardProblems(listObj?.problems || []) },
        { text: "粘贴题目到此题单", disabled: !hasClipboardProblems(), onClick: () => pasteClipboardToList(listObj) },
        { type: "divider" },
        { text: "删除题单", onClick: () => {
            if (!confirm(`确认删除题单「${l.name || "未命名题单"}」及其全部题目？`)) return;
            state.lists = state.lists.filter(x => x.id !== l.id);
            if (!state.lists.length) state = createDefaultState();
            if (state.activeListId === l.id) state.activeListId = state.lists[0]?.id || null;
            persist(); renderAll();
          }
        }
      ];
      openContextMenuAt(e.pageX, e.pageY, items);
    }, { passive: false });

    wrap.appendChild(div);
  });
  enableDragSort(wrap, ".list-item", (from, to) => {
    const arr = state.lists.slice(); const [moved]=arr.splice(from,1); const insertAt=Math.max(0,Math.min(to,arr.length));
    arr.splice(insertAt,0,moved); state.lists=arr; persist(); renderLists();
  });
}
function getActiveList() { return state.lists.find((l)=>l.id===state.activeListId) || state.lists[0] || null; }
function renderToolbar() {
  const list=getActiveList();
  const input = el("#list-name-input");
  if (input) input.value = list ? list.name : "";
}

/* 登录弹窗开关 */
function openAuthModal(){
  const n=el("#auth-modal");
  if(!n){ alert("登录模块未加载"); return; }
  if(!supa){ alert("未配置 Supabase，无法登录。\n请在 supabase-config.js 中填写 anonKey。"); return; }
  n.classList.remove("hidden");
}
function closeAuthModal(){ const n=el("#auth-modal"); if(n) n.classList.add("hidden"); }

function initCompactSearch() {
  const wrap = document.querySelector('.toolbar .search-wrapper');
  const input = document.querySelector('#search-input');
  if (!wrap || !input) return;

  const open = () => {
    if (wrap.classList.contains('is-open')) return;
    wrap.classList.add('is-open');
    // 让输入框可聚焦、并选择现有文本
    requestAnimationFrame(() => { input.focus(); try { input.select(); } catch {} });
  };
  const close = () => {
    if (!wrap.classList.contains('is-open')) return;
    wrap.classList.remove('is-open');
    input.blur();
  };

  // 点击容器任意处展开
  wrap.addEventListener('click', (e) => {
    // 若已展开则不拦截正常点击（例如点击筛选按钮）
    if (!wrap.classList.contains('is-open')) {
      e.preventDefault();
      open();
    }
  });

  // Esc 收起
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  // 点外部收起
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // 快捷键：/ 或 Ctrl/Cmd+K 打开搜索（在未输入表单时）
  document.addEventListener('keydown', (e) => {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (typing) return;

    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      open();
    } else if ((e.key.toLowerCase() === 'k') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      open();
    }
  });
}


/* 初始化 */
function renderAll(){ renderLists(); renderToolbar(); renderProblems(); }

function init() {
  if (init.__ran) return;
  init.__ran = true;
  initTheme();
  bindEvents();
  setupSidebarResizer();
  renderAll();
  initSupabase();
  initMoreMenu();
  initAutoUpdater();

  // 新增：让搜索默认收起，点击/快捷键时再展开
  initCompactSearch();
}


// 启动
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
