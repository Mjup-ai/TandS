/**
 * 提案① スプシ版：RAW_EMAILS の pending を分類・抽出して TALENTS / PROJECTS に追記
 * AI API は未実装。ここでは「分類だけモック」で TALENTS に仮データを1件入れる例。
 * 本番では OpenAI 等を UrlFetchApp で呼び、schemas/talent-extract.json 形式で返す。
 */
function processPendingEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName(CONFIG.SHEET_NAMES.RAW_EMAILS);
  if (!rawSheet) return;

  const lastRow = rawSheet.getLastRow();
  if (lastRow < 2) return;

  const statusCol = CONFIG.RAW_EMAILS_COLS.PROCESSING_STATUS + 1;
  const data = rawSheet.getRange(2, 1, lastRow, 10).getValues();

  for (let i = 0; i < data.length; i++) {
    if (data[i][CONFIG.RAW_EMAILS_COLS.PROCESSING_STATUS] !== 'pending') continue;

    const rowIndex = i + 2;
    const subject = data[i][CONFIG.RAW_EMAILS_COLS.SUBJECT] || '';
    const bodyText = data[i][CONFIG.RAW_EMAILS_COLS.BODY_TEXT] || '';
    const emailId = data[i][CONFIG.RAW_EMAILS_COLS.ID];

    // モック：件名に「人材」「要員」があれば talent、それ以外は project とする
    const classification = /人材|要員|フリーランス/i.test(subject + bodyText.substring(0, 200)) ? 'talent' : 'project';

    if (classification === 'talent') {
      appendTalentRow(ss, { emailId, subject, bodyText });
    } else {
      appendProjectRow(ss, { emailId, subject, bodyText });
    }

    rawSheet.getRange(rowIndex, statusCol).setValue('extracted');
    SpreadsheetApp.flush();
  }
}

function appendTalentRow(ss, payload) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.TALENTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAMES.TALENTS);
    const headers = ['id', 'source_email_id', 'hope_price_min', 'hope_price_max', 'age', 'employment_type', 'nearest_station', 'skills', 'availability', 'start_available_date', 'extracted_at'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  const id = 'T_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 8);
  const row = [id, payload.emailId, '', '', '', '', '', '', '', '', new Date().toISOString()];
  sheet.appendRow(row);
}

function appendProjectRow(ss, payload) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAMES.PROJECTS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAMES.PROJECTS);
    const headers = ['id', 'source_email_id', 'price_min', 'price_max', 'required_skills', 'work_location', 'remote_ok', 'start_period', 'extracted_at'];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  const id = 'P_' + new Date().getTime() + '_' + Math.random().toString(36).slice(2, 8);
  const row = [id, payload.emailId, '', '', '', '', '', '', new Date().toISOString()];
  sheet.appendRow(row);
}
