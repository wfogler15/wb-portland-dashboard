-- Applied 2026-09-30 to project wmydniiakotcliraajaa (Willow Bridge - Phoenix).
-- Tables the dashboards already read/write but that were never created.
-- Same market-scoped pattern and access policy as the existing sync tables.
create table if not exists public.custom_properties (
  id text not null,
  market text not null default 'phoenix',
  data jsonb not null,
  editor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id)
);
create index if not exists custom_properties_market_idx on public.custom_properties (market);

create table if not exists public.comp_fees (
  property_id text not null,
  market text not null default 'phoenix',
  fees jsonb not null default '{}'::jsonb,
  editor_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (property_id, market)
);

alter table public.custom_properties enable row level security;
alter table public.comp_fees enable row level security;
create policy anon_all_custom_properties on public.custom_properties for all to anon, authenticated using (true) with check (true);
create policy anon_all_comp_fees on public.comp_fees for all to anon, authenticated using (true) with check (true);

alter publication supabase_realtime add table public.custom_properties;
alter publication supabase_realtime add table public.comp_fees;
