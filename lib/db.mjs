import pg from 'pg';
let pool;
export function query(text, params = []) {
  const connectionString=process.env.DATABASE_URL?.trim();
  if (!connectionString) throw Object.assign(new Error('데이터베이스 설정 누락'),{code:'DB_URL_MISSING'});
  let url;
  try { url=new URL(connectionString); } catch { throw Object.assign(new Error('데이터베이스 설정 형식 오류'),{code:'DB_URL_INVALID'}); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname) throw Object.assign(new Error('데이터베이스 설정 형식 오류'),{code:'DB_URL_INVALID'});
  pool ??= new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 12000, idleTimeoutMillis: 10000 });
  return pool.query(text, params);
}
export async function close() { if (pool) { await pool.end(); pool = undefined; ready = undefined; } }
let ready;
export function setup() {
  ready ??= query(`
    CREATE TABLE IF NOT EXISTS articles (
      id BIGSERIAL PRIMARY KEY, url TEXT UNIQUE NOT NULL, naver_url TEXT,
      title TEXT NOT NULL, description TEXT NOT NULL, published_at TIMESTAMPTZ NOT NULL,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      saved BOOLEAN NOT NULL DEFAULT FALSE, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS article_queries (
      article_id BIGINT REFERENCES articles(id) ON DELETE CASCADE,
      topic TEXT NOT NULL, keyword TEXT NOT NULL, PRIMARY KEY(article_id, topic, keyword)
    );
    CREATE INDEX IF NOT EXISTS article_date_idx ON articles(published_at DESC);
    CREATE TABLE IF NOT EXISTS collection_runs (
      id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ, status TEXT NOT NULL DEFAULT 'running',
      fetched INTEGER NOT NULL DEFAULT 0, errors JSONB NOT NULL DEFAULT '[]'
    );
    ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS search_plan JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE TABLE IF NOT EXISTS trend_batches (
      id BIGSERIAL PRIMARY KEY, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), payload JSONB NOT NULL
    );
    ALTER TABLE trend_batches ADD COLUMN IF NOT EXISTS time_unit TEXT NOT NULL DEFAULT 'date';
    CREATE INDEX IF NOT EXISTS trend_unit_date_idx ON trend_batches(time_unit,fetched_at DESC);
    CREATE TABLE IF NOT EXISTS login_limits (
      bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL
    );
  `).catch(e=>{ ready=undefined; throw e; });
  return ready;
}
