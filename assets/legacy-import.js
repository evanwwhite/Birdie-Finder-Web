(function () {
  'use strict';
  const encoder = new TextEncoder();
  const uuid = async value => {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
    bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes.slice(0, 16)].map(n => n.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))]
    .map(n => n.toString(16).padStart(2, '0')).join('');
  function parseWebRounds(raw) {
    let rows;
    try { rows = JSON.parse(raw); } catch { return { records: [], invalid: ['Storage is not valid JSON'] }; }
    if (!Array.isArray(rows)) return { records: [], invalid: ['Storage is not an array'] };
    const invalid = [], records = [];
    rows.forEach((row, index) => {
      const scores = row?.players?.[0]?.scores;
      if ((row?.courseId != null && typeof row.courseId !== 'string') || !Array.isArray(scores) ||
          !scores.length || scores.some(n => !Number.isInteger(n) || n < 1 || n > 12) ||
          row.players.length !== 1) { invalid.push(index); return; }
      records.push({ index, kind: 'web_round', courseSlug: row.courseId ?? '',
        layout: typeof row.layout === 'string' ? row.layout : null,
        playedAt: typeof row.date === 'string' ? row.date : null, scores });
    });
    return { records, invalid };
  }
  async function previewWebLegacy(raw, deviceId, resolveCourse) {
    const parsed = parseWebRounds(raw), records = [];
    for (const row of parsed.records) {
      const exact = JSON.stringify(JSON.parse(raw)[row.index]);
      const recordId = await uuid(`web_round:${deviceId}:${row.index}:${exact}`);
      const courseId = await resolveCourse(row.courseSlug);
      records.push({ ...row, recordId, roundId: recordId,
        participantId: await uuid(`participant:${recordId}`), sourceSha256: await sha(exact),
        courseId, status: courseId ? 'ready' : 'ambiguous' });
    }
    return { records, invalid: parsed.invalid };
  }
  async function importWebRecord(record, deviceId) {
    if (record.status !== 'ready' || !record.courseId) throw new Error('Review the course match before importing.');
    const client = window.BFsolo.requireClient();
    await window.BFsolo.requireUser();
    const run = async (name, request) => {
      const result = await client.rpc(name, { p_request: request });
      if (result.error || result.data?.error) throw new Error(result.error?.message ?? result.data.error.message);
      return result.data.data;
    };
    const request = { round_id: record.roundId, participant_id: record.participantId,
      course_id: record.courseId, layout_version_id: null,
      custom_layout: { name: record.layout || 'Imported legacy round',
        holes: record.scores.map((_, i) => ({ hole_number: i + 1, par: null, distance_ft: null })) } };
    await run('create_solo_round_v1', request);
    let round = await window.BFsolo.round(record.roundId);
    for (const [index, strokes] of record.scores.entries()) {
      const hole = index + 1;
      if (round.holes[index]?.strokes === strokes) continue;
      await run('write_score_v1', { round_id: record.roundId, participant_id: record.participantId,
        hole_number: hole, strokes, mutation_id: await uuid(`legacy-score:${record.recordId}:${hole}`),
        expected_revision: round.revision });
      round = await window.BFsolo.round(record.roundId);
    }
    if (round.status === 'live' && round.holes.every(h => h.strokes != null)) {
      await run('complete_round_v1', { round_id: record.roundId,
        mutation_id: await uuid(`legacy-complete:${record.recordId}`), expected_revision: round.revision });
    }
    round = await window.BFsolo.round(record.roundId);
    if (round.holes.length !== record.scores.length ||
        round.holes.some((h, i) => h.strokes !== record.scores[i])) throw new Error('Server round did not match the legacy scores.');
    const receipt = await client.rpc('ack_legacy_import_v1', {
      p_device_id: deviceId, p_record_id: record.recordId, p_record_kind: 'web_round',
      p_source_sha256: record.sourceSha256, p_target_id: record.roundId,
      p_played_at: record.playedAt && !Number.isNaN(Date.parse(record.playedAt))
        ? new Date(record.playedAt).toISOString() : null });
    if (receipt.error) throw receipt.error;
    return receipt.data;
  }
  // Legacy storage is read only. Caller removes it only after every record is
  // acknowledged and visible on both clients; skipped entries remain exportable.
  window.BFlegacy = { parseWebRounds, previewWebLegacy, importWebRecord, uuid };
  if (typeof module !== 'undefined') module.exports = window.BFlegacy;
})();
