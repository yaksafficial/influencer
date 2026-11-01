-- 고객 응대 인박스(inbox.html) 용 Cloudflare D1 스키마
-- 적용: wrangler d1 execute influencer-inbox --remote --file=db/schema.sql
-- 모든 시각은 epoch milliseconds (INTEGER)

-- 연결된 Instagram 프로페셔널 계정 (단일 행, id = 1)
CREATE TABLE IF NOT EXISTS ig_account (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  ig_user_id       TEXT NOT NULL,
  username         TEXT,
  access_token     TEXT NOT NULL,
  token_expires_at INTEGER,
  connected_at     INTEGER NOT NULL,
  refreshed_at     INTEGER,
  webhook_fields   TEXT
);

-- 게시물 (API 동기화 캐시)
CREATE TABLE IF NOT EXISTS media (
  id              TEXT PRIMARY KEY,
  caption         TEXT,
  media_type      TEXT,
  media_url       TEXT,
  thumbnail_url   TEXT,
  permalink       TEXT,
  timestamp       INTEGER,
  comments_count  INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  dm_kit_id       INTEGER,          -- 이 게시물 댓글에 보낼 기본 자료(킷)
  synced_at       INTEGER
);

-- 댓글 (웹훅 실시간 + API 동기화)
CREATE TABLE IF NOT EXISTS comments (
  id                     TEXT PRIMARY KEY,
  media_id               TEXT,
  parent_id              TEXT,
  from_user_id           TEXT,
  from_username          TEXT,
  text                   TEXT,
  timestamp              INTEGER NOT NULL,
  is_mine                INTEGER DEFAULT 0,   -- 내 계정이 단 댓글(답글)
  status                 TEXT DEFAULT 'open', -- open | done
  handled_by             TEXT,
  replied_at             INTEGER,
  private_reply_sent_at  INTEGER,
  private_reply_kit_id   INTEGER,
  private_reply_by       TEXT,
  private_reply_mode     TEXT,                -- text | attachment
  source                 TEXT,                -- webhook | sync
  created_at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_media ON comments (media_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments (status, timestamp DESC);

-- DM 대화 (상대 Instagram-scoped user id 기준)
CREATE TABLE IF NOT EXISTS conversations (
  participant_id        TEXT PRIMARY KEY,
  api_conversation_id   TEXT,
  participant_username  TEXT,
  profile_pic           TEXT,
  is_follower           INTEGER,   -- 1: 나를 팔로우함, 0: 아님, NULL: 미확인
  last_message_at       INTEGER,
  last_inbound_at       INTEGER,   -- 상대가 마지막으로 보낸 시각 (24시간 윈도우 계산)
  last_text             TEXT,
  unread                INTEGER DEFAULT 0,
  status                TEXT DEFAULT 'open',  -- open | done
  assigned_to           TEXT,
  note                  TEXT,
  updated_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations (updated_at DESC);

-- DM 메시지
CREATE TABLE IF NOT EXISTS messages (
  id               TEXT PRIMARY KEY,   -- mid
  participant_id   TEXT NOT NULL,
  direction        TEXT NOT NULL,      -- in | out
  text             TEXT,
  attachments      TEXT,               -- JSON
  timestamp        INTEGER NOT NULL,
  sent_by          TEXT,               -- 직원 이름 (내 웹에서 보낸 경우)
  source           TEXT,               -- webhook | sync | app
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (participant_id, timestamp);

-- 자료 킷 (댓글 요청자에게 보낼 정리본)
CREATE TABLE IF NOT EXISTS dm_kits (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  text             TEXT NOT NULL,      -- 본문 (링크 포함 가능)
  attachment_url   TEXT,               -- 공개 HTTPS URL (선택)
  attachment_type  TEXT,               -- image | video | audio | file
  keyword          TEXT,               -- 요청 댓글 판별용 키워드 (선택, 쉼표 구분)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER
);

-- 직원 계정 (owner 는 환경변수 INBOX_ADMIN_PASSWORD 로 로그인, 여기엔 없음)
CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  salt           TEXT NOT NULL,
  active         INTEGER DEFAULT 1,
  created_at     INTEGER NOT NULL
);

-- 로그인 세션
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  staff_name  TEXT NOT NULL,
  role        TEXT NOT NULL,          -- owner | staff
  expires_at  INTEGER NOT NULL
);

-- 활동 로그 (누가 무엇을 했는지)
CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_name   TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_created ON activity_log (created_at DESC);

-- 기타 설정 / 웹훅 수신 기록
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
