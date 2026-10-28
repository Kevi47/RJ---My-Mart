-- RJ My Mart — Invoice Verification & Stock Reconciliation
-- Run this once in Supabase → SQL Editor (safe to re-run).

create extension if not exists pg_trgm;

-- ───────────────────────── Stores & users ─────────────────────────
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  gstin text,
  margin_threshold numeric not null default 8,      -- FR-13, percent
  cost_tolerance_pct numeric not null default 1,    -- FR-3, percent difference before flagging cost change
  created_at timestamptz not null default now()
);

insert into stores (name, gstin) values ('Amballoor', '32ABBFR8496H1ZV')
on conflict (name) do nothing;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'clerk' check (role in ('clerk', 'manager', 'admin')),
  store_id uuid references stores(id),
  active boolean not null default false,          -- admin must activate new sign-ups
  created_at timestamptz not null default now()
);
alter table profiles add column if not exists active boolean not null default false;
alter table profiles add column if not exists emp_code text unique;   -- login ID, e.g. E9999

-- First user to sign up becomes an active admin; everyone after is an inactive clerk
-- until an admin activates them in Settings.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, emp_code, full_name, role, store_id, active)
  values (
    new.id,
    upper(coalesce(new.raw_user_meta_data->>'emp_code', split_part(new.email, '@', 1))),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from profiles) then 'clerk' else 'admin' end,
    (select id from stores order by created_at limit 1),
    not exists (select 1 from profiles)
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

-- Lets the sign-in page offer one-time admin setup on an empty system.
create or replace function setup_needed() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles)
$$;
grant execute on function setup_needed() to anon, authenticated;

create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select active from profiles where id = auth.uid()), false)
$$;

-- ───────────────────────── SOH baseline (FR-1) ─────────────────────────
create table if not exists soh_uploads (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  file_name text,
  as_on_date text,
  row_count int,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  pcode text not null,
  name text not null,
  stock numeric default 0,
  prate numeric,          -- last purchase cost
  srate numeric,          -- current sale price
  mrp numeric,            -- current MRP (if Polosys export has it)
  department text,
  category text,
  sub_category text,
  brand text,
  hsn text,
  gst_pct numeric,
  last_upload_id uuid references soh_uploads(id),
  updated_at timestamptz not null default now(),
  unique (store_id, pcode)
);
create index if not exists items_name_trgm on items using gin (name gin_trgm_ops);

-- Barcodes learned once while receiving (FR-10)
create table if not exists item_barcodes (
  store_id uuid not null references stores(id),
  barcode text not null,
  item_id uuid not null references items(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (store_id, barcode)
);

-- MRP batches (FR-4): one row per (item, MRP) received at a non-baseline MRP
create table if not exists mrp_batches (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  mrp numeric not null,
  qty numeric not null,
  source_invoice_id uuid,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Suppliers & mapping ─────────────────────────
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gstin text unique,
  created_at timestamptz not null default now()
);

-- supplier + invoice code/description → Polosys item (FR-10)
create table if not exists supplier_item_map (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  store_id uuid not null references stores(id),
  match_key text not null,          -- 'code:<code>' or 'desc:<normalised description>'
  item_id uuid not null references items(id) on delete cascade,
  units_per_case numeric,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (supplier_id, store_id, match_key)
);

-- HSN → GST rate learned from approved invoices (FR-9)
create table if not exists hsn_rates (
  hsn text primary key,
  gst_pct numeric not null,
  updated_at timestamptz not null default now()
);
insert into hsn_rates (hsn, gst_pct) values
  ('34025000', 18), ('96190010', 0), ('96190030', 5), ('21069099', 5), ('210690', 5), ('15131900', 5)
on conflict (hsn) do nothing;

-- ───────────────────────── Invoices ─────────────────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id),
  supplier_id uuid references suppliers(id),
  supplier_name text,
  supplier_gstin text,
  invoice_no text,
  invoice_date date,
  po_no text,
  internal_ref text,       -- circled number (Polosys inward no.)
  lf_no text,              -- LF- number written on the invoice
  irn text,
  subtotal numeric,
  tax_total numeric,
  round_off numeric,
  invoice_total numeric,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'receiving', 'scanned', 'approved', 'exported', 'rejected')),
  image_paths text[] not null default '{}',
  extraction jsonb,         -- raw model output, kept for audit
  validation jsonb,         -- header-level validation results
  notes text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_dup on invoices (supplier_gstin, invoice_no);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_no int not null,
  item_code text,
  description text not null,
  hsn text,
  uom text,
  cases numeric,
  pieces numeric,
  units_per_case numeric,
  qty numeric not null default 0,            -- normalised to pieces (FR-11)
  free_qty numeric not null default 0,
  mrp numeric,
  rate numeric,
  gross numeric,
  discount_pct numeric,
  discount_amt numeric,
  scheme_amt numeric,
  taxable numeric,
  gst_pct numeric,
  tax_amt numeric,
  total numeric,
  batch text,
  expiry text,
  item_id uuid references items(id),
  match_source text,                         -- map_code | map_desc | fuzzy | manual | barcode
  pack_mrp numeric,                          -- MRP confirmed from the pack (FR-4 / Q9)
  price_flag text,                           -- ok | mrp_changed | cost_changed | sale_price_changed | new_item
  is_loose boolean not null default false,   -- manual-count path (Q4)
  review_status text not null default 'ok' check (review_status in ('ok', 'recheck')),
  review_note text,
  warnings jsonb not null default '[]',
  extract_note text,                         -- low-confidence / handwriting notes from extraction
  created_at timestamptz not null default now()
);
alter table invoice_lines add column if not exists extract_note text;
create index if not exists invoice_lines_inv on invoice_lines (invoice_id);

