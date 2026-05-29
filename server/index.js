require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fetch = require('node-fetch');
const { v4: uuid } = require('uuid');
const cron = require('node-cron');
const { loadDB, saveDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'nexagrow_secret_2026';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../public')));

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) { res.status(401).json({ error: 'Token invalide' }); }
}

// ── GROQ HELPER ──────────────────────────────────────────────────────────────
async function callGroq(messages, maxTokens = 1200) {
  if (!GROQ_KEY) throw new Error('Clé Groq API manquante. Configurez GROQ_API_KEY dans Railway Variables.');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
    body: JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq API error: ' + err);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

const SYSTEM_PROMPT = `Tu es l'agent IA de NexaGrow, suite marketing pour PME marocaines.
Tu parles français, darija marocaine et anglais selon la langue de l'utilisateur.
Tu es expert en : Meta Ads, Google Ads, TikTok Ads, Shopify, WooCommerce, e-commerce Maroc.
Réponds de façon professionnelle, concise et actionnable avec des chiffres précis.`;

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, company: user.company, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*86400000, sameSite: 'lax' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, plan: user.plan } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, company } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'Champs obligatoires manquants' });
  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: 'Email déjà utilisé' });
  const hash = await bcrypt.hash(password, 10);
  const user = { id: uuid(), email, name, password: hash, role: 'user', company: company || '', plan: 'starter', createdAt: new Date().toISOString() };
  db.users.push(user);
  saveDB(db);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, company: user.company, plan: user.plan }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, maxAge: 30*86400000, sameSite: 'lax' });
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, company: user.company, plan: user.plan } });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/campaigns', auth, (req, res) => {
  const db = loadDB();
  const campaigns = db.campaigns.filter(c => c.userId === req.user.id || req.user.role === 'demo');
  res.json(campaigns);
});

app.post('/api/campaigns', auth, (req, res) => {
  const db = loadDB();
  const camp = { id: uuid(), userId: req.user.id, createdAt: new Date().toISOString(), ...req.body };
  db.campaigns.push(camp);
  saveDB(db);
  res.json(camp);
});

app.put('/api/campaigns/:id', auth, (req, res) => {
  const db = loadDB();
  const idx = db.campaigns.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Campagne introuvable' });
  db.campaigns[idx] = { ...db.campaigns[idx], ...req.body, id: req.params.id };
  saveDB(db);
  res.json(db.campaigns[idx]);
});

app.delete('/api/campaigns/:id', auth, (req, res) => {
  const db = loadDB();
  db.campaigns = db.campaigns.filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/products', auth, (req, res) => {
  const db = loadDB();
  const products = db.products.filter(p => p.userId === req.user.id || req.user.role === 'demo');
  res.json(products);
});

app.post('/api/products', auth, (req, res) => {
  const db = loadDB();
  const prod = { id: uuid(), userId: req.user.id, createdAt: new Date().toISOString(), ...req.body };
  db.products.push(prod);
  saveDB(db);
  res.json(prod);
});

app.put('/api/products/:id', auth, (req, res) => {
  const db = loadDB();
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Produit introuvable' });
  db.products[idx] = { ...db.products[idx], ...req.body, id: req.params.id };
  saveDB(db);
  res.json(db.products[idx]);
});

app.delete('/api/products/:id', auth, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => p.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/alerts', auth, (req, res) => {
  const db = loadDB();
  const alerts = db.alerts.filter(a => a.userId === req.user.id || req.user.role === 'demo');
  res.json(alerts);
});

app.put('/api/alerts/:id/read', auth, (req, res) => {
  const db = loadDB();
  const alert = db.alerts.find(a => a.id === req.params.id);
  if (alert) { alert.read = true; saveDB(db); }
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/integrations', auth, (req, res) => {
  const db = loadDB();
  const integ = db.integrations[req.user.id] || { meta:true, google:true, tiktok:false, shopify:true, woo:false, presta:false };
  res.json(integ);
});

