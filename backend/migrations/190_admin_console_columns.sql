-- The IT console reads columns and the establishment table that an older
-- admin_setting stub never received. Migration 127 cannot add them: its
-- CREATE TABLE is skipped and the seed then fails, rolling the file back.
-- This adds only what the live routes select, and seeds the establishment
-- the console used to hard-code. Holders are filled only when exactly one
-- active account has that role.

BEGIN;

ALTER TABLE public.admin_setting
  ADD COLUMN IF NOT EXISTS category    varchar(40)  NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS label       varchar(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS constraints jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enforced    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS secret      boolean     NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.admin_org_position (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        varchar(160) NOT NULL,
  department   varchar(120),
  system_role  varchar(40),
  holder_id    uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  reports_to   uuid         REFERENCES public.admin_org_position(id) ON DELETE SET NULL,
  sort_order   integer      NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CHECK (reports_to IS NULL OR reports_to <> id)
);

CREATE INDEX IF NOT EXISTS idx_org_position_parent ON public.admin_org_position (reports_to, sort_order);
CREATE INDEX IF NOT EXISTS idx_org_position_holder ON public.admin_org_position (holder_id);

DO $$
DECLARE
  v_ceo uuid;
  v_eo  uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.admin_org_position) THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_org_position (title, department, system_role, sort_order)
  VALUES ('Chief Executive Officer', 'Executive', 'admin', 0)
  RETURNING id INTO v_ceo;

  INSERT INTO public.admin_org_position (title, department, system_role, reports_to, sort_order)
  VALUES ('Executive Officer — Planning & Environment', 'Planning & Environment', 'eo', v_ceo, 0)
  RETURNING id INTO v_eo;

  INSERT INTO public.admin_org_position (title, department, system_role, reports_to, sort_order) VALUES
    ('Town Planning Officer',        'Planning & Environment', 'planner',            v_eo, 0),
    ('Planning Clerk',               'Planning & Environment', 'planning_clerk',     v_eo, 1),
    ('GIS Officer',                  'Planning & Environment', 'gis_officer',        v_eo, 2),
    ('Building Inspector',           'Planning & Environment', 'building_inspector', v_eo, 3),
    ('Environmental Health Officer', 'Planning & Environment', 'env_officer',        v_eo, 4),
    ('Surveyor',                     'Planning & Environment', 'surveyor',           v_eo, 5);
END $$;

UPDATE public.admin_org_position p
   SET holder_id = m.id, updated_at = now()
  FROM (
    SELECT role, (array_agg(id))[1] AS id
      FROM public.users
     WHERE deleted_at IS NULL AND active AND role IS NOT NULL
     GROUP BY role
    HAVING count(*) = 1
  ) m
 WHERE p.holder_id IS NULL AND p.system_role = m.role;

COMMIT;
