-- Secret-link runs: AppState JSON behind an unguessable UUID.
-- Access only via Next.js API using the service role key (no public policies).

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runs_updated_at_idx on public.runs (updated_at desc);

alter table public.runs enable row level security;

-- No policies for anon/authenticated: only service_role bypasses RLS.
