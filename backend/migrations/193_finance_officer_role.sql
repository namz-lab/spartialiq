-- Finance desk. The revenue console existed, but the users.role check had
-- no finance officer, so the login screen could not offer a finance account
-- and a granted role would be rejected by the constraint.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN (
  'public', 'registered', 'viewer', 'admin', 'planner', 'eo', 'env_officer',
  'building_inspector', 'planning_clerk', 'surveyor', 'gis_officer',
  'gis_head', 'gis_data', 'gis_dev', 'gis_analyst', 'gis_tech', 'gis_clerk',
  'dept_editor', 'dept_viewer', 'finance_officer'
));
