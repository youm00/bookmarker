const SUPABASE_URL = 'https://sdrlnovrwxoajnewvvgg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcmxub3Zyd3hvYWpuZXd2dmdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTcyODMsImV4cCI6MjEwNDI3MzI4M30.g5SeP1feoi_rbAAkMMqTjWipTBaM3zcgsXsClGtWBbQ';

const APP_VERSION = 'v24';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let allItems = [];
let itemsById = new Map();
let childrenByParent = new Map();
let currentFolderId = null;
let searchQuery = '';
let editMode = false;
let sortableInstance = null;

window.addEventListener('DOMContentLoaded', init);

async function init() {
  loadSettings();
  bindStaticEvents();

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await enterApp();
  }
}

function bindStaticEvents() {
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  const versionEl = document.getElementById('version-label');
  if (versionEl) versionEl.textContent = 'バージョン: ' + APP_VERSION;

  const newRootFolderBtn = document.getElementById('new-root-folder-btn');
  if (newRootFolderBtn) newRootFolderBtn.addEventListener('click', () => openEditModal('folder', null, currentFolderId));

  const addBookmarkBtn = document.getElementById('add-bookmark-btn');
  if (addBookmarkBtn) addBookmarkBtn.addEventListener('click', () => openEditModal('bookmark', null, currentFolderId));

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderList();
    });
  }

  const importBtn = document.getElementById('import-btn');
  if (importBtn) importBtn.addEventListener('click', () => document.getElementById('import-file').click());

  const importFile = document.getElementById('import-file');
  if (importFile) importFile.addEventListener('change', handleImportFile);

  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', handleExport);

  // 設定ボタン（ヘッダー/サイドバーの複数ボタンに対応）
  document.querySelectorAll('#settings-btn, #settings-btn-tree').forEach(btn => {
    btn.addEventListener('click', openSettingsPanel);
  });

  const settingsCloseBtn = document.getElementById('settings-close-btn');
  if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', closeSettingsPanel);

  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay) {
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) closeSettingsPanel();
    });
  }

  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.addEventListener('click', toggleEditMode);
  });

  const mobileBackBtn = document.getElementById('mobile-back-btn');
  if (mobileBackBtn) {
    mobileBackBtn.addEventListener('click', () => {
      document.body.classList.remove('pane-list');
      document.body.classList.add('pane-tree');
    });
  }

  const fontSizeRange = document.getElementById('font-size-range');
  if (fontSizeRange) fontSizeRange.addEventListener('input', (e) => setFontSize(e.target.value));

  const lineHeightRange = document.getElementById('line-height-range');
  if (lineHeightRange) lineHeightRange.addEventListener('input', (e) => setLineHeight(e.target.value));

  const darkModeToggle = document.getElementById('dark-mode-toggle');
  if (darkModeToggle) darkModeToggle.addEventListener('change', (e) => setDarkMode(e.target.checked));

  const editCancelBtn = document.getElementById('edit-cancel-btn');
  if (editCancelBtn) editCancelBtn.addEventListener('click', closeEditModal);

  const editSaveBtn = document.getElementById('edit-save-btn');
  if (editSaveBtn) editSaveBtn.addEventListener('click', saveEdit);
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = '';

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (errEl) errEl.textContent = 'ログインに失敗しました: ' + error.message;
    return;
  }
  currentUser = data.user;
  await enterApp();
}

async function handleLogout() {
  if (!confirm('ログアウトしますか?')) return;
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

async function enterApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  setEditMode(false);
  await loadBookmarks();

  const params = new URLSearchParams(location.search);
  const targetFolderId = params.get('folder');

  if (targetFolderId && itemsById.has(targetFolderId)) {
    selectFolder(targetFolderId, { pushHistory: false });
  } else {
    selectFolder(null, { pushHistory: false });
    history.replaceState({ folderId: null }, '', location.pathname);
  }
}

function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('edit-mode', on);
  const label = on ? '閲覧' : '編集';
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.textContent = label;
    btn.classList.toggle('active', on);
  });
  renderList();
}

