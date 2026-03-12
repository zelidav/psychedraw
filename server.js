const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', async (req, res) => {
  const { imageData, subject } = req.body;
  if (!imageData) return res.status(400).json({ error: 'imageData required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

  const subjectText = subject === 'all' ? 'a house, a tree, and a person (HTP assessment)' : 'a ' + subject;
  const system = `You are an expert in projective psychological assessment, specifically the House-Tree-Person (HTP) technique, with deep knowledge of clinical HTP literature (Buck, Hammer, Burns). Provide insightful, nuanced interpretations grounded in specific visual observations. Frame all analysis as exploratory personality insights, not clinical diagnoses.

Return ONLY a valid JSON object with:
{
  "overview": "2-3 sentence overall impression",
  "traits": ["trait1","trait2","trait3","trait4"],
  "house": "1-2 sentences (omit if no house)",
  "tree": "1-2 sentences (omit if no tree)",
  "person": "1-2 sentences (omit if no person)",
  "scores": { "openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100 },
  "shadow": "1 sentence about a hidden aspect"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5', max_tokens: 1200, system,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageData } },
          { type: 'text', text: 'Analyse this HTP drawing. The subject drew ' + subjectText + '.' }
        ]}]
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'Anthropic error', detail: await response.text() });
    const data = await response.json();
    let raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    res.json(JSON.parse(raw));
  } catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/compatibility', async (req, res) => {
  const { imageA, imageB, nameA = 'Person A', nameB = 'Person B' } = req.body;
  if (!imageA || !imageB) return res.status(400).json({ error: 'imageA and imageB required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set on server' });

  const system = `You are an expert in projective psychological assessment (HTP) and interpersonal compatibility analysis. Analyse two HTP drawings and provide a compatibility reading grounded in visual observations. Frame everything as personality insights, not clinical diagnosis.

Return ONLY valid JSON:
{
  "personA": { "summary":"2-sentence impression","traits":["t1","t2","t3"],"scores":{"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100} },
  "personB": { "summary":"...","traits":[...],"scores":{...} },
  "compatScore": 0-100,
  "compatLabel": "short evocative label",
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
          { type: 'text', text: 'Two HTP drawings. First from ' + nameA + ', second from ' + nameB + '. Analyse individually then assess compatibility.' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageA } },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB } }
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
