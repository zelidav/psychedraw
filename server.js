const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── SESSION STORE (in-memory, 2hr TTL) ──────────────────────────
const sessions = new Map();
function makeCode() {
  return Math.random().toString(36).slice(2,8).toUpperCase();
}
function cleanSessions() {
  const now = Date.now();
  for (const [k,v] of sessions) {
    if (now - v.created > 2 * 60 * 60 * 1000) sessions.delete(k);
  }
}
setInterval(cleanSessions, 10 * 60 * 1000);

// Create session
app.post('/api/session/create', (req, res) => {
  const code = makeCode();
  sessions.set(code, { created: Date.now(), a: null, b: null, nameA: '', nameB: '', result: null });
  res.json({ code });
});

// Join session (get status)
app.get('/api/session/:code', (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({
    hasA: !!s.a, hasB: !!s.b,
    nameA: s.nameA, nameB: s.nameB,
    result: s.result
  });
});

// Submit drawing
app.post('/api/session/:code/submit', (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const { slot, imageData, name, pressureData } = req.body;
  if (slot === 'a') { s.a = imageData; s.nameA = name || 'Person A'; s.pressureA = pressureData; }
  if (slot === 'b') { s.b = imageData; s.nameB = name || 'Person B'; s.pressureB = pressureData; }
  res.json({ hasA: !!s.a, hasB: !!s.b });
});

// Analyse compatibility for session
app.post('/api/session/:code/analyze', async (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (!s.a || !s.b) return res.status(400).json({ error: 'Both drawings required' });
  if (s.result) return res.json(s.result);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const pressureNote = (pa, pb) => {
    if (!pa && !pb) return '';
    const fmt = p => p ? `avg ${(p.avg*100).toFixed(0)}%, peak ${(p.peak*100).toFixed(0)}%, light touches ${p.lightPct}%` : 'not available';
    return `\n\nPressure data — ${s.nameA}: ${fmt(pa)}; ${s.nameB}: ${fmt(pb)}. Factor this into energy/confidence readings.`;
  };

  const system = `You are an expert in projective psychological assessment (HTP technique) and interpersonal compatibility. Analyse two HTP drawings and provide a compatibility reading grounded in specific visual observations. Frame everything as personality insights, not clinical diagnosis.

Return ONLY valid JSON:
{
  "personA": { "summary":"2-sentence impression","traits":["t1","t2","t3"],"scores":{"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100} },
  "personB": { "summary":"...","traits":[...],"scores":{...} },
  "compatScore": 0-100,
  "compatLabel": "evocative short label",
  "sharedStrengths": "1-2 sentences",
  "growthEdges": "1-2 sentences",
  "chemistryNote": "1 evocative sentence"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5', max_tokens: 1400, system,
        messages: [{ role: 'user', content: [
          { type: 'text', text: `Two HTP drawings. First from ${s.nameA}, second from ${s.nameB}.${pressureNote(s.pressureA, s.pressureB)} Analyse individually then assess compatibility.` },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: s.a } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: s.b } }
        ]}]
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'Anthropic error', detail: await response.text() });
    const data = await response.json();
    let raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    s.result = JSON.parse(raw);
    res.json(s.result);
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Solo analysis
app.post('/api/analyze', async (req, res) => {
  const { imageData, subject, pressureData } = req.body;
  if (!imageData) return res.status(400).json({ error: 'imageData required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const subjectText = subject === 'all' ? 'a house, a tree, and a person (HTP assessment)' : 'a ' + subject;
  const pressureNote = pressureData
    ? ` Touch pressure data: avg ${(pressureData.avg*100).toFixed(0)}%, peak ${(pressureData.peak*100).toFixed(0)}%, light strokes ${pressureData.lightPct}%. Factor into energy and confidence readings.`
    : '';

  const system = `You are an expert in projective psychological assessment (HTP technique). Provide insightful interpretations grounded in specific visual observations. Frame all analysis as exploratory personality insights, not clinical diagnoses.

Return ONLY valid JSON:
{
  "overview": "2-3 sentence impression",
  "traits": ["trait1","trait2","trait3","trait4"],
  "house": "1-2 sentences (omit if no house)",
  "tree": "1-2 sentences (omit if no tree)",
  "person": "1-2 sentences (omit if no person)",
  "scores": {"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100},
  "shadow": "1 sentence hidden aspect"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5', max_tokens: 1200, system,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
          { type: 'text', text: `Analyse this HTP drawing. Subject drew ${subjectText}.${pressureNote}` }
        ]}]
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'Anthropic error', detail: await response.text() });
    const data = await response.json();
    let raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PsycheDraw running on port ' + PORT));