function toggleEditMode() {
  setEditMode(!editMode);
}

function openSettingsPanel() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    updateDebugInfo();
  }
}

function closeSettingsPanel() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

function updateDebugInfo() {
  const el = document.getElementById('debug-info');
  if (el) {
    el.textContent = `folder: ${currentFolderId || '(トップ)'}`;
  }
}

async function loadBookmarks() {
  const { data, error } = await sb
    .from('bookmarks')
    .select('*')
    .order('position', { ascending: true });

  if (error) {
    toast('読み込みエラー: ' + error.message);
    return;
  }
  allItems = data;
  rebuildIndexes();
  renderBreadcrumb();
  renderList();
}

function rebuildIndexes() {
  itemsById = new Map(allItems.map(i => [i.id, i]));
  childrenByParent = new Map();
  for (const item of allItems) {
    const key = item.parent_id || 'root';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(item);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.position - b.position);
  }
}

function getChildren(parentId) {
  return childrenByParent.get(parentId || 'root') || [];
}

function renderBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  el.innerHTML = '';
  
  const path = [];
  let cur = currentFolderId;
  while (cur) {
    const item = itemsById.get(cur);
    if (!item) break;
    path.unshift(item);
    cur = item.parent_id;
  }

  const rootSpan = document.createElement('span');
  rootSpan.className = 'crumb';
  rootSpan.textContent = 'トップ';
  rootSpan.addEventListener('click', () => selectFolder(null));
  el.appendChild(rootSpan);

  for (const item of path) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = ' / ';
    el.appendChild(sep);

    const span = document.createElement('span');
    span.className = 'crumb';
    span.textContent = item.title;
    span.addEventListener('click', () => selectFolder(item.id));
    el.appendChild(span);
  }
}

function selectFolder(id, options = {}) {
  const { pushHistory = true } = options;
  currentFolderId = id;
  searchQuery = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  
  document.body.classList.remove('pane-tree');
  document.body.classList.add('pane-list');

  renderBreadcrumb();
  renderList();

  if (pushHistory) {
    const url = new URL(location.href);
    if (id) {
      url.searchParams.set('folder', id);
    } else {
      url.searchParams.delete('folder');
    }
    history.pushState({ folderId: id }, '', url);
  }
}

window.addEventListener('popstate', (e) => {
  if (!currentUser) return;
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay && !settingsOverlay.classList.contains('hidden')) {
    closeSettingsPanel();
    return;
  }
  const folderId = e.state ? e.state.folderId : null;
  selectFolder(folderId, { pushHistory: false });
});

function renderList() {
  const container = document.getElementById('list');
  if (!container) return;

  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }

  container.innerHTML = '';

  let items;
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = allItems.filter(i =>
      i.type === 'bookmark' && (
        i.title.toLowerCase().includes(q) ||
        (i.url || '').toLowerCase().includes(q) ||
        (i.tags || []).some(t => t.toLowerCase().includes(q))
      )
    );
  } else {
    items = getChildren(currentFolderId);
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">項目がありません</div>';
    return;
  }

  for (const item of items) {
    container.appendChild(renderItemRow(item));
  }

  if (!searchQuery && editMode) {
    sortableInstance = Sortable.create(container, {
      animation: 150,
      onEnd: async () => {
        const ids = Array.from(container.children).map(c => c.dataset.id).filter(Boolean);
        const updates = ids.map((id, index) => ({ id, position: index }));
        for (const u of updates) {
          await sb.from('bookmarks').update({ position: u.position }).eq('id', u.id);
        }
        await loadBookmarks();
      }
    });
  }
}

