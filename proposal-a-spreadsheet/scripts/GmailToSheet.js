/**
 * 提案① スプシ版：Gmail → RAW_EMAILS シート取り込み
 * Apps Script に貼り付けて実行。Config.js を同じプロジェクトに追加すること。
 */
function fetchGmailToRawEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RAW_EMAILS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAMES.RAW_EMAILS);
    const headers = ['id', 'message_id', 'received_at', 'from', 'to', 'subject', 'body_text', 'classification', 'processing_status', 'gmail_thread_url'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }

  const threads = GmailApp.search(CONFIG.SEARCH_QUERY, 0, CONFIG.FETCH_LIMIT);
  const existingIds = getExistingMessageIds(sheet);
  const rows = [];
  const now = new Date().toISOString();

  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      const id = msg.getId();
      if (existingIds.has(id)) continue;

      const body = msg.getPlainBody() || '';
      const bodyText = body.length > CONFIG.BODY_MAX_LENGTH
        ? body.substring(0, CONFIG.BODY_MAX_LENGTH) + '\n…(省略)'
        : body;

      rows.push([
        id + '_' + now,
        id,
        msg.getDate() ? msg.getDate().toISOString() : '',
        msg.getFrom() || '',
        msg.getTo() || '',
        msg.getSubject() || '',
        bodyText,
        '',
        'pending',
        thread.getPermalink() || ''
      ]);
      existingIds.add(id);
    }
  }

  if (rows.length === 0) return;
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow + 1, 1, lastRow + rows.length, 10).setValues(rows);
}

function getExistingMessageIds(sheet) {
  const col = CONFIG.RAW_EMAILS_COLS.MESSAGE_ID + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();
  const ids = sheet.getRange(2, col, lastRow, col).getValues().flat().filter(Boolean);
  return new Set(ids);
}
