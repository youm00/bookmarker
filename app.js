// ============================================================
// 設定: SupabaseのプロジェクトURLとanonキーをここに入れてください
// Supabaseダッシュボード > Project Settings > API から取得
// ============================================================
const SUPABASE_URL = 'https://sdrlnovrwxoajnewvvgg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkcmxub3Zyd3hvYWpuZXd2dmdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2OTcyODMsImV4cCI6MjEwNDI3MzI4M30.g5SeP1feoi_rbAAkMMqTjWipTBaM3zcgsXsClGtWBbQ';

// 今読み込まれているコードのバージョン(設定パネルに表示する。動作確認用)
const APP_VERSION = 'v11';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- グローバル状態 ----------
let currentUser = null;
let allItems = [];          // DBから取得した全件(フラット)
let itemsById = new Map();
let childrenByParent = new Map(); // parentId(or 'root') -> [items] (position順)
let currentFolderId = null; // null = ルート
let searchQuery = '';
let editMode = false;       // false = 閲覧モード, true = 編集モード

// ============================================================
// 起動
// ============================================================
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
  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('version-label').textContent = 'バージョン: ' + APP_VERSION;

  document.getElementById('new-root-folder-btn').addEventListener('click', () => openEditModal('folder', null, currentFolderId));
  document.getElementById('add-bookmark-btn').addEventListener('click', () => openEditModal('bookmark', null, currentFolderId));

  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderList();
  });

  document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', handleImportFile);
  document.getElementById('export-btn').addEventListener('click', handleExport);

  document.getElementById('settings-btn').addEventListener('click', toggleSettingsPanel);
  document.getElementById('settings-btn-tree').addEventListener('click', toggleSettingsPanel);
  document.getElementById('settings-close-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.add('hidden');
  });
  document.getElementById('mobile-back-btn').addEventListener('click', backToFolderTree);
  document.getElementById('mode-toggle-btn').addEventListener('click', toggleEditMode);
  document.getElementById('mode-toggle-btn-tree').addEventListener('click', toggleEditMode);
  document.getElementById('font-size-range').addEventListener('input', (e) => {
    setFontSize(e.target.value);
  });
  document.getElementById('line-height-range').addEventListener('input', (e) => {
    setLineHeight(e.target.value);
  });
  document.getElementById('dark-mode-toggle').addEventListener('change', (e) => {
    setDarkMode(e.target.checked);
  });

  document.getElementById('edit-cancel-btn').addEventListener('click', closeEditModal);
  document.getElementById('edit-save-btn').addEventListener('click', saveEdit);
}

// ============================================================
// 認証
// ============================================================
async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = 'ログインに失敗しました: ' + error.message;
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
  setEditMode(false); // 事故防止のため、開くたびに必ず閲覧モードから始める
  await loadBookmarks();

  // URLに ?folder=<ID> が付いている場合(ホーム画面ショートカット等)は、
  // そのフォルダの中身を直接開く
  const params = new URLSearchParams(location.search);
  const targetFolderId = params.get('folder');
  const targetItem = targetFolderId ? itemsById.get(targetFolderId) : null;

  if (targetItem && targetItem.type === 'folder') {
    selectFolder(targetFolderId, { pushHistory: false });
  } else {
    setPaneTree(); // 通常はフォルダ一覧から始める
    history.replaceState({ folderId: null }, '', location.pathname);
  }
}

// ============================================================
// 閲覧モード/編集モードの切り替え
// ============================================================
function setEditMode(on) {
  editMode = on;
  document.body.classList.toggle('edit-mode', on);
  const label = on ? '閲覧' : '編集';
  document.querySelectorAll('.mode-toggle-btn').forEach(btn => {
    btn.textContent = label;
    btn.classList.toggle('active', on);
  });
  renderTree();
  renderList();
}
function toggleEditMode() {
  setEditMode(!editMode);
}

// ============================================================
// スマホ向け1ペイン表示の切り替え(PC幅では無視される)
// ============================================================
function setPaneTree() {
  document.body.classList.remove('pane-list');
  document.body.classList.add('pane-tree');
}

