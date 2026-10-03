(function () {
  'use strict';
  const url = window.BIRDIE_SUPABASE_URL;
  const key = window.BIRDIE_SUPABASE_ANON_KEY;
  const client = url && key && window.supabase?.createClient
    ? window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  const fail = (message) => { throw new Error(message); };
  const requireClient = () => client || fail('Account and catalog connection is unavailable.');
  const unwrap = (result) => {
    if (result.error) fail(result.error.message);
    if (result.data?.error) fail(`${result.data.error.code}: ${result.data.error.message}`);
    return result.data?.data;
  };
  const rpc = async (name, request) => unwrap(await requireClient().rpc(name, { p_request: request }));
  async function requireUser() {
    const { data, error } = await requireClient().auth.getUser();
    if (error || !data.user) fail('Sign in to save and edit rounds.');
    return data.user;
  }
  async function bootstrap() {
    const user = await requireUser();
    const { error } = await client.from('profiles').upsert({ user_id: user.id }, { onConflict: 'user_id' });
    if (error) fail(error.message);
    return user;
  }
  async function courses() {
    const c = requireClient();
    const page = await c.rpc('search_courses_v1', { p_query: '', p_lat: null, p_lon: null, p_limit: 50, p_offset: 0 });
    if (page.error) fail(page.error.message);
    const ids = page.data?.items?.map(row => row.id) ?? [];
    const localDemo = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!ids.length && localDemo) {
      const seed = await c.from('courses').select('id').eq('published', true).eq('synthetic', true);
      if (!seed.error) ids.push(...seed.data.map(row => row.id));
    }
    return (await Promise.all(ids.map(async id => {
      let detail = await c.rpc('get_course_detail_v1', { p_id: id });
      if (detail.error) fail(detail.error.message);
      if (!detail.data && localDemo) {
        // Internal-only fixture is excluded from the public read contract.
        const [course, layouts, versions, holes] = await Promise.all([
          c.from('courses').select('id,name,reported_hole_count,data_version').eq('id', id).single(),
          c.from('layouts').select('id,course_id,name').eq('course_id', id),
          c.from('layout_versions').select('id,layout_id').eq('published', true),
          c.from('layout_holes').select('id,layout_version_id,hole_number,par,distance_ft').order('hole_number'),
        ]);
        for (const r of [course, layouts, versions, holes]) if (r.error) fail(r.error.message);
        const layout = layouts.data[0], version = versions.data.find(v => v.layout_id === layout?.id);
        detail = { data: { ...course.data, layouts: layout ? [{ name: layout.name,
          versions: version ? [{ id: version.id, holes: holes.data.filter(h => h.layout_version_id === version.id) }] : [] }] : [] } };
      }
      if (!detail.data) return null;
      const d = detail.data, layout = d.layouts.find(l => l.versions.some(v => v.holes.length));
      const version = layout?.versions.find(v => v.holes.length);
      const selected = version?.holes ?? Array.from({ length: d.reported_hole_count ?? 0 }, (_, i) =>
        ({ hole_number: i + 1, par: null, distance_ft: null }));
      if (!selected.length || selected.some((h, i) => h.hole_number !== i + 1)) return null;
      return { ...d, layout: layout?.name ?? 'Private custom layout', layout_version_id: version?.id ?? null,
        holes: selected.map(h => ({ hole_number: h.hole_number, par: h.par, distance_ft: h.distance_ft })) };
    }))).filter(Boolean);
  }
  async function searchCourses(query = '', offset = 0, lat = null, lon = null) {
    const result = await requireClient().rpc('search_courses_v1', {
      p_query: query, p_lat: lat, p_lon: lon, p_limit: 20, p_offset: offset });
    if (result.error) fail(result.error.message);
    return result.data;
  }
  async function searchDiscs(query = '', offset = 0) {
    const result = await requireClient().rpc('search_disc_molds_v1', {
      p_query: query, p_limit: 20, p_offset: offset });
    if (result.error) fail(result.error.message);
    return result.data;
  }
  async function listRounds() {
    await requireUser();
    const result = await client.from('rounds').select('id,course_id,layout_name,status,revision,started_at').order('started_at', { ascending: false });
    if (result.error) fail(result.error.message);
    return result.data;
  }
  async function round(id) {
    await requireUser();
    const c = client;
    const r = await c.from('rounds').select('id,course_id,layout_name,status,revision,started_at').eq('id', id).single();
    if (r.error) fail(r.error.message);
    const p = await c.from('round_participants').select('id').eq('round_id', id).eq('is_owner', true).single();
    const h = await c.from('round_hole_snapshots').select('id,hole_number,par,distance_ft').eq('round_id', id).order('hole_number');
    const s = await c.from('hole_scores').select('snapshot_hole_id,strokes').eq('round_id', id);
    for (const result of [p, h, s]) if (result.error) fail(result.error.message);
    const scores = new Map(s.data.map(row => [row.snapshot_hole_id, row.strokes]));
    return { ...r.data, participant_id: p.data.id, holes: h.data.map(hole => ({ ...hole, strokes: scores.get(hole.id) ?? null })) };
  }
  async function create(course) {
    await requireUser();
    const request = { round_id: crypto.randomUUID(), participant_id: crypto.randomUUID(), course_id: course.id,
      layout_version_id: course.layout_version_id,
      custom_layout: course.layout_version_id ? null : { name: course.layout,
        holes: course.holes.map(h => ({ hole_number: h.hole_number, par: h.par, distance_ft: h.distance_ft })) } };
    return rpc('create_solo_round_v1', request);
  }
  async function score(round, hole, strokes) {
    return rpc('write_score_v1', { round_id: round.id, participant_id: round.participant_id,
      hole_number: hole, strokes, mutation_id: crypto.randomUUID(), expected_revision: round.revision });
  }
  async function complete(round) {
    return rpc('complete_round_v1', { round_id: round.id, mutation_id: crypto.randomUUID(), expected_revision: round.revision });
  }
  window.BFsolo = { client, requireClient, requireUser, bootstrap, courses, searchCourses, searchDiscs, listRounds, round, create, score, complete };
})();