function renderItemRow(item) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.id = item.id;

  const icon = document.createElement('div');
  icon.className = 'item-favicon';
  icon.textContent = item.type === 'folder' ? '📁' : '📄';
  row.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'item-body';

  const title = document.createElement('div');
  title.className = 'item-title';
  if (item.type === 'folder') {
    title.textContent = item.title;
    title.style.cursor = 'pointer';
    title.addEventListener('click', () => selectFolder(item.id));
  } else {
    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.title;
    title.appendChild(a);
  }
  body.appendChild(title);

  if (item.url && item.type === 'bookmark') {
    const urlEl = document.createElement('div');
    urlEl.className = 'item-url';
    urlEl.textContent = item.url;
    body.appendChild(urlEl);
  }

  if (item.tags && item.tags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'item-tags';
    for (const t of item.tags) {
      const tagEl = document.createElement('span');
      tagEl.className = 'item-tag';
      tagEl.textContent = t;
      tagsEl.appendChild(tagEl);
    }
    body.appendChild(tagsEl);
  }

  if (item.memo) {
    const memoEl = document.createElement('div');
    memoEl.className = 'item-memo';
    memoEl.textContent = item.memo;
    body.appendChild(memoEl);
  }

  row.appendChild(body);

  if (editMode) {
    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const editBtn = document.createElement('button');
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => openEditModal(item.type, item, item.parent_id));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => handleDelete(item));
    actions.appendChild(delBtn);

    row.appendChild(actions);
  }
  return row;
}

async function handleDelete(item) {
  const label = item.type === 'folder' ? 'フォルダ(中身も全て削除されます)' : 'ブックマーク';
  if (!confirm(`この${label}を削除しますか?\n「${item.title}」`)) return;
  const { error } = await sb.from('bookmarks').delete().eq('id', item.id);
  if (error) { toast('削除エラー: ' + error.message); return; }
  if (currentFolderId === item.id) currentFolderId = item.parent_id;
  await loadBookmarks();
}

function openEditModal(type, existingItem, parentId) {
  document.getElementById('edit-modal-title').textContent =
    existingItem ? (type === 'folder' ? 'フォルダを編集' : 'ブックマークを編集') :
    (type === 'folder' ? 'フォルダを追加' : 'ブックマークを追加');
  document.getElementById('edit-id').value = existingItem ? existingItem.id : '';
  document.getElementById('edit-type').value = type;
  document.getElementById('edit-title').value = existingItem ? existingItem.title : '';
  document.getElementById('edit-url').value = existingItem ? (existingItem.url || '') : '';
  document.getElementById('edit-tags').value = existingItem ? (existingItem.tags || []).join(', ') : '';
  document.getElementById('edit-memo').value = existingItem ? (existingItem.memo || '') : '';
  document.getElementById('edit-url-row').style.display = type === 'folder' ? 'none' : 'flex';
  document.getElementById('edit-modal').dataset.parentId = parentId || '';
  document.getElementById('edit-modal').classList.remove('hidden');
  document.getElementById('edit-title').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
}

async function saveEdit() {
  const id = document.getElementById('edit-id').value;
  const type = document.getElementById('edit-type').value;
  const title = document.getElementById('edit-title').value;
  const url = document.getElementById('edit-url').value.trim();
  const tags = document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const memo = document.getElementById('edit-memo').value.trim();
  const parentId = document.getElementById('edit-modal').dataset.parentId || null;

  if (!title) { toast('タイトルを入力してください'); return; }
  if (type === 'bookmark' && !url) { toast('URLを入力してください'); return; }

  if (id) {
    const { error } = await sb.from('bookmarks').update({ title, url: type === 'bookmark' ? url : null, tags, memo }).eq('id', id);
    if (error) { toast('保存エラー: ' + error.message); return; }
  } else {
    const position = getChildren(parentId).length;
    const { error } = await sb.from('bookmarks').insert({
      user_id: currentUser.id,
      parent_id: parentId,
      type, title,
      url: type === 'bookmark' ? url : null,
      tags, memo, position
    });
    if (error) { toast('追加エラー: ' + error.message); return; }
  }
  closeEditModal();
  await loadBookmarks();
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      toast('インポート中…');
      const tree = parseNetscapeHTML(ev.target.result);
      const rows = [];
      flattenImportTree(tree, null, rows, getChildren(null).length);
      await insertRowsInBatches(rows);
      toast(`インポートが完了しました(${rows.length}件)`);
      await loadBookmarks();
    } catch (err) {
      toast('インポートに失敗しました: ' + err.message);
    }
    e.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
}