// 「←」ボタン専用: ツリー画面に戻り、URLからもフォルダ指定を消す。
// (これをしないと、この状態でプルダウン更新した時にURLに残ったフォルダが
//  再度開いてしまい、見た目とURLがズレる)
function backToFolderTree() {
  setPaneTree();
  const url = new URL(location.href);
  url.searchParams.delete('folder');
  history.replaceState({ folderId: null }, '', url);
}
function setPaneList() {
  document.body.classList.remove('pane-tree');
  document.body.classList.add('pane-list');
}
function toggleSettingsPanel() {
  document.getElementById('settings-panel').classList.toggle('hidden');
  updateDebugInfo();
}

// 診断用: 今の状態(ペイン/フォルダ/URL)を設定パネルに表示する
function updateDebugInfo() {
  const pane = document.body.classList.contains('pane-tree') ? 'tree'
    : document.body.classList.contains('pane-list') ? 'list' : '(なし)';
  const el = document.getElementById('debug-info');
  if (el) {
    el.textContent =
      `pane: ${pane} / folder: ${currentFolderId || '(root)'} / URL: ${location.href}`;
  }
}

// ============================================================
// データ読み込み
// ============================================================
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
  renderTree();
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

function getFolders(parentId) {
  return (childrenByParent.get(parentId || 'root') || []).filter(i => i.type === 'folder');
}
function getChildren(parentId) {
  return childrenByParent.get(parentId || 'root') || [];
}

// ============================================================
// ツリー(フォルダ階層)描画
// ============================================================
function renderTree() {
  const container = document.getElementById('tree');
  container.innerHTML = '';
  const rootList = document.createElement('div');
  rootList.className = 'tree-children tree-root';
  rootList.style.marginLeft = '0';
  rootList.style.borderLeft = 'none';
  rootList.dataset.parentId = 'root';
  renderFolderChildren(null, rootList);
  container.appendChild(rootList);

  // ルート自体を選択するための行
  const rootRow = document.createElement('div');
  rootRow.className = 'tree-row' + (currentFolderId === null ? ' active' : '');
  rootRow.textContent = '📁 すべて';
  rootRow.style.fontWeight = '600';
  rootRow.addEventListener('click', () => selectFolder(null));
  addDropTarget(rootRow, null);
  container.insertBefore(rootRow, container.firstChild);

  initFolderSortable(rootList);
}

function renderFolderChildren(parentId, container) {
  const folders = getFolders(parentId);
  for (const folder of folders) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.id = folder.id;

    const row = document.createElement('div');
    row.className = 'tree-row' + (currentFolderId === folder.id ? ' active' : '');
    row.innerHTML = `<span class="tree-toggle">▸</span><span class="tree-folder-icon">📁</span><span class="tree-label"></span>`;
    row.querySelector('.tree-label').textContent = folder.title;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFolder(folder.id);
    });
    addDropTarget(row, folder.id);
    item.appendChild(row);

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children';
    childContainer.dataset.parentId = folder.id;
    renderFolderChildren(folder.id, childContainer);
    item.appendChild(childContainer);

    container.appendChild(item);
    initFolderSortable(childContainer);
  }
}

function addDropTarget(rowEl, folderId) {
  rowEl.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/bookmark-id')) {
      e.preventDefault();
      rowEl.classList.add('drag-over');
    }
  });
  rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drag-over'));
  rowEl.addEventListener('drop', async (e) => {
    rowEl.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/bookmark-id');
    if (!id) return;
    e.preventDefault();
    await moveItemToFolder(id, folderId);
  });
}

function initFolderSortable(el) {
  if (!editMode) return; // 閲覧モードではドラッグ並び替えを無効化(誤操作防止)
  Sortable.create(el, {
    group: 'folders',
    animation: 150,
    fallbackOnBody: true,
    swapThreshold: 0.65,
    onEnd: async (evt) => {
      const newParentId = evt.to.dataset.parentId === 'root' ? null : evt.to.dataset.parentId;
      const ids = Array.from(evt.to.children)
        .map(child => child.dataset.id)
        .filter(Boolean);
      await persistFolderOrder(newParentId, ids);
    }
  });
}

