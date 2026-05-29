const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, '../data/db.json');

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadDB() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return getDefaultDB();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch(e) { return getDefaultDB(); }
}

function saveDB(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getDefaultDB() {
  return {
    users: [
      {
        id: '1',
        email: 'admin@nexagrow.ma',
        name: 'Admin NexaGrow',
        password: '$2a$10$H5wVXfke5QdhLWIRoKlVeOv7MvM4RtGFBi57m9t0JtUIPLESTjSVG',
        role: 'admin', company: 'NexaGrow', plan: 'pro',
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        email: 'demo@nexagrow.ma',
        name: 'Demo PME',
        password: '$2a$10$9Fj7lFaNkI01F6rvr0wOcumrR3l9tqmOavcMuB/mrx1dGOom106P.',
        role: 'demo', company: 'Boutique Benali', plan: 'starter',
        createdAt: new Date().toISOString()
      }
    ],
    campaigns: [
      { id:'c1', userId:'2', name:'Meta – Été Collection', platform:'meta', status:'active', roas:5.2, spend:4200, revenue:21840, cpa:32, budget:5000, clicks:1320, impressions:84000, createdAt: new Date().toISOString() },
      { id:'c2', userId:'2', name:'Google – Brand Search', platform:'google', status:'active', roas:8.1, spend:1800, revenue:14580, cpa:18, budget:2000, clicks:890, impressions:32000, createdAt: new Date().toISOString() },
      { id:'c3', userId:'2', name:'TikTok – Reel Promo', platform:'tiktok', status:'warning', roas:1.4, spend:3100, revenue:4340, cpa:89, budget:3500, clicks:2100, impressions:180000, createdAt: new Date().toISOString() },
      { id:'c4', userId:'2', name:'Meta – Retargeting', platform:'meta', status:'active', roas:6.8, spend:900, revenue:6120, cpa:24, budget:1200, clicks:430, impressions:18000, createdAt: new Date().toISOString() },
      { id:'c5', userId:'2', name:'Google – Shopping', platform:'google', status:'paused', roas:3.2, spend:2600, revenue:8320, cpa:41, budget:3000, clicks:760, impressions:55000, createdAt: new Date().toISOString() }
    ],
    products: [
      { id:'p1', userId:'2', name:'Djellaba Premium S/M', sales:342, margin:48, stock:12, price:850, trend:'up', alert:true },
      { id:'p2', userId:'2', name:'Caftan Brodé L', sales:287, margin:52, stock:34, price:1200, trend:'up', alert:false },
      { id:'p3', userId:'2', name:'Babouche Artisanale', sales:89, margin:61, stock:156, price:220, trend:'down', alert:false },
      { id:'p4', userId:'2', name:'Caftan Enfant 6-8ans', sales:54, margin:38, stock:78, price:480, trend:'down', alert:false },
      { id:'p5', userId:'2', name:'Accessoires Tissu', sales:412, margin:71, stock:220, price:145, trend:'up', alert:false }
    ],
    chatHistories: {},
    integrations: {},
    alerts: [
      { id:'a1', userId:'2', type:'warning', msg:'TikTok – Reel Promo : ROAS 1.4× sous le seuil. Action requise.', time: new Date(Date.now()-720000).toISOString(), read:false },
      { id:'a2', userId:'2', type:'info', msg:'Stock Djellaba Premium S/M critique (12 unités). Rupture dans ~6h.', time: new Date(Date.now()-3600000).toISOString(), read:false },
      { id:'a3', userId:'2', type:'success', msg:'Meta – Été Collection dépasse 200% objectif mensuel.', time: new Date(Date.now()-10800000).toISOString(), read:true }
    ]
  };
}

module.exports = { loadDB, saveDB };
