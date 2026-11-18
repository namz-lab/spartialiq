-- 249: the Engineering and Works unit's posts, in its sections.
--
-- Until now the organisation chart held one engineering post, the Engineer (migration 216). The Rural District Councils Act
-- [Chapter 29:13] names "the engineer" as an officer and head of department (s.65), whose appointment needs the Minister's
-- approval (s.66(3)); the posts under the engineer are the council's own, and the engineer may be delegated the power to
-- appoint and dismiss them (s.68). What councils run under the engineer is the work of the First Schedule (item 20 roads,
-- bridges and dams; 27 drains and sewers; 28 water; 32 refuse) and, under the Roads Act [Chapter 13:18], the tertiary roads
-- the council is the road authority for, funded through ZINARA.
--
-- This adds:
--   * admin_org_position.section: the section of a unit a post belongs to (null for the head and for undivided units);
--   * the engineering posts under the Engineer, in four sections, each reporting up the line:
--       Roads and works         Civil Technician > Roads Foreman > grader, roller, backhoe operators, tipper truck driver
--       Water and sanitation    Water and Sanitation Technician > Pump Minder
--       Plant and workshop      Mechanic > Plant and Fuel Clerk
--       Buildings               Building Maintenance Artisan
--
-- None of these posts carries a system role: the people in them do not sign in to the system yet, so a post without a
-- holder here is NOT a vacancy the system can see (src/routes/units.js counts vacancies only among posts that need an
-- account). A council edits titles, sections and reporting lines in the admin console. Idempotent: a post is added only if
-- the unit has no post with that title.

ALTER TABLE public.admin_org_position ADD COLUMN IF NOT EXISTS section varchar(80);
COMMENT ON COLUMN public.admin_org_position.section IS
  'The section of the unit this post belongs to (e.g. Roads and works). Null for the head of the unit and for units not divided into sections.';

DO $$
DECLARE
  head uuid;
  -- title, section, reports to (title; null = the Engineer), sort order
  posts constant text[][] := ARRAY[
    ['Civil Technician',                'Roads and works',      NULL,                              '10'],
    ['Roads Foreman',                   'Roads and works',      'Civil Technician',                '11'],
    ['Grader Operator',                 'Roads and works',      'Roads Foreman',                   '12'],
    ['Roller Operator',                 'Roads and works',      'Roads Foreman',                   '13'],
    ['Backhoe Loader Operator',         'Roads and works',      'Roads Foreman',                   '14'],
    ['Tipper Truck Driver',             'Roads and works',      'Roads Foreman',                   '15'],
    ['Water and Sanitation Technician', 'Water and sanitation', NULL,                              '20'],
    ['Pump Minder',                     'Water and sanitation', 'Water and Sanitation Technician', '21'],
    ['Mechanic',                        'Plant and workshop',   NULL,                              '30'],
    ['Plant and Fuel Clerk',            'Plant and workshop',   'Mechanic',                        '31'],
    ['Building Maintenance Artisan',    'Buildings',            NULL,                              '40']
  ];
  p text[];
  parent uuid;
BEGIN
  SELECT id INTO head FROM public.admin_org_position
   WHERE unit_key = 'engineering' AND system_role = 'engineer' ORDER BY sort_order LIMIT 1;
  IF head IS NULL THEN
    RAISE NOTICE '249: no Engineer post in the organisation chart; engineering posts not added';
    RETURN;
  END IF;

  FOREACH p SLICE 1 IN ARRAY posts LOOP
    IF EXISTS (SELECT 1 FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = p[1]) THEN
      CONTINUE;
    END IF;
    parent := head;
    IF p[3] IS NOT NULL THEN
      SELECT id INTO parent FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = p[3] LIMIT 1;
      parent := COALESCE(parent, head);
    END IF;
    INSERT INTO public.admin_org_position (title, department, section, system_role, unit_key, reports_to, sort_order)
    VALUES (p[1], 'Engineering & Works', p[2], NULL, 'engineering', parent, p[4]::int);
  END LOOP;
END $$;