-- Every barcode scan during receiving (FR-5, FR-14). id is generated on the device so
-- offline-queued scans can be retried without double counting.
create table if not exists scans (
  id uuid primary key,
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_id uuid references invoice_lines(id) on delete set null,
  barcode text,
  qty numeric not null default 1,
  kind text not null default 'scan' check (kind in ('scan', 'manual')),
  user_id uuid references auth.users(id),
  device_label text,
  undone boolean not null default false,
  undone_by uuid references auth.users(id),
  scanned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists scans_inv on scans (invoice_id);

-- Barcode → invoice line link for barcodes not yet tied to an item
create table if not exists invoice_barcodes (
  invoice_id uuid not null references invoices(id) on delete cascade,
  barcode text not null,
  line_id uuid not null references invoice_lines(id) on delete cascade,
  primary key (invoice_id, barcode)
);

-- ───────────────────────── Audit (NFR) ─────────────────────────
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  action text not null,
  entity text,
  entity_id uuid,
  details jsonb
);

-- ───────────────────────── Views & functions ─────────────────────────
create or replace view line_counts with (security_invoker = true) as
select l.id as line_id, l.invoice_id,
       coalesce(sum(s.qty) filter (where not s.undone), 0) as scanned
from invoice_lines l
left join scans s on s.line_id = l.id
group by l.id, l.invoice_id;

-- Fuzzy item search for matching invoice descriptions to Polosys items
create or replace function search_items(p_store uuid, p_query text, p_limit int default 8)
returns table (id uuid, pcode text, name text, mrp numeric, srate numeric, prate numeric, stock numeric, score real)
language sql stable as $$
  select i.id, i.pcode, i.name, i.mrp, i.srate, i.prate, i.stock,
         greatest(similarity(i.name, p_query), word_similarity(p_query, i.name)) as score
  from items i
  where i.store_id = p_store
    and (i.name % p_query or p_query <% i.name or i.pcode = p_query or i.name ilike '%' || p_query || '%')
  order by (i.pcode = p_query) desc, score desc
  limit p_limit
$$;

