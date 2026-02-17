/**
 * 提案① スプシ版：設定（Apps Script にそのまま貼って使う）
 * シート名・列インデックス・取得件数上限
 */
const CONFIG = {
  SHEET_NAMES: {
    RAW_EMAILS: 'RAW_EMAILS',
    TALENTS: 'TALENTS',
    PROJECTS: 'PROJECTS',
    MATCHES: 'MATCHES',
    SKILL_DICT: 'SKILL_DICT',
    CONFIG: 'CONFIG'
  },
  // RAW_EMAILS の列（0始まり）
  RAW_EMAILS_COLS: {
    ID: 0,
    MESSAGE_ID: 1,
    RECEIVED_AT: 2,
    FROM: 3,
    TO: 4,
    SUBJECT: 5,
    BODY_TEXT: 6,
    CLASSIFICATION: 7,
    PROCESSING_STATUS: 8,
    GMAIL_THREAD_URL: 9
  },
  BODY_MAX_LENGTH: 2000,
  FETCH_LIMIT: 50,
  SEARCH_QUERY: 'is:unread' // 未読のみ。ラベル指定なら 'label:ses-inbox is:unread' 等
};