function flattenImportTree(nodes, parentId, rows, startPosition = 0) {
  let position = startPosition;
  for (const node of nodes) {
    const id = crypto.randomUUID();
    if (node.type === 'folder') {
      rows.push({
        id, user_id: currentUser.id, parent_id: parentId,
        type: 'folder', title: node.title, tags: [], position: position++
      });
      flattenImportTree(node.children, id, rows);
    } else {
      rows.push({
        id, user_id: currentUser.id, parent_id: parentId,
        type: 'bookmark', title: node.title, url: node.url, tags: [], position: position++
      });
    }
  }
}

async function insertRowsInBatches(rows, batchSize = 300) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await sb.from('bookmarks').insert(chunk);
    if (error) throw error;
  }
}

function parseNetscapeHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const rootDl = doc.querySelector('dl');
  if (!rootDl) throw new Error('ブックマーク形式のHTMLが見つかりませんでした');
  return parseDl(rootDl);
}

function parseDl(dlEl) {
  const nodes = [];
  for (const dt of dlEl.children) {
    if (dt.tagName !== 'DT') continue;
    const h3 = dt.querySelector(':scope > h3');
    const a = dt.querySelector(':scope > a');
    if (h3) {
      const childDl = dt.querySelector(':scope > dl');
      nodes.push({
        type: 'folder',
        title: h3.textContent.trim() || '無題フォルダ',
        children: childDl ? parseDl(childDl) : []
      });
    } else if (a) {
      nodes.push({
        type: 'bookmark',
        title: a.textContent.trim() || a.getAttribute('href'),
        url: a.getAttribute('href')
      });
    }
  }
  return nodes;
}

function handleExport() {
  const header = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n`;
  const body = buildNetscapeHTML(null, 1);
  const footer = `</DL><p>\n`;
  const blob = new Blob([header + body + footer], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bookmarks_${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildNetscapeHTML(parentId, depth) {
  const indent = '    '.repeat(depth);
  let out = '';
  for (const item of getChildren(parentId)) {
    if (item.type === 'folder') {
      out += `${indent}<DT><H3>${escapeHtml(item.title)}</H3>\n${indent}<DL><p>\n${buildNetscapeHTML(item.id, depth + 1)}${indent}</DL><p>\n`;
    } else {
      out += `${indent}<DT><A HREF="${escapeHtml(item.url || '')}">${escapeHtml(item.title)}</A>\n`;
    }
  }
  return out;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loadSettings() {
  const fontSize = localStorage.getItem('bm_font_size') || '15';
  const lineHeight = localStorage.getItem('bm_line_height') || '160';
  const dark = localStorage.getItem('bm_dark') === '1';

  const fsRange = document.getElementById('font-size-range');
  if (fsRange) fsRange.value = fontSize;

  const lhRange = document.getElementById('line-height-range');
  if (lhRange) lhRange.value = lineHeight;

  const dmToggle = document.getElementById('dark-mode-toggle');
  if (dmToggle) dmToggle.checked = dark;

  setFontSize(fontSize);
  setLineHeight(lineHeight);
  setDarkMode(dark);
}

function setFontSize(px) {
  document.documentElement.style.setProperty('--font-size', px + 'px');
  const fsVal = document.getElementById('font-size-value');
  if (fsVal) fsVal.textContent = px + 'px';
  localStorage.setItem('bm_font_size', px);
}

function setLineHeight(v) {
  const ratio = (v / 100).toFixed(1);
  document.documentElement.style.setProperty('--line-height', ratio);
  const lhVal = document.getElementById('line-height-value');
  if (lhVal) lhVal.textContent = ratio;
  localStorage.setItem('bm_line_height', v);
}

function setDarkMode(on) {
  document.documentElement.dataset.theme = on ? 'dark' : '';
  localStorage.setItem('bm_dark', on ? '1' : '0');
}

let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}