-- FR-7: only managers/admins may approve; logs the approval and applies learned data.
create or replace function approve_invoice(p_invoice uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if my_role() not in ('manager', 'admin') then
    raise exception 'Only a manager can approve invoices';
  end if;

  update invoices set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         notes = coalesce(p_note, notes), updated_at = now()
  where id = p_invoice;

  -- New MRP batches for lines received at a different MRP (FR-4)
  for r in
    select l.*, coalesce(l.pack_mrp, l.mrp) as eff_mrp, c.scanned, i.mrp as base_mrp
    from invoice_lines l
    join line_counts c on c.line_id = l.id
    join items i on i.id = l.item_id
    where l.invoice_id = p_invoice and l.price_flag = 'mrp_changed'
  loop
    insert into mrp_batches (item_id, mrp, qty, source_invoice_id)
    values (r.item_id, r.eff_mrp, case when r.is_loose then r.qty else r.scanned end, p_invoice);
    insert into audit_log (action, entity, entity_id, details)
    values ('mrp_batch_created', 'item', r.item_id,
            jsonb_build_object('old_mrp', r.base_mrp, 'new_mrp', r.eff_mrp, 'invoice', p_invoice));
  end loop;

  -- Barcodes linked to a line during receiving become permanent item barcodes (FR-10)
  insert into item_barcodes (store_id, barcode, item_id, created_by)
  select inv.store_id, b.barcode, l.item_id, auth.uid()
  from invoice_barcodes b
  join invoice_lines l on l.id = b.line_id
  join invoices inv on inv.id = b.invoice_id
  where b.invoice_id = p_invoice and l.item_id is not null
  on conflict (store_id, barcode) do nothing;

  -- Where the SOH export has no MRP, remember the MRP received so the next invoice can be checked
  update items i set mrp = coalesce(l.pack_mrp, l.mrp), hsn = coalesce(i.hsn, l.hsn), updated_at = now()
  from invoice_lines l
  where l.invoice_id = p_invoice and l.item_id = i.id and i.mrp is null and coalesce(l.pack_mrp, l.mrp) is not null;

  -- Learn HSN → GST
  insert into hsn_rates (hsn, gst_pct, updated_at)
  select distinct on (hsn) hsn, gst_pct, now() from invoice_lines
  where invoice_id = p_invoice and hsn is not null and gst_pct is not null
  on conflict (hsn) do update set gst_pct = excluded.gst_pct, updated_at = now();

  insert into audit_log (action, entity, entity_id, details)
  values ('invoice_approved', 'invoice', p_invoice, jsonb_build_object('note', p_note));
end $$;

create or replace function reject_invoice(p_invoice uuid, p_line_ids uuid[], p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if my_role() not in ('manager', 'admin') then
    raise exception 'Only a manager can send invoices back';
  end if;
  update invoice_lines set review_status = 'recheck', review_note = p_note
  where invoice_id = p_invoice and id = any(p_line_ids);
  update invoices set status = 'receiving', notes = p_note, updated_at = now() where id = p_invoice;
  insert into audit_log (action, entity, entity_id, details)
  values ('invoice_sent_back', 'invoice', p_invoice, jsonb_build_object('lines', p_line_ids, 'note', p_note));
end $$;

-- ───────────────────────── Row-level security ─────────────────────────
-- Single business: any active staff member can work with all data.
-- Role changes are restricted to admins; approval is enforced in approve_invoice().
do $$
declare t text;
begin
  foreach t in array array['stores','soh_uploads','items','item_barcodes','mrp_batches','suppliers',
                           'supplier_item_map','hsn_rates','invoices','invoice_lines','scans',
                           'invoice_barcodes','audit_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists staff_all on %I', t);
    execute format('create policy staff_all on %I for all to authenticated using (is_active()) with check (is_active())', t);
  end loop;
end $$;

alter table profiles enable row level security;
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select to authenticated using (true);
drop policy if exists profiles_admin on profiles;
create policy profiles_admin on profiles for update to authenticated
  using (my_role() = 'admin' or id = auth.uid())
  with check (
    my_role() = 'admin'
    or (role = (select p.role from profiles p where p.id = auth.uid())
        and active = (select p.active from profiles p where p.id = auth.uid()))
  );

-- Approval columns may only be set through approve_invoice()
create or replace function guard_invoice_status() returns trigger
language plpgsql as $$
begin
  if new.status in ('approved', 'exported') and old.status is distinct from new.status
     and coalesce(my_role(), '') not in ('manager', 'admin') then
    raise exception 'Only a manager can approve or export';
  end if;
  return new;
end $$;
drop trigger if exists invoices_guard on invoices;
create trigger invoices_guard before update on invoices
for each row execute function guard_invoice_status();

-- ───────────────────────── Realtime (FR-14) ─────────────────────────
do $$
begin
  begin execute 'alter publication supabase_realtime add table scans'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table invoice_lines'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table invoice_barcodes'; exception when others then null; end;
end $$;

-- ───────────────────────── Storage for invoice photos ─────────────────────────
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists invoices_rw on storage.objects;
create policy invoices_rw on storage.objects for all to authenticated
  using (bucket_id = 'invoices' and is_active()) with check (bucket_id = 'invoices' and is_active());