app.put('/api/integrations', auth, (req, res) => {
  const db = loadDB();
  db.integrations[req.user.id] = req.body;
  saveDB(db);
  res.json(req.body);
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI ROUTES (GROQ)
// ═══════════════════════════════════════════════════════════════════════════════

// Chat conversationnel
app.post('/api/ai/chat', auth, async (req, res) => {
  const { messages, context } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Messages invalides' });
  try {
    const db = loadDB();
    const userId = req.user.id === '2' ? '2' : req.user.id;
    const campaigns = db.campaigns.filter(c => c.userId === userId || req.user.role === 'demo');
    const products = db.products.filter(p => p.userId === userId || req.user.role === 'demo');

    const dataContext = `
Données actuelles de l'utilisateur :
Campagnes (${campaigns.length}): ${campaigns.map(c=>`${c.name} ROAS:${c.roas}× CPA:${c.cpa}MAD Statut:${c.status}`).join(', ')}
Produits (${products.length}): ${products.map(p=>`${p.name} ventes:${p.sales} marge:${p.margin}% stock:${p.stock}`).join(', ')}
CA semaine: 124 000 MAD | ROAS global: 4.7× | Marge: 31% | Abandon panier: 23%`;

    const systemWithData = SYSTEM_PROMPT + '\n\n' + dataContext;
    const fullMessages = [{ role: 'system', content: systemWithData }, ...messages.slice(-20)];
    const reply = await callGroq(fullMessages, 1200);

    // Save chat history
    if (!db.chatHistories) db.chatHistories = {};
    if (!db.chatHistories[req.user.id]) db.chatHistories[req.user.id] = [];
    db.chatHistories[req.user.id].push({ role:'user', content: messages[messages.length-1].content, ts: new Date().toISOString() });
    db.chatHistories[req.user.id].push({ role:'assistant', content: reply, ts: new Date().toISOString() });
    if (db.chatHistories[req.user.id].length > 100) db.chatHistories[req.user.id] = db.chatHistories[req.user.id].slice(-100);
    saveDB(db);

    res.json({ reply });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Rapport exécutif
app.post('/api/ai/report', auth, async (req, res) => {
  const { period } = req.body;
  try {
    const db = loadDB();
    const campaigns = db.campaigns.filter(c => c.userId === req.user.id || req.user.role === 'demo');
    const products = db.products.filter(p => p.userId === req.user.id || req.user.role === 'demo');
    const totalSpend = campaigns.reduce((a,c)=>a+c.spend,0);
    const totalRevenue = campaigns.reduce((a,c)=>a+c.revenue,0);
    const globalROAS = totalRevenue/totalSpend;

    const prompt = `Génère un rapport exécutif ${period||'hebdomadaire'} COMPLET et PROFESSIONNEL.

DONNÉES MARKETING:
${campaigns.map(c=>`- ${c.name}: ROAS ${c.roas}×, dépense ${c.spend} MAD, revenus ${c.revenue} MAD, CPA ${c.cpa} MAD, statut: ${c.status}`).join('\n')}
ROAS global: ${globalROAS.toFixed(1)}×
Budget total dépensé: ${totalSpend.toLocaleString()} MAD
CA total généré: ${totalRevenue.toLocaleString()} MAD

DONNÉES E-COMMERCE:
${products.map(p=>`- ${p.name}: ${p.sales} ventes, marge ${p.margin}%, stock ${p.stock} unités, tendance ${p.trend}`).join('\n')}
CA semaine: 124 000 MAD (+21%) | Panier moyen: 347 MAD | Abandon panier: 23% | Marge nette: 31%

Structure du rapport:
1. RÉSUMÉ EXÉCUTIF (3-4 lignes percutantes)
2. PERFORMANCES MARKETING (analyse par plateforme)
3. PERFORMANCES E-COMMERCE (top produits, alertes stock)
4. ALERTES PRIORITAIRES (classées par urgence)
5. TOP 5 RECOMMANDATIONS (avec ROI estimé)
6. OBJECTIFS SEMAINE PROCHAINE

Sois précis, chiffré, professionnel. Français.`;

    const report = await callGroq([{role:'user',content:prompt}], 2000);
    res.json({ report });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// A/B Testing
app.post('/api/ai/ab-test', auth, async (req, res) => {
  const { product, platform, goal, budget } = req.body;
  try {
    const prompt = `Génère 3 variantes A/B test complètes pour :
Produit: ${product}
Plateforme: ${platform}
Objectif: ${goal}
Budget total: ${budget} MAD

Pour chaque variante A, B, C :
- Headline (max 40 car.)
- Texte principal (max 125 car.)
- Call-to-action
- Audience cible avec paramètres précis
- Budget alloué sur ${budget} MAD
- KPIs cibles (ROAS, CPA, CTR attendus)
- Durée de test recommandée

Adapté au marché marocain. Sois très concret.`;
    const result = await callGroq([{role:'user',content:prompt}], 1500);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Copywriting
app.post('/api/ai/copy', auth, async (req, res) => {
  const { product, tone, platform, language } = req.body;
  try {
    const prompt = `Tu es expert copywriter pour le marché marocain.
Génère 5 textes publicitaires distincts :
Produit: ${product}
Ton: ${tone}
Plateforme: ${platform}
Langue: ${language}

Chaque texte: Hook + Corps + CTA + Hashtags si pertinent.
Varie les angles: urgence, émotion, preuve sociale, bénéfice, storytelling.`;
    const result = await callGroq([{role:'user',content:prompt}], 1500);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Audiences
app.post('/api/ai/audience', auth, async (req, res) => {
  const { product, platform, budget, goal } = req.body;
  try {
    const prompt = `Expert ciblage publicitaire marché marocain.
Génère 4 audiences cibles détaillées :
Produit: ${product} | Plateforme: ${platform} | Budget: ${budget} MAD/j | Objectif: ${goal}

Pour chaque audience:
- Nom et description
- Âge, genre, localisation (villes marocaines)
- Centres d'intérêt et comportements
- Taille estimée
- Budget suggéré
- ROAS attendu
Include: 1 lookalike + 1 remarketing.`;
    const result = await callGroq([{role:'user',content:prompt}], 1500);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Campaign creator
app.post('/api/ai/campaign', auth, async (req, res) => {
  const { platform, goal, budget, duration, product } = req.body;
  try {
    const prompt = `Expert Media Buyer marché marocain.
Crée un plan de campagne COMPLET:
Plateforme: ${platform} | Objectif: ${goal} | Budget: ${budget} MAD | Durée: ${duration} jours
Produit: ${product}

Fournis:
1. Structure campagne (Ad Sets avec paramètres)
2. Répartition budgétaire jour par jour
3. 3 audiences (paramètres précis)
4. 2 textes publicitaires prêts
5. Formats visuels recommandés
6. KPIs cibles (ROAS, CPA, CTR, CPM)
7. Planning horaires optimaux
8. Stratégie enchères
9. Plan optimisation semaine par semaine`;
    const result = await callGroq([{role:'user',content:prompt}], 2000);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Optimize campaign
app.post('/api/ai/optimize/:id', auth, async (req, res) => {
  const db = loadDB();
  const c = db.campaigns.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Campagne introuvable' });
  try {
    const ctr = c.impressions ? ((c.clicks/c.impressions)*100).toFixed(2) : 0;
    const prompt = `Expert Media Buyer. Analyse et optimise cette campagne:
Nom: ${c.name} | Plateforme: ${c.platform} | Statut: ${c.status}
Budget: ${c.budget} MAD | Dépensé: ${c.spend} MAD | Revenus: ${c.revenue} MAD
ROAS: ${c.roas}× | CPA: ${c.cpa} MAD | CTR: ${ctr}%
Clicks: ${c.clicks} | Impressions: ${c.impressions}

Fournis:
1. Diagnostic complet
2. Problèmes identifiés
3. 5 optimisations immédiates et actionnables
4. Ajustement budgétaire recommandé
5. Nouvelles audiences à tester
6. ROAS cible atteignable sous 2 semaines`;
    const result = await callGroq([{role:'user',content:prompt}], 1500);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Price suggestions
app.post('/api/ai/prices', auth, async (req, res) => {
  try {
    const db = loadDB();
    const products = db.products.filter(p => p.userId === req.user.id || req.user.role === 'demo');
    const prompt = `Expert pricing e-commerce marché marocain.
Analyse ces produits et suggère des prix optimisés:
${products.map(p=>`- ${p.name}: ${p.price} MAD, ${p.sales} ventes/sem, marge ${p.margin}%, stock ${p.stock}, tendance ${p.trend}`).join('\n')}

Pour chaque produit:
1. Prix actuel vs prix suggéré + justification
2. Impact sur marge et volume
3. Stratégie (premium/compétitif/liquidation)
4. Timing optimal du changement`;
    const result = await callGroq([{role:'user',content:prompt}], 1500);
    res.json({ result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Test Groq
app.get('/api/ai/test', auth, async (req, res) => {
  try {
    const r = await callGroq([{role:'user',content:'Réponds uniquement: "Groq OK - Llama 3 opérationnel"'}], 20);
    res.json({ ok: true, response: r, model: GROQ_MODEL });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/api/analytics/overview', auth, (req, res) => {
  const db = loadDB();
  const campaigns = db.campaigns.filter(c => c.userId === req.user.id || req.user.role === 'demo');
  const totalSpend = campaigns.reduce((a,c)=>a+c.spend,0);
  const totalRevenue = campaigns.reduce((a,c)=>a+c.revenue,0);
  const avgROAS = totalRevenue/totalSpend;
  const avgCPA = campaigns.reduce((a,c)=>a+c.cpa,0)/campaigns.length;
  res.json({
    roas: parseFloat(avgROAS.toFixed(1)),
    revenue: 124000,
    spend: totalSpend,
    cpa: parseFloat(avgCPA.toFixed(0)),
    margin: 31,
    orders: 1184,
    avgCart: 347,
    abandonRate: 23,
    revenueHistory: [38000,52000,47000,61000,58000,73000,69000,84000,79000,91000,88000,124000],
    months: ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════════════════════════════════

// Check campaigns every hour and auto-generate alerts
cron.schedule('0 * * * *', () => {
  const db = loadDB();
  db.campaigns.forEach(c => {
    if (c.roas < 2.5 && c.status === 'active') {
      const existing = db.alerts.find(a => a.msg.includes(c.name) && !a.read);
      if (!existing) {
        db.alerts.push({ id: uuid(), userId: c.userId, type:'warning', msg:`${c.name} : ROAS ${c.roas}× sous le seuil de rentabilité (2.5×). Vérification requise.`, time: new Date().toISOString(), read: false });
      }
    }
  });
  db.products.forEach(p => {
    if (p.stock < 20 && p.trend === 'up') {
      const existing = db.alerts.find(a => a.msg.includes(p.name) && !a.read);
      if (!existing) {
        db.alerts.push({ id: uuid(), userId: p.userId, type:'info', msg:`Stock critique : ${p.name} (${p.stock} unités restantes). Réapprovisionnement urgent recommandé.`, time: new Date().toISOString(), read: false });
      }
    }
  });
  saveDB(db);
  console.log('[CRON] Alertes vérifiées - ' + new Date().toLocaleTimeString());
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAGES
// ═══════════════════════════════════════════════════════════════════════════════

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../public/login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, '../public/register.html')));
app.get('/app', (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.redirect('/login');
  try { jwt.verify(token, JWT_SECRET); res.sendFile(path.join(__dirname, '../public/app.html')); }
  catch(e) { res.clearCookie('token'); res.redirect('/login'); }
});

app.get('/', (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try { jwt.verify(token, JWT_SECRET); return res.redirect('/app'); } catch(e) { res.clearCookie('token'); }
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('*', (req, res) => res.redirect('/'));

app.listen(PORT, () => {
  console.log(`\n✅ NexaGrow démarré sur http://localhost:${PORT}`);
  console.log(`👑 Admin : admin@nexagrow.ma / admin2026`);
  console.log(`🎯 Demo  : demo@nexagrow.ma  / demo`);
  console.log(`🦙 Groq  : ${GROQ_KEY ? 'Configuré ✓' : '⚠ GROQ_API_KEY manquante'}\n`);
});
