-- 251: the Department of Roads and Works, as the council proposes it for 2027.
--
-- The council's engineering unit is the Department of Roads and Works, headed by the District Engineer. Its proposed 2027
-- staff structure (with each post's grade, highest first) replaces the posts migration 249 seeded:
--
--   District Engineer (10)                          the head: the Act's "engineer" (Rural District Councils Act s.65)
--   Civil Engineering Technician (9)                 was "Civil Technician"; keeps the civil_technician role and holder
--   Roads and Works Foreman/Technician (8)           was "Roads Foreman"; keeps the roads_foreman role and holder
--   Grader Operator (6) x1, Heavy Equipment Operator (6) x2,
--   Class 2 Driver (5) x2, Tractor Driver (3) x1, Tow Grader Operator (3) x1, General Hand (1) x1
--
-- The chain follows the proposal: the District Engineer, the technician under the District Engineer, the foreman under the
-- technician, and the plant, driving and general posts under the foreman (the proposal's lower boxes rank them by grade).
-- The department is one section, so posts carry no section.
--
-- Posts 249 seeded that the proposal does not have are removed: Roller Operator, Backhoe Loader Operator, Tipper Truck
-- Driver, Water and Sanitation Technician, Pump Minder, Mechanic, Plant and Fuel Clerk, Building Maintenance Artisan. A post
-- that has a holder is kept (and reported), never deleted under someone. The water_technician role stays allowed on
-- accounts; it simply has no post on the 2027 establishment.
--
-- Adds admin_org_position.grade, the post's grade on the council's establishment. Idempotent.

ALTER TABLE public.admin_org_position ADD COLUMN IF NOT EXISTS grade smallint;
COMMENT ON COLUMN public.admin_org_position.grade IS 'The post''s grade on the council''s establishment (e.g. 10 for the District Engineer). Null where none is recorded.';

DO $$
DECLARE
  head uuid;
  tech uuid;
  foreman uuid;
  -- title, grade, how many posts, sort order (all report to the foreman)
  lower_posts constant text[][] := ARRAY[
    ['Grader Operator',          '6', '1', '20'],
    ['Heavy Equipment Operator', '6', '2', '21'],
    ['Class 2 Driver',           '5', '2', '30'],
    ['Tractor Driver',           '3', '1', '40'],
    ['Tow Grader Operator',      '3', '1', '41'],
    ['General Hand',             '1', '1', '50']
  ];
  gone constant text[] := ARRAY['Pump Minder', 'Plant and Fuel Clerk', 'Roller Operator', 'Backhoe Loader Operator',
    'Tipper Truck Driver', 'Water and Sanitation Technician', 'Mechanic', 'Building Maintenance Artisan'];
  p text[];
  have int;
  t text;
BEGIN
  SELECT id INTO head FROM public.admin_org_position
   WHERE unit_key = 'engineering' AND system_role = 'engineer' ORDER BY sort_order LIMIT 1;
  IF head IS NULL THEN
    RAISE NOTICE '251: no Engineer post in the organisation chart; nothing changed';
    RETURN;
  END IF;

  -- the department, and its head
  UPDATE public.admin_org_position SET department = 'Roads and Works', updated_at = now() WHERE unit_key = 'engineering';
  UPDATE public.admin_org_position SET title = 'District Engineer', grade = 10, section = NULL, updated_at = now() WHERE id = head;

  -- the technician and the foreman: renamed, keeping their roles and holders
  UPDATE public.admin_org_position SET title = 'Civil Engineering Technician', updated_at = now()
   WHERE unit_key = 'engineering' AND title = 'Civil Technician';
  SELECT id INTO tech FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = 'Civil Engineering Technician' LIMIT 1;
  IF tech IS NULL THEN
    INSERT INTO public.admin_org_position (title, department, system_role, unit_key, reports_to, sort_order)
    VALUES ('Civil Engineering Technician', 'Roads and Works', 'civil_technician', 'engineering', head, 10) RETURNING id INTO tech;
  END IF;
  UPDATE public.admin_org_position SET grade = 9, section = NULL, reports_to = head, sort_order = 10, updated_at = now() WHERE id = tech;

  UPDATE public.admin_org_position SET title = 'Roads and Works Foreman/Technician', updated_at = now()
   WHERE unit_key = 'engineering' AND title = 'Roads Foreman';
  SELECT id INTO foreman FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = 'Roads and Works Foreman/Technician' LIMIT 1;
  IF foreman IS NULL THEN
    INSERT INTO public.admin_org_position (title, department, system_role, unit_key, reports_to, sort_order)
    VALUES ('Roads and Works Foreman/Technician', 'Roads and Works', 'roads_foreman', 'engineering', tech, 11) RETURNING id INTO foreman;
  END IF;
  UPDATE public.admin_org_position SET grade = 8, section = NULL, reports_to = tech, sort_order = 11, updated_at = now() WHERE id = foreman;

  -- the posts the proposal does not have, unless someone holds one
  FOREACH t IN ARRAY gone LOOP
    IF EXISTS (SELECT 1 FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = t AND holder_id IS NOT NULL) THEN
      RAISE NOTICE '251: "%" has a holder and is kept; remove it in the admin console once its holder has moved', t;
    ELSE
      DELETE FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = t;
    END IF;
  END LOOP;

  -- the plant, driving and general posts under the foreman, as many as the proposal has
  FOREACH p SLICE 1 IN ARRAY lower_posts LOOP
    UPDATE public.admin_org_position SET grade = p[2]::smallint, section = NULL, reports_to = foreman, sort_order = p[4]::int, updated_at = now()
     WHERE unit_key = 'engineering' AND title = p[1];
    SELECT count(*) INTO have FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = p[1];
    WHILE have < p[3]::int LOOP
      INSERT INTO public.admin_org_position (title, department, grade, system_role, unit_key, reports_to, sort_order)
      VALUES (p[1], 'Roads and Works', p[2]::smallint, NULL, 'engineering', foreman, p[4]::int);
      have := have + 1;
    END LOOP;
  END LOOP;
END $$;
