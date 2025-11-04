/* 题单管理器（原始功能 + 窄屏工具栏里的展开按钮 + 无动画侧栏）
   增强：随机CF抽题支持
   现在：集成 Supabase 登录（GitHub/Google/邮箱密码）+ 手动上传/下载同步（不使用实时）
*/

const STORAGE_KEY = "problem-lists:v1";
const UNCATEGORIZED_NAME = "未分类";

const uid = () => Math.random().toString(36).slice(2, 10);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const dedup = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
const byNameAsc = (a, b) => String(a || "").localeCompare(String(b || ""));
function normalizeTag(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

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
function parseShortTitle(url) {
  return parseCodeforcesShort(url) || parseLuoguShort(url) || parseAtcoderShort(url) || "";
}
function trySetTitleFromUrl(problem) {
  const code = parseShortTitle(problem.url);
  if (code && !String(problem.title || "").trim()) { problem.title = code; return true; }
  return false;
}

/* 拖拽（带自动滚动 + 兜底提交） */
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

/* 状态加载/保存与迁移 */
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

/* 标签库操作（同原版） */
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
let supa = null;      // Supabase 客户端
let authUser = null;  // 当前登录用户
const STATE_TABLE = "plm_states";

/* 构造稳定的 OAuth 回跳地址（可在 supabase-config.js 用 redirectToOverride 强制指定） */
function getRedirectTo() {
  try {
    const conf = window.SUPABASE_CONFIG || {};
    if (conf.redirectToOverride) return conf.redirectToOverride;
    const { origin, pathname } = window.location;
    const path = pathname.replace(/\/index\.html$/, "/"); // 去掉末尾 index.html
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
  if (emailEl) emailEl.textContent = authUser ? (authUser.email || "已登录") : "未登录";
  if (loginBtn) loginBtn.classList.toggle("hidden", !!authUser);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !authUser);
  // 登录前禁用同步按钮
  const disabled = !authUser;
  if (upBtn) upBtn.disabled = disabled;
  if (downBtn) downBtn.disabled = disabled;
}

function onLogin(user) {
  authUser = user;
  updateAccountUI();
}
function onLogout() {
  authUser = null;
  updateAccountUI();
}

async function loadRemoteState() {
  if (!supa || !authUser) return null;
  const { data, error } = await supa.from(STATE_TABLE).select("data,updated_at").eq("user_id", authUser.id).single();
  if (error && error.code !== "PGRST116") throw error; // 无行
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

/* 登录弹窗控制 */
function openAuthModal(){
  const n=el("#auth-modal");
  if(!n){ alert("登录模块未加载"); return; }
  if(!supa){ alert("未配置 Supabase，无法登录。\n请在 supabase-config.js 中填写 anonKey。"); return; }
  n.classList.remove("hidden");
}
function closeAuthModal(){ const n=el("#auth-modal"); if(n) n.classList.add("hidden"); }

/* 单元格渲染：标题/难度/链接 */
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

/* 搜索匹配 */
function matchQuery(p, q) {
  if (!q) return true;
  const s = q.trim().toLowerCase(); if (!s) return true;
  const hay = [p.title||"", p.url||"", p.difficulty||"", p.codeUrl||"", ...(p.tags||[])].join(" ").toLowerCase();
  return hay.includes(s);
}

/* 标签选择 popover（原版） */
let currentPopover = null;
let currentPopoverAnchor = null;
let __popRaf = 0;

function closePopover() {
  if (!currentPopover) return;
  document.removeEventListener("click", outsideClickOnce, { capture: true });
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("scroll", onWindowScroll, true);
  currentPopover.remove(); currentPopover = null;
  currentPopoverAnchor = null;
}
function outsideClickOnce(e){ if(currentPopover && !currentPopover.contains(e.target)) closePopover(); }
function positionPopover(pop, anchorEl) {
  const rect=anchorEl.getBoundingClientRect();
  let top=rect.bottom+window.scrollY+6;
  let left=rect.left+window.scrollX;
  const vw = window.innerWidth, vh = window.innerHeight;
  const pw = pop.offsetWidth || 360;
  const ph = pop.offsetHeight || 240;
  if (left + pw > window.scrollX + vw - 8) left = Math.max(window.scrollX + 8, window.scrollX + vw - pw - 8);
  if (top + ph > window.scrollY + vh - 8) top = Math.max(window.scrollY + 8, rect.top + window.scrollY - ph - 6);
  pop.style.top=`${top}px`; pop.style.left=`${left}px`;
}
function positionPopoverVerticalOnly(pop, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  let top = rect.bottom + window.scrollY + 6;
  const vh = window.innerHeight;
  const ph = pop.offsetHeight || 240;
  if (top + ph > window.scrollY + vh - 8) {
    top = Math.max(window.scrollY + 8, rect.top + window.scrollY - ph - 6);
  }
  pop.style.top = `${top}px`;
}
function onWindowScroll(){
  if (!currentPopover || !currentPopoverAnchor || !currentPopoverAnchor.isConnected) { closePopover(); return; }
  if (__popRaf) cancelAnimationFrame(__popRaf);
  __popRaf = requestAnimationFrame(() => {
    __popRaf = 0;
    positionPopoverVerticalOnly(currentPopover, currentPopoverAnchor);
  });
}
function onWindowResize(){
  if (!currentPopover || !currentPopoverAnchor || !currentPopoverAnchor.isConnected) { closePopover(); return; }
  positionPopover(currentPopover, currentPopoverAnchor);
}
function togglePopover(anchorEl, builder) {
  if (currentPopover) closePopover();
  const pop = builder();
  document.body.appendChild(pop);
  currentPopover = pop;
  currentPopoverAnchor = anchorEl;
  positionPopover(pop, anchorEl);
  setTimeout(()=>{
    document.addEventListener("click", outsideClickOnce, { capture: true });
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, true);
  });
}
function buildTagPopover(problem, anchorEl, onChanged) {
  const pop=document.createElement("div"); pop.className="popover";
  const s1=document.createElement("div"); s1.className="pop-section";
  const h4a=document.createElement("h4"); h4a.textContent="添加新标签";
  const inputNew=input("text","","输入新标签后回车（加入未分类）"); inputNew.classList.add("input-sm");
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
    const addIn=input("text","",`在「${c.name}」新增标签后回车`); addIn.classList.add("input-sm"); addIn.style.marginTop="6px";
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
  if (!filtered.length) { const tr=document.createElement("tr"); tr.innerHTML = `<td colspan="6" style="color: var(--muted); padding: 18px;">没有匹配的题目</td>`; tbody.appendChild(tr); return; }
  filtered.forEach((p)=>{
    const tr=el("#problem-row-tpl").content.firstElementChild.cloneNode(true);
    tr.classList.add("problem-row"); tr.dataset.pid=p.id;

    el(".cell-title", tr).setAttribute("data-label","标题");
    el(".cell-link", tr).setAttribute("data-label","题目链接");
    el(".cell-difficulty", tr).setAttribute("data-label","难度");
    el(".cell-tags", tr).setAttribute("data-label","标签");
    el(".cell-code", tr).setAttribute("data-label","代码链接");
    el(".cell-actions", tr).setAttribute("data-label","操作");

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
    const delBtn=button("删除","danger"); delBtn.addEventListener("click",()=>{
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
function input(type, value="", placeholder=""){ const i=document.createElement("input"); i.type=type; i.value=value||""; i.placeholder=placeholder; return i; }
function button(text, cls = "") {
  const b = document.createElement("button");
  b.textContent = text;
  if (cls) cls.split(/\s+/).filter(Boolean).forEach(c => b.classList.add(c));
  return b;
}
function escapeHtml(s){ return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
/* 修改：只本地保存（不再自动上传） */
function persist(){ saveState(state); }

/* 标签库管理面板 */
function openTagsModal(){ el("#tags-modal").classList.remove("hidden"); renderTagManager(); }
function closeTagsModal(){ el("#tags-modal").classList.add("hidden"); }
function renderTagManager(){
  const wrap=el("#taglib-cats"); if (!wrap) return; wrap.innerHTML="";
  const cats=getCategories() || []; if (!cats.length) ensureTagLibrary(state);

  cats.forEach((c)=>{
    const box=document.createElement("div"); box.className="lib-cat";
    const head=document.createElement("div"); head.className="lib-cat-head";
    const nameLabel=document.createElement("span"); nameLabel.textContent=c.name; nameLabel.style.fontWeight="600";
    const spacer=document.createElement("div"); spacer.className="spacer";
    const delCatBtn=button("×","danger"); delCatBtn.title=`删除分类：${c.name}`;
    delCatBtn.style.width="28px"; delCatBtn.style.height="28px"; delCatBtn.style.padding="0";
    delCatBtn.addEventListener("click", ()=>{
      if (c.name === UNCATEGORIZED_NAME) { alert("不能删除「未分类」"); return; }
      if (!confirm(`删除分类「${c.name}」？其中标签将移动到「${UNCATEGORIZED_NAME}」`)) return;
      deleteCategory(c.id); renderTagManager(); renderProblems();
    });
    head.appendChild(nameLabel); head.appendChild(spacer); head.appendChild(delCatBtn);

    const body=document.createElement("div"); body.className="lib-cat-body";
    const tagList=document.createElement("div"); tagList.className="lib-chip-list";
    const tagsSafe = Array.isArray(c.tags) ? c.tags : [];
    tagsSafe.forEach((t)=>{
      const chip=document.createElement("span"); chip.className="lib-chip";
      const nameSpan=document.createElement("span"); nameSpan.textContent=String(t||"");
      const x=document.createElement("button"); x.textContent="×"; x.title=`删除标签：${t}`; x.className="chip-del danger";
      x.addEventListener("click",(e)=>{
        e.stopPropagation();
        if(!confirm(`从库中删除标签「${t}」？（不会影响题目上已有的同名标签）`)) return;
        deleteTag(c.id,t); renderTagManager(); renderProblems();
      });
      chip.appendChild(nameSpan); chip.appendChild(x); tagList.appendChild(chip);
    });

    const controls=document.createElement("div"); controls.className="lib-controls";
    function renderAddButton(){
      controls.innerHTML="";
      const addBtn=button("添加标签","btn-xxs");
      addBtn.addEventListener("click", showAddInput);
      controls.appendChild(addBtn);
    }
    function showAddInput(){
      controls.innerHTML="";
      const inputEl=input("text","",`在「${c.name}」新增标签后回车`); inputEl.classList.add("input-sm"); inputEl.style.maxWidth="260px";
      const okBtn=button("确定","btn-primary btn-xxs");
      const cancelBtn=button("取消","btn-xxs");
      okBtn.addEventListener("click",()=>{
        const v=(inputEl.value||"").trim(); if(!v){ inputEl.focus(); return; }
        if (!addTagToCategory(c.id,v)) { alert("新增失败：标签名为空"); return; }
        renderTagManager(); renderProblems();
      });
      cancelBtn.addEventListener("click", renderAddButton);
      inputEl.addEventListener("keydown",(e)=>{
        if (e.key==="Enter") { e.preventDefault(); okBtn.click(); }
        else if (e.key==="Escape") { e.preventDefault(); renderAddButton(); }
      });
      controls.appendChild(inputEl); controls.appendChild(okBtn); controls.appendChild(cancelBtn);
      setTimeout(()=>inputEl.focus(),0);
    }
    renderAddButton();

    body.appendChild(tagList); body.appendChild(controls);
    box.appendChild(head); box.appendChild(body); wrap.appendChild(box);
  });

  enableDragSort(wrap, ".lib-cat", (from, to)=>{
    const arr=state.tagLibrary.categories.slice(); const [moved]=arr.splice(from,1);
    const insertAt=Math.max(0,Math.min(to,arr.length));
    arr.splice(insertAt,0,moved); state.tagLibrary.categories=arr; persist(); renderTagManager(); renderProblems();
  });
}

/* 随机 CF 抽题 + 偏好记忆 + 限制（保持不变） */
const CF_CACHE_KEY="cf:problemset:v1"; const CF_CACHE_TTL_MS=1000*60*60*24;

const CF_PREF_KEYS = {
  includeTags: "cf:random:includeTags",
  ratingMin: "cf:random:ratingMin",
  ratingMax: "cf:random:ratingMax",
  tags: "cf:random:tags",
  count: "cf:random:count",
  handle: "cf:random:handle",
  excludeSolved: "cf:random:excludeSolved",
};
function getPref(key, defVal=null) { try { const v = localStorage.getItem(key); return v === null ? defVal : v; } catch { return defVal; } }
function setPref(key, val) { try { if (val==null || val==="") localStorage.removeItem(key); else localStorage.setItem(key, String(val)); } catch {} }
function applyCFRandomPrefs() {
  const ck = el("#cf-include-tags");
  const minEl = el("#cf-rating-min");
  const maxEl = el("#cf-rating-max");
  const tagsEl = el("#cf-tags");
  const countEl = el("#cf-count");
  const handleEl = el("#cf-handle");
  const exSolvedEl = el("#cf-exclude-solved");
  if (ck) ck.checked = getPref(CF_PREF_KEYS.includeTags, "1") !== "0";
  if (minEl) minEl.value = getPref(CF_PREF_KEYS.ratingMin, "") || "";
  if (maxEl) maxEl.value = getPref(CF_PREF_KEYS.ratingMax, "") || "";
  if (tagsEl) tagsEl.value = getPref(CF_PREF_KEYS.tags, "") || "";
  if (countEl) countEl.value = getPref(CF_PREF_KEYS.count, "1") || "1";
  if (handleEl) handleEl.value = getPref(CF_PREF_KEYS.handle, "") || "";
  if (exSolvedEl) exSolvedEl.checked = getPref(CF_PREF_KEYS.excludeSolved, "0") === "1";
}
function saveCFRandomPrefsFromForm() {
  const ck = el("#cf-include-tags");
  const minEl = el("#cf-rating-min");
  const maxEl = el("#cf-rating-max");
  const tagsEl = el("#cf-tags");
  const countEl = el("#cf-count");
  const handleEl = el("#cf-handle");
  const exSolvedEl = el("#cf-exclude-solved");
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

/* AC 题过滤与 handle 校验（保持） */
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

  const searchInput = el("#search-input");
  const clearBtn = el("#clear-search-btn");
  if (searchInput) {
    const toggleClear = () => { if (clearBtn) clearBtn.style.display = searchInput.value ? "inline-flex" : "none"; };
    searchInput.addEventListener("input", ()=>{ renderProblems(); toggleClear(); });
    toggleClear();
  }
  if (clearBtn) clearBtn.addEventListener("click", ()=>{ el("#search-input").value=""; clearBtn.style.display="none"; renderProblems(); });

  el("#add-problem-btn").addEventListener("click", ()=>{
    const list=getActiveList(); if(!list) return;
    list.problems.unshift({ id: uid(), title:"", url:"", difficulty:"", tags:[], codeUrl:"" });
    persist(); renderProblems();
  });

  el("#export-btn").addEventListener("click", ()=>{
    const dataStr="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(state,null,2));
    const a=document.createElement("a"); a.href=dataStr; const date=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download=`problem-lists-all-${date}.json`; a.click();
  });
  el("#import-input").addEventListener("change", async (e)=>{
    const f=e.target.files?.[0]; if(!f) return;
    try { const txt=await f.text(); const data=JSON.parse(txt);
      if(!data || !Array.isArray(data.lists)) { alert("导入失败：格式不正确"); return; }
      migrateState(data); state=data; if(!state.activeListId && state.lists[0]) state.activeListId=state.lists[0].id;
      persist(); renderAll(); e.target.value=""; alert("导入成功");
    } catch(err){ console.error(err); alert("导入失败：解析错误"); }
  });

  el("#export-list-btn").addEventListener("click", ()=>{
    const list=getActiveList(); if(!list){ alert("没有可导出的题单"); return; }
    const payload={ name:list.name, problems:list.problems||[] };
    const dataStr="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(payload,null,2));
    const a=document.createElement("a"); a.href=dataStr; const date=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download=`problem-list-${sanitizeFilename(list.name)}-${date}.json`; a.click();
  });
  el("#import-list-input").addEventListener("change", async (e)=>{
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

  el("#manage-tags-btn").addEventListener("click", openTagsModal);
  el("#tags-modal-close").addEventListener("click", closeTagsModal);

  el("#new-cat-input").addEventListener("keydown",(e)=>{
    if(e.key==="Enter"){ e.preventDefault(); const v=el("#new-cat-input").value.trim(); if(!v) return;
      if(!addCategory(v)) { alert("创建失败：名称为空/重复/为未分类"); return; }
      el("#new-cat-input").value=""; renderTagManager(); renderProblems();
    }
  });

  // 小屏侧栏抽屉（行内“展开”按钮 + 遮罩 + 手势/ESC）
  const sidebar = el(".sidebar");
  const sidebarBackdrop = el("#sidebar-backdrop");
  const edgeOpen = el("#sidebar-edge-open");

  if (sidebar && sidebarBackdrop) {
    const openSidebar = () => {
      if (window.innerWidth > 900) return;
      sidebar.classList.add("open");
      sidebarBackdrop.classList.add("show");
    };
    const closeSidebar = () => {
      sidebar.classList.remove("open");
      sidebarBackdrop.classList.remove("show");
    };

    if (edgeOpen) {
      const onOpen = (e) => { e.preventDefault(); e.stopPropagation(); openSidebar(); };
      edgeOpen.addEventListener("click", onOpen);
      edgeOpen.addEventListener("touchend", onOpen, { passive: false });
    }
    sidebarBackdrop.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); closeSidebar(); });

    window.addEventListener("resize", () => { if (window.innerWidth > 900) closeSidebar(); });

    // 左缘右划打开
    let startX=0,startY=0,tracking=false; const EDGE=20, OPEN_THRESHOLD=50, MAX_ANGLE=25;
    window.addEventListener("touchstart",(e)=>{ if(window.innerWidth>900) return; if(sidebar.classList.contains("open")) return; const t=e.touches[0]; if(t.clientX<=EDGE){ startX=t.clientX; startY=t.clientY; tracking=true; }},{passive:true});
    window.addEventListener("touchmove",(e)=>{ if(!tracking) return; const t=e.touches[0]; const dx=t.clientX-startX, dy=Math.abs(t.clientY-startY); const angle=Math.atan2(dy,Math.abs(dx))*180/Math.PI; if(dx>0 && angle<MAX_ANGLE) e.preventDefault();},{passive:false});
    window.addEventListener("touchend",(e)=>{ if(!tracking) return; tracking=false; const t=e.changedTouches[0]; const dx=t.clientX-startX, dy=Math.abs(t.clientY-startY); const angle=Math.atan2(dy,Math.abs(dx))*180/Math.PI; if(dx>=OPEN_THRESHOLD && angle<MAX_ANGLE) openSidebar(); });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && window.innerWidth <= 900 && sidebar.classList.contains("open")) closeSidebar();
    });
  }

  /* 随机 CF 抽题：预设、记忆化等（保持） */
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
          handleMsg.className = "cf-msg" + (st.ok ? " ok" : " error");
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
        if (minEl) { minEl.value = min || ""; setPref(CF_PREF_KEYS.ratingMin, minEl.value.trim()); }
        if (maxEl) { maxEl.value = max || ""; setPref(CF_PREF_KEYS.ratingMax, maxEl.value.trim()); }
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

    el("#cf-random-run").addEventListener("click", async ()=>{
      try {
        saveCFRandomPrefsFromForm();
        const list=getActiveList(); if(!list){ alert("请先创建或选择一个题单"); return; }
        const ratingMinRaw=el("#cf-rating-min").value.trim();
        const ratingMaxRaw=el("#cf-rating-max").value.trim();
        const tagsRaw=el("#cf-tags").value.trim();
        const countRaw=el("#cf-count").value.trim();
        const includeTags=!!el("#cf-include-tags").checked;

        const handle = (el("#cf-handle")?.value || "").trim();
        const excludeSolved = !!el("#cf-exclude-solved")?.checked;

        if (excludeSolved) {
          if (!handle) { alert("已勾选“排除已AC”，请填写 CF 账号"); return; }
          const st = await validateCFHandle(handle);
          if (!st.ok) {
            alert(st.reason === "not_found" ? "CF 账号不存在，请检查" : "网络错误，稍后再试");
            return;
          }
        }

        const ratingMin=ratingMinRaw?Number(ratingMinRaw):null;
        const ratingMax=ratingMaxRaw?Number(ratingMaxRaw):null;
        const requireRated = (ratingMin!=null || ratingMax!=null);
        const tags=tagsRaw?tagsRaw.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean):[];
        const count=countRaw?Number(countRaw):1;

        const { problems } = await loadCFProblemset(false);

        let solvedSet = null;
        if (excludeSolved && handle) {
          solvedSet = await loadCFSolvedSet(handle);
        }

        const picked = pickRandomCF(problems, { ratingMin, ratingMax, tags, count, requireRated, excludeSolved, solvedSet });
        if (!picked.length) { alert("没有匹配的题目，请调整筛选条件"); return; }

        const items = picked.map(p => cfProblemToAppItem(p, includeTags));
        const existingUrls = new Set((list.problems||[]).map(x => (x.url||"").trim()));
        const deduped = items.filter(x => x.url && !existingUrls.has(x.url.trim()));
        if (!deduped.length) { alert("匹配题目已存在于当前题单，无新增"); return; }

        list.problems = [...deduped, ...(list.problems||[])];
        persist(); renderProblems(); closeCFRandomModal();
        alert(`已加入 ${deduped.length} 道题`);
      } catch(err){ console.error(err); alert("抽题失败：网络错误或 CF API 异常"); }
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
  const oauthGithub = el("#oauth-github");
  const oauthGoogle = el("#oauth-google");
  const syncStatus = el("#sync-status");
  const upBtn = el("#sync-upload-btn");
  const downBtn = el("#sync-download-btn");

  const setMsg = (t, isErr=false) => { if (!msgEl) return; msgEl.textContent = t || ""; msgEl.style.color = isErr ? "var(--danger)" : "var(--muted)"; };
  const setSync = (t) => { if (syncStatus) syncStatus.textContent = t || ""; };

  if (loginBtn) loginBtn.addEventListener("click", openAuthModal);
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
  const startOAuth = async (provider) => {
    if (!supa) { alert("未配置 Supabase，无法登录。"); return; }
    try {
      const redirectTo = getRedirectTo();
      setMsg(`跳转到 ${provider} 登录中...`);
      await supa.auth.signInWithOAuth({ provider, options: { redirectTo } });
    } catch (e) {
      setMsg("第三方登录失败", true);
      console.error(e);
    }
  };
  if (oauthGithub) oauthGithub.addEventListener("click", () => startOAuth("github"));
  if (oauthGoogle) oauthGoogle.addEventListener("click", () => startOAuth("google"));

  // 手动同步：上传云端
  if (upBtn) upBtn.addEventListener("click", async () => {
    if (!supa || !authUser) { openAuthModal(); alert("请先登录账号，再执行上传。"); return; }
    try {
      upBtn.disabled = true; downBtn && (downBtn.disabled = true);
      setSync("上传中...");
      const { ok, error } = await saveRemoteState();
      if (!ok) { console.error(error); setSync("上传失败"); alert("上传失败：" + (error?.message || "未知错误")); }
      else { setSync("已上传"); setTimeout(()=>setSync(""), 1500); }
    } finally {
      upBtn.disabled = false; downBtn && (downBtn.disabled = !authUser);
    }
  });

  // 手动同步：下载云端
  if (downBtn) downBtn.addEventListener("click", async () => {
    if (!supa || !authUser) { openAuthModal(); alert("请先登录账号，再执行下载。"); return; }
    try {
      upBtn && (upBtn.disabled = true); downBtn.disabled = true;
      setSync("下载中...");
      const remote = await loadRemoteState();
      if (!remote) {
        setSync("云端为空");
        setTimeout(()=>setSync(""), 1500);
        alert("云端暂无数据。可先在本设备点“上传云端”。");
        return;
      }
      migrateState(remote);
      state = remote;
      saveState(state);
      renderAll();
      setSync("已下载");
      setTimeout(()=>setSync(""), 1500);
    } catch (e) {
      console.error(e);
      setSync("下载失败");
      alert("下载失败：" + (e?.message || "未知错误"));
    } finally {
      upBtn && (upBtn.disabled = !authUser);
      downBtn.disabled = !authUser;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePopover(); closeTagsModal(); closeCFRandomModal(); closeAuthModal(); }
  });
}

function sanitizeFilename(s){ return String(s||"list").replace(/[\\/:*?"<>|]/g,"_").slice(0,60); }

/* 渲染：列表侧栏与工具栏 */
function renderLists() {
  const wrap = el("#lists"); wrap.innerHTML = "";
  state.lists.forEach((l) => {
    const div = document.createElement("div");
    div.className = "list-item" + (l.id === state.activeListId ? " active" : "");
    div.dataset.listId = l.id;
    div.innerHTML = `<div class="name">${escapeHtml(l.name || "未命名题单")}</div><div class="meta">${(l.problems||[]).length} 道题</div>`;
    div.addEventListener("click", () => { state.activeListId = l.id; persist(); renderAll(); });
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

/* 初始化 */
function renderAll(){ renderLists(); renderToolbar(); renderProblems(); }

function init(){
  if (init.__ran) return;     // 防止重复执行
  init.__ran = true;
  bindEvents();
  renderAll();
  initSupabase();
}

// DOM 已就绪则立即运行，否则等 DOMContentLoaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

