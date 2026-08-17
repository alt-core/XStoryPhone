export function playerInputReviewPageHtml() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>入力レビュー</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f8fa; color: #17202a; }
    header { padding: 20px 24px 12px; border-bottom: 1px solid #d8dee8; background: #fff; }
    h1 { margin: 0; font-size: 20px; font-weight: 700; }
    main { padding: 18px 24px 28px; display: grid; gap: 16px; }
    form { display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 10px; align-items: end; }
    label { display: grid; gap: 4px; font-size: 12px; font-weight: 650; color: #485568; }
    input, select, button { min-height: 34px; border: 1px solid #c9d1de; border-radius: 6px; padding: 6px 8px; font: inherit; background: #fff; }
    button { cursor: pointer; background: #17202a; color: #fff; border-color: #17202a; font-weight: 700; }
    button.secondary { background: #fff; color: #17202a; }
    .wide { grid-column: span 2; }
    .panel { background: #fff; border: 1px solid #d8dee8; border-radius: 8px; overflow: hidden; }
    .status { padding: 10px 12px; border-bottom: 1px solid #e5e9f0; color: #485568; font-size: 13px; }
    .table-wrap { overflow: auto; max-height: calc(100vh - 360px); }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 13px; }
    th, td { border-bottom: 1px solid #edf0f5; padding: 8px; vertical-align: top; text-align: left; }
    th { position: sticky; top: 0; background: #f2f4f8; font-size: 12px; color: #485568; }
    tr { cursor: pointer; }
    tr:hover td { background: #f8fbff; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .text { max-height: 4.6em; overflow: hidden; white-space: pre-wrap; }
    .detail { margin: 0; padding: 12px; white-space: pre-wrap; overflow: auto; max-height: 260px; font-size: 12px; }
    @media (max-width: 900px) { form { grid-template-columns: repeat(2, minmax(120px, 1fr)); } .wide { grid-column: span 2; } }
  </style>
</head>
<body>
  <header><h1>入力レビュー</h1></header>
  <main>
    <form id="filters">
      <label class="wide">管理トークン<input id="secret" type="password" autocomplete="off"></label>
      <label>種別<select id="eventType"><option value="">すべて</option><option value="search">検索</option><option value="talk_send">会話</option></select></label>
      <label>player ID<input id="playerId"></label>
      <label>会話ID<input id="talkId"></label>
      <label>検索<input id="q"></label>
      <label>件数<input id="limit" type="number" min="1" max="500" value="100"></label>
      <button type="submit">読み込み</button>
      <button type="button" class="secondary" id="csv">CSV</button>
    </form>
    <section class="panel">
      <div class="status" id="status">未読み込み</div>
      <div class="table-wrap"><table>
        <thead><tr><th style="width:150px">時刻</th><th style="width:150px">player</th><th style="width:70px">種別</th><th style="width:90px">状態</th><th>入力</th><th>返答</th></tr></thead>
        <tbody id="rows"></tbody>
      </table></div>
    </section>
    <section class="panel"><pre class="detail" id="detail">行を選択すると詳細を表示します。</pre></section>
  </main>
  <script>
    const form = document.getElementById('filters');
    const rows = document.getElementById('rows');
    const statusEl = document.getElementById('status');
    const detail = document.getElementById('detail');
    const secret = document.getElementById('secret');
    const controls = ['eventType', 'playerId', 'talkId', 'q', 'limit'].reduce((map, id) => {
      map[id] = document.getElementById(id);
      return map;
    }, {});

    function params() {
      const value = new URLSearchParams();
      for (const id of Object.keys(controls)) {
        const current = controls[id].value.trim();
        if (current) value.set(id, current);
      }
      return value;
    }

    function responseText(item) {
      const snapshot = item.responseSnapshot || {};
      if (item.eventType === 'search') {
        return [snapshot.responseId || '', Number.isFinite(snapshot.resultCount) ? snapshot.resultCount + '件' : ''].filter(Boolean).join(' / ');
      }
      const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      return messages.map((message) => message && message.body || '').filter(Boolean).join('\\n');
    }

    function setText(node, value) {
      node.textContent = value == null ? '' : String(value);
    }

    function render(items) {
      rows.textContent = '';
      for (const item of items) {
        const tr = document.createElement('tr');
        const state = item.status + (item.matched ? ' / 一致' : ' / 不一致');
        const response = responseText(item);
        const values = [item.occurredAt, item.playerId, item.eventType === 'search' ? '検索' : '会話', state, item.userInput, response];
        for (const [index, value] of values.entries()) {
          const td = document.createElement('td');
          td.className = index >= 4 ? 'text' : 'clip mono';
          setText(td, value);
          tr.appendChild(td);
        }
        tr.addEventListener('click', () => setText(detail, JSON.stringify(item, null, 2)));
        rows.appendChild(tr);
      }
      statusEl.textContent = items.length + '件';
    }

    async function request(path) {
      const response = await fetch(path, { headers: { 'x-admin-review-secret': secret.value.trim() } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response;
    }

    async function loadJson() {
      const response = await request('/api/admin/player-input-review/events?' + params().toString());
      const data = await response.json();
      render(data.items || []);
    }

    async function loadCsv() {
      const response = await request('/api/admin/player-input-review.csv?' + params().toString());
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'xstoryphone-inputs.csv';
      anchor.click();
      URL.revokeObjectURL(url);
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      statusEl.textContent = '読み込み中';
      try { await loadJson(); } catch (error) { statusEl.textContent = error.message; }
    });
    document.getElementById('csv').addEventListener('click', async () => {
      statusEl.textContent = 'CSV作成中';
      try { await loadCsv(); statusEl.textContent = 'CSVを作成しました'; } catch (error) { statusEl.textContent = error.message; }
    });
  </script>
</body>
</html>`;
}
