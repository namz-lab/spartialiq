-- Tables created by 128, 152 and the admin console were owned by postgres
-- and never granted to the application role, so every staff request that
-- steps into vungu_app was refused. Also creates the announcement table
-- the admin overview counts; migration 127 rolled back before it.

BEGIN;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA spatial_planning TO vungu_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA spatial_planning TO vungu_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.layer_publication TO vungu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_setting TO vungu_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_org_position TO vungu_app;

CREATE TABLE IF NOT EXISTS public.admin_announcement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        varchar(160) NOT NULL,
  body         text         NOT NULL,
  level        varchar(12)  NOT NULL DEFAULT 'info'
               CHECK (level IN ('info', 'warning', 'critical')),
  audience     varchar(12)  NOT NULL DEFAULT 'staff'
               CHECK (audience IN ('all', 'staff', 'admin')),
  starts_at    timestamptz  NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  created_by   uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  withdrawn_at timestamptz,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_announcement TO vungu_app;

COMMIT;
