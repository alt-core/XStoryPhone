export function talkBranchReviewPageHtml() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>会話分岐レビュー</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --common-rule-bg: #f4efe7; --shared-from-bg: #dfeaf0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f7f5; color: #151a22; }
    header { display: flex; gap: 8px; align-items: center; padding: 8px 10px; background: #fff; border-bottom: 1px solid #d9dee7; }
    body:not(.ready) header { min-height: 100vh; justify-content: center; }
    body.ready header { display: none; }
    body.ready .auth-control { display: none; }
    body:not(.ready) .shell, body:not(.ops) .ops-only, body:not(.ops-loaded) .ops-after-load { display: none; }
    h1 { margin: 0 12px 0 0; font-size: 17px; white-space: nowrap; }
    input, textarea, select, button { font: inherit; border: 1px solid #c7cfda; border-radius: 4px; background: #fff; }
    input, select { height: 30px; padding: 4px 7px; }
    textarea { padding: 7px; resize: vertical; }
	    button { height: 28px; padding: 3px 8px; background: #17202a; color: #fff; border-color: #17202a; cursor: pointer; }
	    button.secondary { background: #fff; color: #17202a; }
	    button.danger { background: #fff; color: #a9473f; border-color: #e0b6b1; }
	    button:disabled { opacity: 0.45; cursor: default; }
    .shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); height: 100vh; min-height: 0; }
    body.from-collapsed .shell { grid-template-columns: 24px minmax(0, 1fr); }
    aside { min-height: 0; border-right: 1px solid #d9dee7; background: #fff; overflow: hidden; padding: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
    body.from-collapsed aside { overflow: hidden; }
    main, #main { min-height: 0; overflow: hidden; }
    #main { display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .status { flex: 1; min-width: 0; font-size: 12px; color: #6b7481; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .from-toggle { position: sticky; top: 0; z-index: 2; width: 100%; height: 24px; padding: 0; border: 0; border-bottom: 1px solid #e3e7ee; border-radius: 0; background: #fff; color: #667080; }
    body.from-collapsed .from-toggle { height: 100vh; border-bottom: 0; }
    #froms { min-height: 0; overflow: auto; padding: 8px; }
    body.from-collapsed #fromSettings { display: none; }
    body.from-collapsed #froms { display: none; }
    .from-item { padding: 8px 6px; border-bottom: 1px solid #eef1f5; cursor: pointer; }
    .from-item:hover, .from-item.active { background: #f1f5fa; }
    .from-title { font-size: 13px; font-weight: 700; margin-top: 2px; }
    .from-line { font-size: 12px; line-height: 1.45; white-space: pre-wrap; margin-top: 3px; }
    .settings-bar { display: flex; align-items: center; min-height: 28px; padding: 4px 8px; background: #fff; border-bottom: 1px solid #e3e7ee; }
    .settings-toggle { width: 24px; height: 22px; padding: 0; border: 0; background: transparent; color: #596675; font-size: 15px; }
    .settings-panel { display: flex; gap: 10px; align-items: center; margin-left: 8px; color: #4b5565; font-size: 12px; }
    .settings-panel[hidden] { display: none; }
    .settings-panel input[type="date"] { height: 24px; padding: 2px 5px; font-size: 12px; }
    .settings-panel input[type="checkbox"] { width: 14px; height: 14px; vertical-align: -2px; }
    .branch-tabs { display: flex; gap: 0; overflow-x: auto; padding: 0 8px; background: #fff; border-bottom: 1px solid #d9dee7; }
    .branch-tabs button { height: 32px; white-space: nowrap; background: transparent; color: #313a46; border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 0 9px; font-size: 12px; }
    .branch-tabs button.common-rule { background: var(--common-rule-bg); color: #66523d; }
    .branch-tabs button.active { color: #111820; border-bottom-color: #111820; font-weight: 700; }
    .detail { display: grid; grid-template-columns: minmax(280px, 380px) minmax(540px, 1fr); min-height: 0; }
    .pane { overflow: auto; padding: 14px; }
    .pane.left { border-right: 1px solid #d9dee7; background: #fbfcfd; }
    .pane.right { background: #fff; }
    .meta { font-size: 12px; color: #626d7c; margin-bottom: 8px; }
    .script { font-size: 14px; line-height: 1.65; white-space: pre-wrap; }
    .shared-script { background: var(--shared-from-bg); padding: 4px 0; margin-bottom: 4px; }
    .script-line { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 8px; padding: 2px 0; }
    .script-body { min-width: 0; }
    .speaker { color: #5d6675; font-weight: 700; }
    .has-updated-script { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
    .updated-line .script-body { text-decoration: underline; text-decoration-thickness: 1.5px; text-underline-offset: 3px; }
    body.source-colors .source-human .script-body { color: #234c74; }
    body.source-colors .source-ai .script-body { color: #6a4274; }
    body.source-colors .source-ai_edited .script-body { color: #68562f; }
    body.source-colors .branch-tabs button.source-human { color: #234c74; }
    body.source-colors .branch-tabs button.source-ai { color: #6a4274; }
    body.source-colors .branch-tabs button.source-ai_edited { color: #68562f; }
    body.source-colors .branch-tabs button.active { border-bottom-color: currentColor; }
    .example-line { color: #8a5a00; }
    .example-line .speaker { color: #8a5a00; }
    .section-break { height: 10px; }
    .repeat-separator { margin: 14px 0 7px; padding-top: 8px; border-top: 1px solid #cfd7e2; color: #6a7483; font-size: 12px; font-weight: 700; }
    .notes { margin-top: 10px; padding: 8px 10px; border-left: 3px solid #d5aa42; background: #fff4c8; color: #3d321a; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
    .rule-meta { margin: 7px 0 9px; padding: 5px 7px; border: 1px solid #e1e6ee; background: #f7f8fa; color: #7a8492; font-size: 10px; line-height: 1.45; white-space: pre-wrap; }
    .transition { margin: 7px 0 9px; padding: 5px 7px; border: 1px solid #dfe5ee; background: #f7f9fb; font-size: 11px; line-height: 1.45; }
    .transition.game-over { border-color: #ebc0bd; background: #fff0ef; color: #a4372e; }
    .transition.stay { border-color: #bdd1ee; background: #eff6ff; color: #285f9f; }
    .transition.next { color: #3e4a59; }
    .transition.next button { height: auto; padding: 0; border: 0; background: transparent; color: #245f9f; font-size: inherit; text-align: left; text-decoration: underline; }
    .criteria { color: #8a5a00; white-space: pre-wrap; font-size: 13px; line-height: 1.55; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid #e4e8ef; }
    .context { color: #243141; background: var(--shared-from-bg); padding: 8px 10px; border-bottom: 0; }
    .comment-box { display: grid; gap: 6px; margin: 8px 0 12px; }
    .comment-toggle { width: 20px; height: 20px; border: 0; background: transparent; color: #6f7885; padding: 0; font-size: 15px; line-height: 1; }
    .comment-form { display: grid; gap: 6px; }
    .comment-form[hidden], .actions[hidden], .inputs[hidden], .judgment-edit[hidden] { display: none; }
    .cluster { border-top: 1px solid #eceff4; }
    .cluster-head { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 6px; align-items: center; padding: 7px 0; cursor: pointer; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .blue { background: #4c89d9; }
    .yellow { background: #d7a317; }
    .red { background: #d45a4c; }
    .cluster-text { font-size: 13px; line-height: 1.45; }
    .mark { color: #b64b3f; font-weight: 700; margin-left: 4px; }
    .inputs { display: grid; gap: 5px; padding: 0 0 8px 24px; }
    .input-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: start; gap: 4px; font-size: 13px; line-height: 1.45; }
    .input-row input[type="checkbox"] { width: 14px; height: 14px; margin: 2px 0 0; }
    .input-cell { min-width: 0; }
    .actions { position: sticky; bottom: 0; display: grid; gap: 7px; padding: 10px 0 0; background: linear-gradient(to top, #fff 85%, rgba(255,255,255,0)); border-top: 1px solid #e4e8ef; }
    .action-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .judgments { display: grid; gap: 3px; margin: 4px 0 6px; color: #5c6674; font-size: 12px; line-height: 1.45; }
    .judgment { display: grid; gap: 4px; white-space: pre-wrap; }
    .judgment-main { display: flex; gap: 6px; align-items: baseline; justify-content: space-between; }
    .judgment-text { min-width: 0; }
    .judgment-actions { display: flex; gap: 4px; flex: 0 0 auto; }
    .mini-button { height: auto; padding: 0 3px; border: 0; background: transparent; color: #5f6f83; font-size: 11px; text-decoration: underline; }
    .mini-button.danger { color: #a9473f; }
    .judgment-edit { display: grid; gap: 5px; }
    .judgment-edit textarea { width: 100%; min-height: 56px; }
    .empty { color: #687487; font-size: 13px; padding: 12px 0; }
    .trial-inputs { display: grid; gap: 5px; padding: 7px 0 8px; border-top: 1px solid #eceff4; }
    .trial-row { color: #243141; }
    .sim-fab { position: fixed; right: 18px; bottom: 18px; z-index: 10; width: 52px; height: 52px; min-width: 52px; padding: 0; border: 0; border-radius: 50%; background: #e7f0fb; color: #245f9f; box-shadow: 0 8px 22px rgba(36,95,159,0.22); font-size: 36px; line-height: 1; display: grid; place-items: center; transform: translateY(-1px); }
    .sim-fab:hover { background: #dbeaf9; }
    .sim-panel { position: fixed; right: 16px; bottom: 58px; z-index: 10; width: min(360px, calc(100vw - 32px)); display: grid; gap: 7px; padding: 10px; border: 1px solid #d9dee7; background: #fff; box-shadow: 0 10px 30px rgba(15,23,42,0.16); }
    .sim-panel[hidden] { display: none; }
    .sim-panel input { width: 100%; }
    .sim-result { min-height: 18px; color: #354050; font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
    .sim-history { display: grid; gap: 6px; max-height: 180px; overflow: auto; padding-right: 2px; }
    .sim-history-item { padding: 6px 7px; border: 1px solid #e3e7ee; background: #f8fafc; color: #354050; font-size: 12px; line-height: 1.45; white-space: pre-wrap; }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      body.from-collapsed .shell { grid-template-columns: 1fr; }
      aside { max-height: 34vh; border-right: 0; border-bottom: 1px solid #d9dee7; }
      body.from-collapsed aside { max-height: 28px; }
      body.from-collapsed .from-toggle { height: 28px; }
      .detail { grid-template-columns: 1fr; }
      .pane.left { border-right: 0; border-bottom: 1px solid #d9dee7; }
    }
  </style>
</head>
<body>
  <header>
    <h1 class="auth-control">会話分岐レビュー</h1>
    <input id="token" class="auth-control" type="password" placeholder="管理トークン" autocomplete="off">
    <input id="reviewer" class="auth-control" placeholder="名前">
    <button id="load" class="auth-control">読み込み</button>
    <button id="enterReview" class="auth-control ops-only ops-after-load secondary">監修画面へ</button>
    <div class="status" id="status">管理トークンを入れて読み込み</div>
  </header>
  <div class="shell">
    <aside id="fromPanel"><button id="fromToggle" class="from-toggle" type="button" title="from一覧をたたむ">‹</button><div id="fromSettings"></div><div id="froms"></div></aside>
    <main id="main"></main>
  </div>
  <script>
    const opsEnabled = new URLSearchParams(location.search).get('ops') === '1';
    if (opsEnabled) {
      document.body.classList.add('ops');
    }
    const state = {
      froms: [],
      selectedFrom: null,
      detail: null,
      selectedBranch: null,
      fromCollapsed: false,
      simulatorOpen: sessionStorage.getItem('talkBranchReviewSimulatorOpen') === '1',
      simulatorInput: '',
      simulatorResult: '',
      simulatorHistory: [],
      openClusterKeys: new Set(),
      settingsOpen: false,
      settings: {
        updatedSince: localStorage.getItem('talkBranchReviewUpdatedSince') || '',
        sourceColors: localStorage.getItem('talkBranchReviewSourceColors') === '1'
      }
    };
    const token = document.getElementById('token');
    const reviewer = document.getElementById('reviewer');
    const fromSettingsEl = document.getElementById('fromSettings');
    const fromsEl = document.getElementById('froms');
    const fromToggle = document.getElementById('fromToggle');
    const mainEl = document.getElementById('main');
    const statusEl = document.getElementById('status');
    const enterReviewBtn = document.getElementById('enterReview');

    token.value = sessionStorage.getItem('talkBranchReviewToken') || '';
    reviewer.value = localStorage.getItem('talkBranchReviewReviewer') || '';

    function authHeaders(extra = {}) {
      const value = token.value.trim();
      if (value) sessionStorage.setItem('talkBranchReviewToken', value);
      localStorage.setItem('talkBranchReviewReviewer', reviewer.value.trim());
      return { ...extra, authorization: 'Bearer ' + value };
    }

    function text(value) {
      return value == null ? '' : String(value);
    }

    function setStatus(value) {
      statusEl.textContent = value;
    }

    function applyReviewSettingsClass() {
      document.body.classList.toggle('source-colors', Boolean(state.settings.sourceColors));
    }

    applyReviewSettingsClass();

    function setSimulatorOpen(value) {
      state.simulatorOpen = Boolean(value);
      sessionStorage.setItem('talkBranchReviewSimulatorOpen', state.simulatorOpen ? '1' : '0');
    }

    function setFromCollapsed(value) {
      state.fromCollapsed = Boolean(value);
      document.body.classList.toggle('from-collapsed', state.fromCollapsed);
      fromToggle.textContent = state.fromCollapsed ? '›' : '‹';
      fromToggle.title = state.fromCollapsed ? 'from一覧を開く' : 'from一覧をたたむ';
    }

    function messageText(message) {
      if (!message) return '';
      return [message.body || '', message.attachment || ''].filter(Boolean).join(' ');
    }

    function cleanDate(value) {
      const textValue = text(value).trim();
      return /^\\d{4}-\\d{2}-\\d{2}$/.test(textValue) ? textValue : '';
    }

    function messageHasUpdated(message) {
      const since = cleanDate(state.settings.updatedSince);
      const updatedAt = cleanDate(message && message.updatedAt);
      return Boolean(since && updatedAt && updatedAt >= since);
    }

    function lineSource(message) {
      const value = text(message && message.source);
      return value === 'human' || value === 'ai' || value === 'ai_edited' ? value : '';
    }

    function sourceRank(source) {
      return source === 'ai' ? 4
        : source === 'ai_edited' ? 3
        : source === 'human' ? 1
        : 0;
    }

    function highestSource(messages) {
      let bestSource = '';
      let bestRank = 0;
      for (const message of messages || []) {
        const source = lineSource(message);
        const rank = sourceRank(source);
        if (rank > bestRank) {
          bestSource = source;
          bestRank = rank;
        }
      }
      return bestSource;
    }

    function branchSource(branch) {
      return highestSource([...(branch.nextMessages || []), ...(branch.repeatNextMessages || [])]);
    }

    function branchHasUpdatedMessages(detail, branch) {
      return [
        ...(detail.incomingMessages || []),
        branch.fromLast,
        ...(branch.nextMessages || []),
        ...(branch.repeatNextMessages || [])
      ].some(messageHasUpdated);
    }

    function fromItemHasUpdatedMessages(item) {
      return [...(item.lineMeta || []), item.lastMessage].some(messageHasUpdated);
    }

    async function fetchJson(url, options = {}) {
      const res = await fetch(url, { ...options, headers: authHeaders(options.headers || {}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    function scrollActiveFromIntoView() {
      requestAnimationFrame(() => {
        fromsEl.querySelector('.from-item.active')?.scrollIntoView({ block: 'nearest' });
      });
    }

    function scrollActiveBranchIntoView(tabs) {
      requestAnimationFrame(() => {
        tabs.querySelector('button.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
      });
    }

    function scrollSimulatorHistoryToBottom() {
      requestAnimationFrame(() => {
        const history = document.querySelector('.sim-history');
        if (history) {
          history.scrollTop = history.scrollHeight;
        }
      });
    }

    function renderFroms(options = {}) {
      fromsEl.textContent = '';
      for (const item of state.froms) {
        const node = document.createElement('div');
        node.className = 'from-item' + (state.selectedFrom && state.selectedFrom.talkId === item.talkId && state.selectedFrom.fromId === item.fromId ? ' active' : '');
        const mark = item.hasComment ? ' *' : '';
        node.innerHTML =
          '<div class="from-title"></div><div class="from-line"></div>';
        const title = node.querySelector('.from-title');
        title.textContent = item.label + mark;
        if (fromItemHasUpdatedMessages(item)) {
          title.classList.add('has-updated-script');
        }
        node.querySelector('.from-line').textContent = messageText(item.lastMessage);
        node.addEventListener('click', () => loadDetail(item));
        fromsEl.appendChild(node);
      }
      if (options.scroll !== false) {
        scrollActiveFromIntoView();
      }
    }

    function renderFromSettings() {
      fromSettingsEl.textContent = '';
      fromSettingsEl.appendChild(renderReviewSettings());
    }

    async function loadFroms() {
      setStatus('読み込み中');
      const data = await fetchJson('/api/admin/talk-branch-review/froms');
      state.froms = data.items || [];
      if (opsEnabled) {
        document.body.classList.add('ops-loaded');
      } else {
        document.body.classList.add('ready');
      }
      setFromCollapsed(false);
      renderFromSettings();
      renderFroms();
      setStatus(opsEnabled ? '集計または監修画面へ' : 'fromを選択してください');
    }

    function selectDefaultBranch(detail) {
      return detail.branches.find((branch) => branch.isDefault && !branch.isCommon) || detail.branches[0] || null;
    }

    async function loadDetail(item, options = {}) {
      const preferredBranchId = options.preferredBranchId || '';
      const sameFrom = state.selectedFrom && state.selectedFrom.talkId === item.talkId && state.selectedFrom.fromId === item.fromId;
      if (!sameFrom) {
        state.openClusterKeys.clear();
      }
      state.selectedFrom = item;
      renderFroms();
      setStatus('詳細読み込み中');
      const params = new URLSearchParams({ talkId: item.talkId, fromId: item.fromId });
      const data = await fetchJson('/api/admin/talk-branch-review/from?' + params.toString());
      state.detail = data.detail;
      const fromItem = state.froms.find((candidate) => candidate.talkId === item.talkId && candidate.fromId === item.fromId);
      if (fromItem) {
        fromItem.hasComment = Boolean((data.detail.judgments || []).length);
        state.selectedFrom = fromItem;
        renderFroms();
      }
      state.selectedBranch = preferredBranchId
        ? data.detail.branches.find((branch) => branch.ruleId === preferredBranchId) || selectDefaultBranch(data.detail)
        : selectDefaultBranch(data.detail);
      renderDetail();
      setStatus(state.selectedFrom.label);
    }

    function renderBranchTabs(detail) {
      const tabs = document.createElement('div');
      tabs.className = 'branch-tabs';
      for (const branch of detail.branches) {
        const button = document.createElement('button');
        button.type = 'button';
        const source = branchSource(branch);
        const sourceClass = source ? 'source-' + source : '';
        button.className = [
          branch.isCommon ? 'common-rule' : '',
          state.selectedBranch && state.selectedBranch.ruleId === branch.ruleId ? 'active' : '',
          sourceClass
        ].filter(Boolean).join(' ');
        if (branchHasUpdatedMessages(detail, branch)) {
          button.classList.add('has-updated-script');
        }
        const mark = branchHasJudgment(branch) ? ' ＊' : '';
        button.textContent = branch.label + mark + '（' + (branch.inputCount || 0) + '）';
        button.addEventListener('click', () => {
          state.selectedBranch = branch;
          state.simulatorResult = '';
          renderDetail();
        });
        tabs.appendChild(button);
      }
      return tabs;
    }

    function branchHasJudgment(branch) {
      return Boolean((branch.judgments || []).length);
    }

    function appendScriptLine(parent, speaker, body, className = '', meta = null) {
      if (!body) return;
      const row = document.createElement('div');
      const source = meta ? lineSource(meta) : '';
      const sourceClass = source ? 'source-' + source : '';
      row.className = ['script-line', className, sourceClass, messageHasUpdated(meta) ? 'updated-line' : ''].filter(Boolean).join(' ');
      const s = document.createElement('div');
      s.className = 'speaker';
      s.textContent = speaker;
      const b = document.createElement('div');
      b.className = 'script-body';
      b.textContent = body;
      row.append(s, b);
      parent.appendChild(row);
    }

    function ruleMeta(textValue) {
      const node = document.createElement('div');
      node.className = 'rule-meta';
      node.textContent = textValue;
      return node;
    }

    function selectFromById(talkId, fromId) {
      const item = state.froms.find((candidate) => candidate.talkId === talkId && candidate.fromId === fromId);
      if (!item) {
        setStatus('次のfromが一覧にありません');
        return;
      }
      loadDetail(item).catch((error) => setStatus(error.message));
    }

    function transitionNode(detail, transition) {
      if (!transition) return null;
      const node = document.createElement('div');
      node.className = 'transition ' + (transition.kind || '');
      if (transition.kind === 'next' && transition.nextFromId) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '→ ' + transition.label;
        button.addEventListener('click', () => selectFromById(detail.talkId, transition.nextFromId));
        node.appendChild(button);
      } else {
        node.textContent = transition.label;
      }
      return node;
    }

    function renderLeft(detail, branch) {
      const pane = document.createElement('section');
      pane.className = 'pane left';
      const script = document.createElement('div');
      script.className = 'script';
      if ((detail.incomingMessages || []).length) {
        const shared = document.createElement('div');
        shared.className = 'shared-script';
        for (const message of detail.incomingMessages || []) {
          appendScriptLine(shared, message.speaker, messageText(message), '', message);
        }
        script.appendChild(shared);
      }
      appendScriptLine(script, 'あなた', branch.example || '（exampleなし）', 'example-line');
      for (const message of branch.nextMessages || []) {
        appendScriptLine(script, message.speaker, messageText(message), '', message);
      }
      if (branch.repeatNextMessages && branch.repeatNextMessages.length) {
        const separator = document.createElement('div');
        separator.className = 'repeat-separator';
        separator.textContent = '2回目';
        script.appendChild(separator);
        for (const message of branch.repeatNextMessages || []) {
          appendScriptLine(script, message.speaker, messageText(message), '', message);
        }
      }
      pane.appendChild(script);
      pane.appendChild(commentBox('セリフへの指示', 'branch', branch));
      if (branch.match) {
        pane.appendChild(ruleMeta('match: ' + branch.match));
      }
      if (branch.stateUpdates && branch.stateUpdates.length) {
        pane.appendChild(ruleMeta('set: ' + branch.stateUpdates.join('\\n')));
      }
      const transition = transitionNode(detail, branch.transition);
      if (transition) {
        pane.appendChild(transition);
      }
      if (branch.notes) {
        const notes = document.createElement('div');
        notes.className = 'notes';
        notes.textContent = branch.notes;
        pane.appendChild(notes);
      }
      return pane;
    }

    function judgmentText(item) {
      const head = item.judgment === 'move_to_existing' ? '別分岐へ' + judgmentTargetLabel(item)
        : item.judgment === 'needs_new_branch' ? '新規分岐'
        : item.judgment === 'hold' ? '保留'
        : 'コメント';
      const body = item.comment || item.newBranchNote || '';
      return body ? head + ': ' + body : head;
    }

    function judgmentTargetLabel(item) {
      if (!item.expectedRuleId || !state.detail) {
        return '';
      }
      const branch = state.detail.branches.find((candidate) => candidate.ruleId === item.expectedRuleId);
      return ' → ' + (branch ? branch.label : item.expectedRuleId);
    }

    function editableJudgmentText(item) {
      return item.judgment === 'needs_new_branch' && item.newBranchNote ? item.newBranchNote : (item.comment || item.newBranchNote || '');
    }

    function renderJudgments(items) {
      const list = document.createElement('div');
      list.className = 'judgments';
      for (const item of items || []) {
        const row = document.createElement('div');
        row.className = 'judgment';
        const main = document.createElement('div');
        main.className = 'judgment-main';
        const textNode = document.createElement('span');
        textNode.className = 'judgment-text';
        textNode.textContent = '＊ ' + judgmentText(item);
        const actions = document.createElement('span');
        actions.className = 'judgment-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'mini-button';
        edit.textContent = '編集';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mini-button danger';
        remove.textContent = '削除';
        actions.append(edit, remove);
        main.append(textNode, actions);
        const form = document.createElement('div');
        form.className = 'judgment-edit';
        form.hidden = !item.__editing;
        const area = document.createElement('textarea');
        area.rows = 2;
        area.value = editableJudgmentText(item);
        const formActions = document.createElement('div');
        formActions.className = 'action-row';
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = '保存';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'secondary';
        cancel.textContent = '閉じる';
        formActions.append(save, cancel);
        form.append(area, formActions);
        edit.addEventListener('click', () => {
          item.__editing = true;
          renderDetail();
        });
        cancel.addEventListener('click', () => {
          item.__editing = false;
          renderDetail();
        });
        save.addEventListener('click', () => updateJudgment(item, area.value));
        remove.addEventListener('click', () => {
          if (confirm('この指示を削除しますか？')) {
            dismissJudgment(item);
          }
        });
        row.append(main, form);
        list.appendChild(row);
      }
      return list;
    }

    function commentBox(label, scope, branch) {
      const box = document.createElement('div');
      box.className = 'comment-box';
      const existing = (branch.judgments || []).filter((item) => item.scope === scope);
      if (existing.length) {
        box.appendChild(renderJudgments(existing));
      }
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'comment-toggle';
      toggle.textContent = '＋';
      toggle.title = label;
      const area = document.createElement('textarea');
      area.rows = 3;
      area.placeholder = label;
      const form = document.createElement('div');
      form.className = 'comment-form';
      form.hidden = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'コメント保存';
      button.addEventListener('click', async () => {
        await saveJudgment({
          scope,
          judgment: 'comment_only',
          actualRuleId: branch.ruleId,
          comment: area.value
        });
        area.value = '';
        form.hidden = true;
      });
      toggle.addEventListener('click', () => {
        form.hidden = !form.hidden;
        if (!form.hidden) {
          area.focus();
        }
      });
      form.append(area, button);
      box.append(toggle, form);
      return box;
    }

    function fitClass(fit) {
      return fit === 'blue' || fit === 'red' ? fit : 'yellow';
    }

    function inputJudgmentsForCluster(cluster, branch) {
      const ids = new Set(cluster.sourceEventIds || []);
      return (branch.judgments || []).filter((item) => (item.sourceEventIds || []).some((id) => ids.has(id)));
    }

    function inputJudgmentsForEvent(eventId, branch) {
      return (branch.judgments || []).filter((item) => (item.sourceEventIds || []).includes(eventId));
    }

    function clusterStateKey(cluster, branch) {
      const detail = state.detail || {};
      return [detail.talkId || '', detail.fromId || '', branch.ruleId || '', cluster.id || cluster.representativeInput || ''].join('::');
    }

    function renderCluster(cluster, branch) {
      const wrap = document.createElement('div');
      wrap.className = 'cluster';
      const head = document.createElement('div');
      head.className = 'cluster-head';
      head.innerHTML = '<span class="dot"></span><span class="cluster-text"></span>';
      head.querySelector('.dot').className = 'dot ' + fitClass(cluster.fit);
      const clusterJudgments = inputJudgmentsForCluster(cluster, branch);
      head.querySelector('.cluster-text').textContent = cluster.representativeInput + '（' + cluster.inputCount + '）' + (clusterJudgments.length ? ' ＊' : '');
      const inputs = document.createElement('div');
      inputs.className = 'inputs';
      const clusterKey = clusterStateKey(cluster, branch);
      inputs.hidden = !state.openClusterKeys.has(clusterKey);
      for (const item of cluster.inputs || []) {
        const row = document.createElement('label');
        row.className = 'input-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.id;
        checkbox.dataset.inputText = item.input;
        row.appendChild(checkbox);
        const cell = document.createElement('div');
        cell.className = 'input-cell';
        const span = document.createElement('span');
        span.textContent = item.input;
        cell.appendChild(span);
        const eventJudgments = inputJudgmentsForEvent(item.id, branch);
        if (eventJudgments.length) {
          cell.appendChild(renderJudgments(eventJudgments));
        }
        row.appendChild(cell);
        inputs.appendChild(row);
      }
      head.addEventListener('click', () => {
        inputs.hidden = !inputs.hidden;
        if (inputs.hidden) {
          state.openClusterKeys.delete(clusterKey);
        } else {
          state.openClusterKeys.add(clusterKey);
        }
      });
      wrap.append(head, inputs);
      return wrap;
    }

    function selectedEventIds(root) {
      return [...root.querySelectorAll('input[type="checkbox"]:checked')].map((item) => item.value);
    }

    function selectedTrialInputIds(root) {
      return [...root.querySelectorAll('.trial-row input[type="checkbox"]:checked')].map((item) => item.value);
    }

    function renderRight(detail, branch) {
      const pane = document.createElement('section');
      pane.className = 'pane right';
      const context = document.createElement('div');
      context.className = 'criteria context';
      context.textContent = detail.context || '';
      pane.appendChild(context);
      if (branch.cond) {
        pane.appendChild(ruleMeta('cond: ' + branch.cond));
      }
      const criteria = document.createElement('div');
      criteria.className = 'criteria';
      criteria.textContent = branch.criteria || '';
      pane.appendChild(criteria);
      pane.appendChild(commentBox('分類条件コメント', 'criteria', branch));

      const clustersRoot = document.createElement('div');
      if (branch.trialInputs && branch.trialInputs.length) {
        const trials = document.createElement('div');
        trials.className = 'trial-inputs';
        for (const item of branch.trialInputs) {
          const row = document.createElement('label');
          row.className = 'input-row trial-row';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = item.id;
          checkbox.dataset.inputText = item.input;
          const cell = document.createElement('div');
          cell.className = 'input-cell';
          const span = document.createElement('span');
          span.textContent = item.input;
          cell.appendChild(span);
          const eventJudgments = inputJudgmentsForEvent(item.id, branch);
          if (eventJudgments.length) {
            cell.appendChild(renderJudgments(eventJudgments));
          }
          row.append(checkbox, cell);
          trials.appendChild(row);
        }
        clustersRoot.appendChild(trials);
      }
      if ((!branch.clusters || !branch.clusters.length) && (!branch.trialInputs || !branch.trialInputs.length)) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '入力集計はまだありません。';
        clustersRoot.appendChild(empty);
      } else {
        for (const cluster of branch.clusters) {
          clustersRoot.appendChild(renderCluster(cluster, branch));
        }
      }
      pane.appendChild(clustersRoot);

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.hidden = true;
      const comment = document.createElement('textarea');
      comment.rows = 3;
      comment.placeholder = '必要ならコメント';
      const select = document.createElement('select');
      for (const candidate of detail.branches) {
        const option = document.createElement('option');
        option.value = candidate.ruleId;
        option.textContent = candidate.label;
        select.appendChild(option);
      }
      const row = document.createElement('div');
      row.className = 'action-row';
      const move = document.createElement('button');
      move.type = 'button';
      move.textContent = '別分岐へ';
      move.addEventListener('click', () => saveInputSelection(pane, branch, 'move_to_existing', comment.value, select.value));
      const create = document.createElement('button');
      create.type = 'button';
      create.textContent = '新規分岐';
      create.addEventListener('click', () => saveInputSelection(pane, branch, 'needs_new_branch', comment.value, ''));
      const hold = document.createElement('button');
      hold.type = 'button';
      hold.textContent = '保留';
      hold.addEventListener('click', () => saveInputSelection(pane, branch, 'hold', comment.value, ''));
      const memo = document.createElement('button');
      memo.type = 'button';
      memo.textContent = 'コメント';
      memo.addEventListener('click', () => saveInputSelection(pane, branch, 'comment_only', comment.value, ''));
      const deleteTrial = document.createElement('button');
      deleteTrial.type = 'button';
      deleteTrial.className = 'danger';
      deleteTrial.textContent = '試行入力を削除';
      deleteTrial.addEventListener('click', () => deleteSelectedTrialInputs(pane));
      row.append(select, move, create, hold, memo, deleteTrial);
      actions.append(comment, row);
      pane.appendChild(actions);
      pane.addEventListener('change', (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.type === 'checkbox') {
          actions.hidden = selectedEventIds(pane).length === 0;
        }
      });
      return pane;
    }

    function renderSimulator(detail, branch) {
      const wrap = document.createElement('div');
      const fab = document.createElement('button');
      fab.type = 'button';
      fab.className = 'sim-fab';
      fab.textContent = '✉';
      fab.title = '入力を試す';
      const panel = document.createElement('div');
      panel.className = 'sim-panel';
      panel.hidden = !state.simulatorOpen;
      const input = document.createElement('input');
      input.placeholder = 'メッセージを入力';
      input.value = state.simulatorInput;
      let isComposing = false;
      const row = document.createElement('div');
      row.className = 'action-row';
      const send = document.createElement('button');
      send.type = 'button';
      send.textContent = '判定';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'secondary';
      close.textContent = '閉じる';
      const result = document.createElement('div');
      result.className = 'sim-result';
      result.textContent = state.simulatorResult;
      const history = document.createElement('div');
      history.className = 'sim-history';
      for (const item of state.simulatorHistory) {
        const historyItem = document.createElement('div');
        historyItem.className = 'sim-history-item';
        historyItem.textContent = item;
        history.appendChild(historyItem);
      }
      scrollSimulatorHistoryToBottom();
      input.addEventListener('input', () => {
        state.simulatorInput = input.value;
      });
      input.addEventListener('compositionstart', () => {
        isComposing = true;
      });
      input.addEventListener('compositionend', () => {
        isComposing = false;
      });
      fab.addEventListener('click', () => {
        setSimulatorOpen(!state.simulatorOpen);
        renderDetail();
      });
      close.addEventListener('click', () => {
        setSimulatorOpen(false);
        renderDetail();
      });
      function matchResultText(match, hasMatchSpec) {
        if (!hasMatchSpec) {
          return '';
        }
        const entries = Object.entries(match || {}).filter(([, value]) => value != null && String(value) !== '');
        if (!entries.length) {
          return '\\nmatch: （抽出なし）';
        }
        return '\\nmatch: ' + entries.map(([key, value]) => key + '=' + String(value)).join(', ');
      }
      async function submitSimulation() {
        if (send.disabled) {
          return;
        }
        const message = input.value.trim();
        if (!message) {
          state.simulatorResult = '入力してください';
          result.textContent = state.simulatorResult;
          return;
        }
        send.disabled = true;
        result.textContent = '判定中';
        try {
          const data = await fetchJson('/api/admin/talk-branch-review/simulate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              talkId: detail.talkId,
              fromId: detail.fromId,
              targetRuleId: branch.ruleId,
              message
            })
          });
          const selected = data.result || {};
          const mode = selected.mode && selected.mode !== 'normal' ? ' / ' + selected.mode : '';
          const condNote = selected.targetCondSatisfied === false ? '\\ncond設定を自動生成しきれていません' : '';
          const preset = selected.condPreset && selected.condPreset.length ? '\\n' + selected.condPreset.join('\\n') : '';
          const selectedBranch = detail.branches.find((candidate) => candidate.ruleId === selected.selectedRuleId);
          const resultText =
            '→ ' + (selected.label || selected.selectedRuleId || '') + mode +
            matchResultText(selected.match, Boolean(selectedBranch && selectedBranch.match)) +
            condNote +
            preset;
          state.simulatorResult = '判定しました';
          state.simulatorHistory = [
            ...state.simulatorHistory,
            message + '\\n' + resultText
          ].slice(-20);
          if (selectedBranch) {
            if (selected.event && selected.event.id) {
              selectedBranch.trialInputs = [
                selected.event,
                ...(selectedBranch.trialInputs || []).filter((item) => item.id !== selected.event.id)
              ];
            }
            state.selectedBranch = selectedBranch;
            renderDetail();
          } else {
            renderDetail();
          }
        } catch (error) {
          state.simulatorResult = error.message;
          result.textContent = state.simulatorResult;
        } finally {
          send.disabled = false;
        }
      }
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          if (isComposing || event.isComposing || event.keyCode === 229) {
            return;
          }
          event.preventDefault();
          submitSimulation();
        }
      });
      send.addEventListener('click', submitSimulation);
      row.append(send, close);
      panel.append(history, result, input, row);
      wrap.append(fab, panel);
      return wrap;
    }

    function renderReviewSettings() {
      const bar = document.createElement('div');
      bar.className = 'settings-bar';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'settings-toggle';
      toggle.textContent = '⚙';
      toggle.title = '表示設定';
      const panel = document.createElement('div');
      panel.className = 'settings-panel';
      panel.hidden = !state.settingsOpen;
      const dateLabel = document.createElement('label');
      dateLabel.textContent = '更新日 ';
      const date = document.createElement('input');
      date.type = 'date';
      date.value = cleanDate(state.settings.updatedSince);
      dateLabel.appendChild(date);
      const sourceLabel = document.createElement('label');
      const source = document.createElement('input');
      source.type = 'checkbox';
      source.checked = Boolean(state.settings.sourceColors);
      sourceLabel.append(source, document.createTextNode(' 由来色'));
      toggle.addEventListener('click', () => {
        state.settingsOpen = !state.settingsOpen;
        renderFromSettings();
      });
      date.addEventListener('change', () => {
        state.settings.updatedSince = cleanDate(date.value);
        localStorage.setItem('talkBranchReviewUpdatedSince', state.settings.updatedSince);
        renderFroms({ scroll: false });
        renderDetail();
      });
      source.addEventListener('change', () => {
        state.settings.sourceColors = source.checked;
        localStorage.setItem('talkBranchReviewSourceColors', state.settings.sourceColors ? '1' : '0');
        applyReviewSettingsClass();
        renderDetail();
      });
      panel.append(dateLabel, sourceLabel);
      bar.append(toggle, panel);
      return bar;
    }

    function renderDetail() {
      mainEl.textContent = '';
      const detail = state.detail;
      const branch = state.selectedBranch;
      if (!detail || !branch) return;
      const tabs = renderBranchTabs(detail);
      mainEl.appendChild(tabs);
      scrollActiveBranchIntoView(tabs);
      const grid = document.createElement('div');
      grid.className = 'detail';
      grid.append(renderLeft(detail, branch), renderRight(detail, branch));
      mainEl.appendChild(grid);
      mainEl.appendChild(renderSimulator(detail, branch));
    }

    async function saveJudgment(input) {
      const detail = state.detail;
      if (!detail) return;
      const branchId = state.selectedBranch ? state.selectedBranch.ruleId : '';
      await fetchJson('/api/admin/talk-branch-review/judgments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          talkId: detail.talkId,
          fromId: detail.fromId,
          reviewerLabel: reviewer.value.trim(),
          ...input
        })
      });
      setStatus('保存しました');
      await loadDetail(state.selectedFrom, { preferredBranchId: branchId, keepSimulator: true });
    }

    async function updateJudgment(item, comment) {
      const branchId = state.selectedBranch ? state.selectedBranch.ruleId : '';
      await fetchJson('/api/admin/talk-branch-review/judgments/' + encodeURIComponent(item.id), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          talkId: item.talkId,
          fromId: item.fromId,
          comment,
          newBranchNote: item.judgment === 'needs_new_branch' ? comment : (item.newBranchNote || ''),
          reviewerLabel: reviewer.value.trim()
        })
      });
      setStatus('更新しました');
      await loadDetail(state.selectedFrom, { preferredBranchId: branchId, keepSimulator: true });
    }

    async function dismissJudgment(item) {
      const branchId = state.selectedBranch ? state.selectedBranch.ruleId : '';
      await fetchJson('/api/admin/talk-branch-review/judgments/' + encodeURIComponent(item.id) + '/dismiss', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ talkId: item.talkId, fromId: item.fromId })
      });
      setStatus('削除しました');
      await loadDetail(state.selectedFrom, { preferredBranchId: branchId, keepSimulator: true });
    }

    async function deleteSelectedTrialInputs(root) {
      const detail = state.detail;
      const ids = selectedTrialInputIds(root);
      if (!detail || !ids.length) {
        setStatus('試行入力を選択してください');
        return;
      }
      const branchId = state.selectedBranch ? state.selectedBranch.ruleId : '';
      await fetchJson('/api/admin/talk-branch-review/trial-inputs/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          talkId: detail.talkId,
          fromId: detail.fromId,
          ids
        })
      });
      setStatus('試行入力を削除しました');
      await loadDetail(state.selectedFrom, { preferredBranchId: branchId, keepSimulator: true });
    }

    async function saveInputSelection(root, branch, judgment, comment, expectedRuleId) {
      const ids = selectedEventIds(root);
      if (!ids.length) {
        setStatus('入力を選択してください');
        return;
      }
      await saveJudgment({
        scope: ids.length === 1 ? 'input' : 'input_selection',
        sourceEventIds: ids,
        actualRuleId: branch.ruleId,
        expectedRuleId,
        judgment,
        comment,
        newBranchNote: judgment === 'needs_new_branch' ? comment : ''
      });
    }

    fromToggle.addEventListener('click', () => {
      setFromCollapsed(!state.fromCollapsed);
    });
    enterReviewBtn.addEventListener('click', () => {
      document.body.classList.add('ready');
      setStatus('fromを選択してください');
    });
    document.getElementById('load').addEventListener('click', () => {
      loadFroms().catch((error) => setStatus(error.message));
    });
  </script>
</body>
</html>`;
}