async function persistFolderOrder(newParentId, orderedIds) {
  const updates = orderedIds.map((id, index) => ({ id, position: index, parent_id: newParentId }));
  for (const u of updates) {
    await sb.from('bookmarks').update({ position: u.position, parent_id: u.parent_id }).eq('id', u.id);
  }
  await loadBookmarks();
}

// ============================================================
// パンくず
// ============================================================
function renderBreadcrumb() {
  const el = document.getElementById('breadcrumb');
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
  rootSpan.textContent = 'すべて';
  rootSpan.addEventListener('click', () => selectFolder(null));
  el.appendChild(rootSpan);

  for (const item of path) {
    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.textContent = '/';
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
  document.getElementById('search-input').value = '';
  renderTree();
  renderBreadcrumb();
  renderList();
  setPaneList(); // スマホでは中身の一覧画面に切り替える(PC幅では無視される)

  if (pushHistory) {
    // フォルダごとに固有のURL(?folder=ID)にする
    // → Androidの「ホーム画面に追加」で特定フォルダ直行のショートカットが作れる
    const url = new URL(location.href);
    if (id) {
      url.searchParams.set('folder', id);
    } else {
      url.searchParams.delete('folder');
    }
    history.pushState({ folderId: id }, '', url);
  }
}

// スマホの「戻る」ボタン(ブラウザバック)でアプリごと閉じず、
// 1つ前に見ていたフォルダに戻れるようにする
window.addEventListener('popstate', (e) => {
  if (!currentUser) return; // ログイン前は何もしない
  const folderId = e.state ? e.state.folderId : null;

  if (folderId === null) {
    // ルート(すべて)に戻る場合は、通常の初期状態と同じくフォルダ一覧(ツリー)に戻す。
    // (これまでは常にリスト画面を強制していたため、「戻る」操作でルートに
    //  たどり着いた時に、想定と違うリスト画面が表示されてしまっていた)
    currentFolderId = null;
    searchQuery = '';
    document.getElementById('search-input').value = '';
    renderTree();
    renderBreadcrumb();
    renderList();
    setPaneTree();
  } else {
    selectFolder(folderId, { pushHistory: false });
  }
});

// ============================================================
// メインリスト描画
// ============================================================
function renderList() {
  const container = document.getElementById('list');
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
    Sortable.create(container, {
      animation: 150,
      onEnd: async (evt) => {
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
  row.draggable = editMode; // 閲覧モードではドラッグ無効(スクロールの誤操作を防ぐ)
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/bookmark-id', item.id);
  });

  const icon = document.createElement('div');
  icon.className = 'item-favicon';
  icon.textContent = item.type === 'folder' ? '📁' : '🔖';
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

  if (item.type === 'bookmark' && item.url) {
    const url = document.createElement('div');
    url.className = 'item-url';
    url.textContent = item.url;
    body.appendChild(url);
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

    if (item.type === 'bookmark') {
      const moveBtn = document.createElement('button');
      moveBtn.textContent = '移動';
      moveBtn.addEventListener('click', () => promptMove(item));
      actions.appendChild(moveBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => handleDelete(item));
    actions.appendChild(delBtn);

    row.appendChild(actions);
  }
  return row;
}

async function promptMove(item) {
  const folders = allItems.filter(i => i.type === 'folder');
  const options = ['(ルート)', ...folders.map(f => f.title)];
  const idx = prompt('移動先のフォルダ番号を入力してください:\n' +
    options.map((o, i) => `${i}: ${o}`).join('\n'));
  if (idx === null) return;
  const i = parseInt(idx, 10);
  if (isNaN(i) || i < 0 || i >= options.length) return;
  const newParentId = i === 0 ? null : folders[i - 1].id;
  await moveItemToFolder(item.id, newParentId);
}

async function moveItemToFolder(id, newParentId) {
  if (id === newParentId) return;
  const siblingCount = getChildren(newParentId).length;
  const { error } = await sb.from('bookmarks')
    .update({ parent_id: newParentId, position: siblingCount })
    .eq('id', id);
  if (error) { toast('移動エラー: ' + error.message); return; }
  await loadBookmarks();
}

async function handleDelete(item) {
  const label = item.type === 'folder' ? 'フォルダ(中身も全て削除されます)' : 'ブックマーク';
  if (!confirm(`この${label}を削除しますか?\n「${item.title}」`)) return;
  const { error } = await sb.from('bookmarks').delete().eq('id', item.id);
  if (error) { toast('削除エラー: ' + error.message); return; }
  if (currentFolderId === item.id) currentFolderId = item.parent_id;
  await loadBookmarks();
}

// ============================================================
// 追加/編集モーダル
// ============================================================
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
  const title = document.getElementById('edit-title').value.trim();
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

// ============================================================
// インポート(ブラウザのお気に入りHTML / Netscape Bookmark形式)
// ============================================================
function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      toast('インポート中…しばらくお待ちください');
      const tree = parseNetscapeHTML(ev.target.result);
      const rows = [];
      // 日付フォルダで包まず、「すべて」(ルート)の直下にそのまま展開する
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

// パース結果のツリーを、あらかじめIDを採番したフラットな行の配列に変換する
// (親フォルダのIDが先に分かっていないと子のparent_idが決められないため、
//  ここでクライアント側でUUIDを生成してから一括INSERTする)
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

// 1件ずつ通信すると件数が多いスマホ回線で失敗しやすいため、
// まとめて(最大300件ずつ)一括INSERTする
async function insertRowsInBatches(rows, batchSize = 300) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await sb.from('bookmarks').insert(chunk);
    if (error) throw error;
  }
}

// Netscape Bookmark File Format(<DL><DT> のネスト構造)をパースする
function parseNetscapeHTML(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const rootDl = doc.querySelector('dl');
  if (!rootDl) throw new Error('ブックマーク形式のHTMLが見つかりませんでした');
  return parseDl(rootDl);
}

function parseDl(dlEl) {
  const nodes = [];
  // dlの直下にある dt を順に処理(次の要素がdlならフォルダの中身)
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

// ============================================================
// エクスポート(Netscape Bookmark File Format で書き出し)
// ============================================================
function handleExport() {
  const header =
`<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
`;
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
      out += `${indent}<DT><H3>${escapeHtml(item.title)}</H3>\n`;
      out += `${indent}<DL><p>\n`;
      out += buildNetscapeHTML(item.id, depth + 1);
      out += `${indent}</DL><p>\n`;
    } else {
      out += `${indent}<DT><A HREF="${escapeHtml(item.url || '')}">${escapeHtml(item.title)}</A>\n`;
    }
  }
  return out;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// 表示設定(文字サイズ・行間・ダークモード) localStorage永続化
// ============================================================
function loadSettings() {
  const fontSize = localStorage.getItem('bm_font_size') || '15';
  const lineHeight = localStorage.getItem('bm_line_height') || '160';
  const dark = localStorage.getItem('bm_dark') === '1';

  document.getElementById('font-size-range').value = fontSize;
  document.getElementById('line-height-range').value = lineHeight;
  document.getElementById('dark-mode-toggle').checked = dark;

  setFontSize(fontSize);
  setLineHeight(lineHeight);
  setDarkMode(dark);
}

function setFontSize(px) {
  document.documentElement.style.setProperty('--font-size', px + 'px');
  document.getElementById('font-size-value').textContent = px + 'px';
  localStorage.setItem('bm_font_size', px);
}

function setLineHeight(v) {
  const ratio = (v / 100).toFixed(1);
  document.documentElement.style.setProperty('--line-height', ratio);
  document.getElementById('line-height-value').textContent = ratio;
  localStorage.setItem('bm_line_height', v);
}

function setDarkMode(on) {
  document.documentElement.dataset.theme = on ? 'dark' : '';
  localStorage.setItem('bm_dark', on ? '1' : '0');
}

// ============================================================
// トースト通知
// ============================================================
let toastTimer = null;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
