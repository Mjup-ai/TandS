import pg from 'pg';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dlq' | 'cancelled';

export type TaskRow = {
  id: string;
  created_at: string;
  updated_at: string;
  status: TaskStatus;
  kind: string;
  priority: number;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  payload: any;
};

const { Pool } = pg;

let pool: pg.Pool | null = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString: url, max: 5, ssl: { rejectUnauthorized: false } });
  return pool;
}

export async function ensureSchema() {
  const p = getPool();
  await p.query(`
    create table if not exists mc_tasks (
      id text primary key,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      status text not null,
      kind text not null,
      priority int not null default 100,
      run_at timestamptz not null default now(),
      attempts int not null default 0,
      max_attempts int not null default 10,
      locked_by text null,
      locked_at timestamptz null,
      last_error text null,
      payload jsonb not null
    );
  `);

  await p.query(`
    create index if not exists mc_tasks_status_runat_priority_idx
    on mc_tasks (status, run_at, priority);
  `);

  await p.query(`
    create table if not exists mc_task_events (
      id bigserial primary key,
      ts timestamptz not null default now(),
      task_id text not null,
      actor text not null,
      event text not null,
      detail jsonb null
    );
  `);

  await p.query(`
    create index if not exists mc_task_events_task_id_ts_idx
    on mc_task_events (task_id, ts desc);
  `);
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function enqueueTask(input: { kind: string; payload: any; priority?: number; runAt?: string; maxAttempts?: number; actor?: string }) {
  const p = getPool();
  const id = uid();
  const now = new Date().toISOString();
  const status: TaskStatus = 'queued';
  const priority = input.priority ?? 100;
  const runAt = input.runAt ?? now;
  const maxAttempts = input.maxAttempts ?? 10;
  const actor = input.actor ?? 'system';

  await p.query(
    `insert into mc_tasks (id, status, kind, priority, run_at, max_attempts, payload) values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, status, input.kind, priority, runAt, maxAttempts, input.payload]
  );
  await p.query(`insert into mc_task_events (task_id, actor, event, detail) values ($1,$2,$3,$4)`, [id, actor, 'enqueued', { kind: input.kind }]);
  return { id };
}

export async function lockNextTask(input: { workerId: string }) {
  const p = getPool();
  const workerId = input.workerId;

  const client = await p.connect();
  try {
    await client.query('begin');
    const q = await client.query(
      `
      select *
      from mc_tasks
      where status = 'queued'
        and run_at <= now()
      order by priority asc, run_at asc, created_at asc
      for update skip locked
      limit 1
      `
    );

    const row = q.rows?.[0];
    if (!row) {
      await client.query('commit');
      return null;
    }

    await client.query(
      `
      update mc_tasks
      set status='running', locked_by=$2, locked_at=now(), updated_at=now(), attempts=attempts+1
      where id=$1
      `,
      [row.id, workerId]
    );
    await client.query(`insert into mc_task_events (task_id, actor, event) values ($1,$2,$3)`, [row.id, workerId, 'locked']);
    await client.query('commit');

    // return fresh row
    const out = await p.query(`select * from mc_tasks where id=$1`, [row.id]);
    return out.rows?.[0] as TaskRow;
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function markSucceeded(input: { taskId: string; workerId: string; detail?: any }) {
  const p = getPool();
  await p.query(`update mc_tasks set status='succeeded', locked_by=null, locked_at=null, updated_at=now() where id=$1`, [input.taskId]);
  await p.query(`insert into mc_task_events (task_id, actor, event, detail) values ($1,$2,$3,$4)`, [input.taskId, input.workerId, 'succeeded', input.detail ?? null]);
}

function backoffMs(attempt: number) {
  // 1m, 2m, 4m, 8m, ... max 1h
  const base = 60_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

export async function getQueueSummary() {
  const p = getPool();
  const counts = await p.query(`select status, count(*)::int as c from mc_tasks group by status order by status`);

  // overdue: queued or running with dueAt in payload and now > dueAt
  const overdue = await p.query(
    `
    select count(*)::int as c
    from mc_tasks
    where status in ('queued','running')
      and (payload->>'dueAt') is not null
      and (payload->>'dueAt')::timestamptz < now()
    `
  );

  const map: Record<string, number> = {};
  for (const r of counts.rows) map[String(r.status)] = Number(r.c);

  return {
    counts: map,
    overdue: Number(overdue.rows?.[0]?.c ?? 0),
  };
}

export async function listRunning(limit = 20) {
  const p = getPool();
  const lim = Math.max(1, Math.min(100, limit));
  const r = await p.query(
    `
    select id, kind, status, priority, attempts, max_attempts, locked_by, locked_at, updated_at, payload
    from mc_tasks
    where status='running'
    order by updated_at desc
    limit $1
    `,
    [lim]
  );
  return r.rows as TaskRow[];
}

export async function listDlq(limit = 20) {
  const p = getPool();
  const lim = Math.max(1, Math.min(100, limit));
  const r = await p.query(
    `
    select id, kind, status, priority, attempts, max_attempts, last_error, updated_at, payload
    from mc_tasks
    where status='dlq'
    order by updated_at desc
    limit $1
    `,
    [lim]
  );
  return r.rows as TaskRow[];
}

export async function retryTask(taskId: string, actor = 'system') {
  const p = getPool();
  await p.query(`update mc_tasks set status='queued', run_at=now(), locked_by=null, locked_at=null, updated_at=now() where id=$1`, [taskId]);
  await p.query(`insert into mc_task_events (task_id, actor, event) values ($1,$2,$3)`, [taskId, actor, 'retried']);
  return { ok: true };
}

export async function cancelTask(taskId: string, actor = 'system') {
  const p = getPool();
  await p.query(`update mc_tasks set status='cancelled', locked_by=null, locked_at=null, updated_at=now() where id=$1`, [taskId]);
  await p.query(`insert into mc_task_events (task_id, actor, event) values ($1,$2,$3)`, [taskId, actor, 'cancelled']);
  return { ok: true };
}

export async function markFailed(input: { taskId: string; workerId: string; error: string }) {
  const p = getPool();
  const r = await p.query(`select attempts, max_attempts from mc_tasks where id=$1`, [input.taskId]);
  const attempts = Number(r.rows?.[0]?.attempts ?? 0);
  const maxAttempts = Number(r.rows?.[0]?.max_attempts ?? 10);

  if (attempts >= maxAttempts) {
    await p.query(
      `update mc_tasks set status='dlq', last_error=$2, locked_by=null, locked_at=null, updated_at=now() where id=$1`,
      [input.taskId, input.error.slice(0, 2000)]
    );
    await p.query(`insert into mc_task_events (task_id, actor, event, detail) values ($1,$2,$3,$4)`, [input.taskId, input.workerId, 'dlq', { error: input.error }]);
    return { status: 'dlq' as const };
  }

  const delay = backoffMs(attempts);
  await p.query(
    `update mc_tasks set status='queued', run_at=now()+($2::int * interval '1 millisecond'), last_error=$3, locked_by=null, locked_at=null, updated_at=now() where id=$1`,
    [input.taskId, delay, input.error.slice(0, 2000)]
  );
  await p.query(`insert into mc_task_events (task_id, actor, event, detail) values ($1,$2,$3,$4)`, [input.taskId, input.workerId, 'failed', { error: input.error, retryInMs: delay }]);
  return { status: 'queued' as const, retryInMs: delay };
}
