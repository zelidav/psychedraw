const express = require('express');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '20mb' }));
// Force no-cache for index.html so browsers always get fresh JS
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ââ SESSION STORE ââââââââââââââââââââââââââââââââââââââââââââââââ
const sessions = new Map();
function makeCode() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
setInterval(() => { const now=Date.now(); for(const [k,v] of sessions) if(now-v.created>7200000) sessions.delete(k); }, 600000);

app.post('/api/session/create', (req, res) => {
  const code = makeCode();
  sessions.set(code, { created: Date.now(), a: null, b: null, nameA:'', nameB:'', pressureA:null, pressureB:null, result:null });
  res.json({ code });
});

app.get('/api/session/:code', (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json({ hasA:!!s.a, hasB:!!s.b, nameA:s.nameA, nameB:s.nameB, result:s.result });
});

app.post('/api/session/:code/submit', (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  const { slot, images, name, pressureData } = req.body;
  if (slot==='a') { s.a=images; s.nameA=name||'Person A'; s.pressureA=pressureData; }
  if (slot==='b') { s.b=images; s.nameB=name||'Person B'; s.pressureB=pressureData; }
  res.json({ hasA:!!s.a, hasB:!!s.b });
});

app.post('/api/session/:code/analyze', async (req, res) => {
  const s = sessions.get(req.params.code.toUpperCase());
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (!s.a || !s.b) return res.status(400).json({ error: 'Both drawings required' });
  if (s.result) return res.json(s.result);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const system = buildCompatSystem();
  const imagesA = s.a.map(img => ({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:img }}));
  const imagesB = s.b.map(img => ({ type:'image', source:{ type:'base64', media_type:'image/jpeg', data:img }}));

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model:'claude-opus-4-5', max_tokens:1800, system,
        messages:[{ role:'user', content:[
          { type:'text', text:'Three HTP drawings from '+s.nameA+' (house, tree, person in order):' },
          ...imagesA,
          { type:'text', text:'Three HTP drawings from '+s.nameB+' (house, tree, person in order):' },
          ...imagesB,
          { type:'text', text:'Analyse both individuals and their compatibility.' }
        ]}]
      })
    });
    if (!response.ok) return res.status(502).json({ error:'Anthropic error', detail: await response.text() });
    const data = await response.json();
    let raw = data.content[0].text.trim().replace(/```json|```/g,'').trim();
    s.result = JSON.parse(raw);
    res.json(s.result);
  } catch(err) { res.status(500).json({ error:err.message }); }
});

app.post('/api/analyze', async (req, res) => {
  const { images, pressureData } = req.body;
  if (!images || !images.length) return res.status(400).json({ error:'images required' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error:'ANTHROPIC_API_KEY not set' });

  const pressureNote = pressureData
    ? ' Touch pressure: avg '+(pressureData.avg*100).toFixed(0)+'%, peak '+(pressureData.peak*100).toFixed(0)+'%, light strokes '+pressureData.lightPct+'%. Factor into energy/confidence.'
    : '';

  const system = buildSoloSystem();
  const imageBlocks = images.map((img,i) => [
    { type:'text', text:['House drawing:','Tree drawing:','Person drawing:'][i]||'Drawing '+(i+1)+':' },
    { type:'image', source:{ type:'base64', media_type:'image/jpeg', data:img }}
  ]).flat();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model:'claude-opus-4-5', max_tokens:1400, system,
        messages:[{ role:'user', content:[
          ...imageBlocks,
          { type:'text', text:'Analyse these three HTP drawings as a set.'+pressureNote }
        ]}]
      })
    });
    if (!response.ok) return res.status(502).json({ error:'Anthropic error', detail: await response.text() });
    const data = await response.json();
    let raw = data.content[0].text.trim().replace(/```json|```/g,'').trim();
    res.json(JSON.parse(raw));
  } catch(err) { res.status(500).json({ error:err.message }); }
});

function buildSoloSystem() {
  return `You are an expert in projective psychological assessment (HTP technique) with knowledge of MBTI personality typing. Analyse three drawings (house, tree, person) as a unified psychological portrait. Be specific, warm, and insightful â not clinical.

Return ONLY valid JSON:
{
  "overview": "2-3 sentence overall impression, written conversationally",
  "traits": ["trait1","trait2","trait3","trait4"],
  "house": "1-2 sentences about what the house reveals",
  "tree": "1-2 sentences about what the tree reveals",
  "person": "1-2 sentences about what the person reveals",
  "scores": {"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100},
  "mbti": {
    "type": "ENFP",
    "ei": 65,
    "sn": 72,
    "tf": 58,
    "jp": 61,
    "eiLabel": "Extrovert",
    "snLabel": "Intuitive",
    "tfLabel": "Feeling",
    "jpLabel": "Perceiving",
    "sketch": "2-sentence character sketch of this MBTI type as expressed in the drawing"
  },
  "shadow": "1 sentence about a hidden or shadow aspect"
}
ei/sn/tf/jp are 0-100 where 100 = fully E/N/F/P and 0 = fully I/S/T/J.`;
}

function buildCompatSystem() {
  return `You are an expert in projective psychological assessment (HTP technique), MBTI personality typing, and interpersonal compatibility. Analyse two sets of three drawings each (house, tree, person) and provide both individual profiles and a compatibility reading. Be warm, specific, and fun â not clinical.

Return ONLY valid JSON:
{
  "personA": {
    "summary": "2-sentence impression",
    "traits": ["t1","t2","t3"],
    "scores": {"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100},
    "mbti": { "type":"ENFP","ei":65,"sn":72,"tf":58,"jp":61,"eiLabel":"Extrovert","snLabel":"Intuitive","tfLabel":"Feeling","jpLabel":"Perceiving","sketch":"2-sentence sketch" }
  },
  "personB": {
    "summary": "2-sentence impression",
    "traits": ["t1","t2","t3"],
    "scores": {"openness":0-100,"structure":0-100,"energy":0-100,"social":0-100,"creativity":0-100},
    "mbti": { "type":"ISTJ","ei":35,"sn":28,"tf":62,"jp":40,"eiLabel":"Introvert","snLabel":"Sensing","tfLabel":"Thinking","jpLabel":"Judging","sketch":"2-sentence sketch" }
  },
  "compatScore": 0-100,
  "compatLabel": "evocative short label e.g. 'Creative friction' or 'Deep resonance'",
  "sharedStrengths": "1-2 sentences",
  "growthEdges": "1-2 sentences",
  "chemistryNote": "1 fun evocative sentence â cocktail napkin energy"
}
ei/sn/tf/jp: 100=fully E/N/F/P, 0=fully I/S/T/J.`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('PsycheDraw on port ' + PORT));
