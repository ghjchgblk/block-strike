'use strict';
/*
 * 方塊突擊 Block Strike — 遊戲伺服器
 * 不需要安裝任何套件：node server.js 就能跑。
 * 功能：帳號（6 位數 ID）、好友邀請、組隊邀請、匹配、對戰訊息轉送。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const PUB = path.join(__dirname, 'public');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

/* ---------------- 資料儲存 ---------------- */
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); if (!db.users) db.users = {}; } catch (e) { /* 第一次啟動 */ }
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA, JSON.stringify(db), e => { if (e) console.error('存檔失敗：', e.message); });
  }, 1000);
}

/* ---------------- 網頁 ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (u === '/config.json') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }); return res.end(JSON.stringify({ googleClientId: GOOGLE_CLIENT_ID })); }
  const f = path.normalize(path.join(PUB, u === '/' ? 'index.html' : u));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  });
});

/* ---------------- WebSocket（手寫，免安裝套件） ---------------- */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();
server.on('upgrade', (req, sock) => {
  if (req.url.split('?')[0] !== '/ws' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  new Client(sock);
});

class Client {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = null; this.uid = null; this.alive = true; this.closed = false;
    clients.add(this);
    sock.on('data', d => this.onData(d));
    sock.on('close', () => this.onClose());
    sock.on('error', () => {});
  }
  onData(d) {
    this.alive = true;
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > (1 << 20)) { this.sock.destroy(); return; }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > (1 << 20)) { this.sock.destroy(); return; }
      const ml = masked ? 4 : 0;
      if (b.length < off + ml + len) return;
      let payload = Buffer.from(b.subarray(off + ml, off + ml + len));
      if (masked) { const mask = b.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = b.subarray(off + ml + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        if (!fin) { this.frag = this.frag ? Buffer.concat([this.frag, payload]) : payload; continue; }
        if (this.frag) { payload = Buffer.concat([this.frag, payload]); this.frag = null; }
        let m; try { m = JSON.parse(payload.toString('utf8')); } catch (e) { continue; }
        if (!m || typeof m !== 'object') continue;
        try { handle(this, m); } catch (e) { console.error('處理訊息出錯：', e); }
      }
    }
  }
  frame(op, data) {
    if (this.sock.destroyed) return;
    const len = data.length; let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([h, data]));
  }
  send(o) { this.frame(1, Buffer.from(JSON.stringify(o))); }
  close() { try { this.frame(8, Buffer.alloc(0)); } catch (e) {} this.sock.end(); setTimeout(() => this.sock.destroy(), 200); }
  onClose() { if (this.closed) return; this.closed = true; clients.delete(this); disconnect(this); }
}
// 每 25 秒 ping 一次，清掉斷線的連線
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.sock.destroy(); continue; }
    c.alive = false; c.frame(9, Buffer.alloc(0));
  }
}, 25000);

/* ---------------- 遊戲狀態 ---------------- */
const online = new Map();   // uid -> Client
const parties = new Map();  // pid -> {id, leader, members[], map, diff, queued, qAt, invites:Set, solo}
const partyOf = new Map();  // uid -> pid
const matches = new Map();  // mid -> {id, players:Set, host, map}
const matchOf = new Map();  // uid -> mid
let seq = 1;
const BOT_NAMES = ['Shadow_X', '小火龍', 'NoobMaster', '阿凱', 'Luna77', '爆頭王', 'BlockKing', 'Pixel_Pro', '夜貓子', 'TurboTom', '星辰', 'Rex2026', 'KK醬', 'Ghost', '小胖', 'Nova'];

const user = id => db.users[id];
const isId = s => /^\d{6}$/.test(s);
const clampMap = m => Math.max(0, Math.min(4, Number(m) || 0));
function newId() { let id; do { id = String(100000 + Math.floor(Math.random() * 900000)); } while (db.users[id]); return id; }
function cleanName(n) { n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12); return n || '玩家'; }
function sendTo(uid, o) { const c = online.get(uid); if (c) c.send(o); }
function toast(uid, msg) { sendTo(uid, { t: 'toast', msg }); }
function status(uid) {
  if (!online.has(uid)) return 'offline';
  if (matchOf.has(uid)) return 'ingame';
  const p = parties.get(partyOf.get(uid));
  return p && p.queued ? 'queue' : 'online';
}
function pushFriends(uid) {
  const u = user(uid); if (!u || !online.has(uid)) return;
  sendTo(uid, {
    t: 'friends',
    list: u.friends.filter(f => user(f)).map(f => ({ id: f, name: user(f).name, status: status(f) })),
    reqIn: u.reqIn.filter(f => user(f)).map(f => ({ id: f, name: user(f).name })),
    reqOut: Object.values(db.users).filter(x => x.id !== uid && x.reqIn.includes(uid)).map(x => ({ id: x.id, name: x.name })),
  });
}
function notifyFriends(uid) { const u = user(uid); if (u) for (const f of u.friends) pushFriends(f); }
function partyView(p) { return { id: p.id, leader: p.leader, map: p.map, members: p.members.map(m => ({ id: m, name: user(m).name })) }; }
function pushParty(p) { const v = partyView(p); for (const m of p.members) sendTo(m, { t: 'party', party: v }); }
function makeParty(leader, map, solo) {
  const p = { id: 'p' + (seq++), leader, members: [leader], map: clampMap(map), diff: 1, queued: false, qAt: 0, invites: new Set(), solo: !!solo };
  parties.set(p.id, p); partyOf.set(leader, p.id); return p;
}
function setQueued(p, on) {
  p.queued = on; if (on) p.qAt = Date.now();
  for (const m of p.members) { sendTo(m, { t: 'queue', state: on ? 'searching' : 'idle', map: p.map }); notifyFriends(m); }
}
function leaveParty(uid) {
  const pid = partyOf.get(uid); if (!pid) return;
  const p = parties.get(pid); partyOf.delete(uid);
  sendTo(uid, { t: 'party', party: null });
  if (!p) return;
  if (p.queued) { sendTo(uid, { t: 'queue', state: 'idle' }); setQueued(p, false); }
  p.members = p.members.filter(m => m !== uid);
  if (p.members.length <= 1) {
    for (const m of p.members) { partyOf.delete(m); sendTo(m, { t: 'party', party: null }); }
    parties.delete(pid);
  } else {
    if (p.leader === uid) p.leader = p.members[0];
    pushParty(p);
  }
  notifyFriends(uid); for (const m of p.members) notifyFriends(m);
}
function makeFriends(a, b) {
  const A = user(a), B = user(b);
  A.reqIn = A.reqIn.filter(x => x !== b); B.reqIn = B.reqIn.filter(x => x !== a);
  if (!A.friends.includes(b)) A.friends.push(b);
  if (!B.friends.includes(a)) B.friends.push(a);
  save();
  toast(a, '你和 ' + B.name + ' 成為好友了！'); toast(b, '你和 ' + A.name + ' 成為好友了！');
  pushFriends(a); pushFriends(b);
}
function leaveMatch(uid) {
  const mid = matchOf.get(uid); if (!mid) return;
  matchOf.delete(uid);
  const mt = matches.get(mid); if (!mt) return;
  mt.players.delete(uid);
  for (const x of mt.players) sendTo(x, { t: 'left', id: uid });
  if (!mt.players.size) matches.delete(mid);
  else if (mt.host === uid) { mt.host = [...mt.players][0]; for (const x of mt.players) sendTo(x, { t: 'host', id: mt.host }); }
  notifyFriends(uid);
}
function disconnectUid(c) { const uid = c.uid; if (!uid) return; if (online.get(uid) === c) { online.delete(uid); leaveMatch(uid); leaveParty(uid); notifyFriends(uid); } c.uid = null; }
function disconnect(c) {
  const uid = c.uid; if (!uid || online.get(uid) !== c) return;
  online.delete(uid);
  leaveMatch(uid); leaveParty(uid); notifyFriends(uid);
}

/* ---------------- 帳號：註冊、登入、Google 登入、遊玩紀錄 ---------------- */
const unameIdx = new Map(), gsubIdx = new Map();
function reindex() { unameIdx.clear(); gsubIdx.clear(); for (const u of Object.values(db.users)) { if (u.username) unameIdx.set(u.username, u.id); if (u.gsub) gsubIdx.set(u.gsub, u.id); } }
reindex();
function hashPw(pw, salt) { salt = salt || crypto.randomBytes(12).toString('hex'); return salt + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex'); }
function checkPw(pw, stored) { if (!stored) return false; const [salt, h] = stored.split(':'); const a = Buffer.from(hashPw(pw, salt).split(':')[1], 'hex'), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function blankStats() { return { coins: 100, xp: 0, skins: [[], [], [], []], equip: [-1, -1, -1, -1], kills: 0, deaths: 0, wins: 0, matches: 0 }; }
const int = (v, lo, hi, d) => { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
function cleanStats(x, base) {
  const o = Object.assign(blankStats(), base || {}); x = x || {};
  if ('coins' in x) o.coins = int(x.coins, 0, 1e7, o.coins);
  if ('xp' in x) o.xp = int(x.xp, 0, 1e8, o.xp);
  if (Array.isArray(x.skins)) o.skins = [0, 1, 2, 3].map(i => Array.isArray(x.skins[i]) ? [...new Set(x.skins[i].map(n => int(n, 0, 9, 0)))] : []);
  if (Array.isArray(x.equip)) o.equip = [0, 1, 2, 3].map(i => int(x.equip[i], -1, 9, -1));
  for (const k of ['kills', 'deaths', 'wins', 'matches']) if (k in x) o[k] = int(x[k], 0, 1e7, o[k]);
  return o;
}
const validUser = s => /^[A-Za-z0-9_]{3,16}$/.test(s);
function newUser(name) { const id = newId(); return db.users[id] = { id, token: crypto.randomBytes(16).toString('hex'), name: cleanName(name), friends: [], reqIn: [], stats: blankStats() }; }
function verifyGoogle(cred) {
  return new Promise(res => {
    if (!GOOGLE_CLIENT_ID || !cred) return res(null);
    https.get('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(cred)), r => {
      let d = ''; r.on('data', x => d += x);
      r.on('end', () => { try { const j = JSON.parse(d); res(r.statusCode === 200 && j.aud === GOOGLE_CLIENT_ID && j.sub && /accounts\.google\.com$/.test(j.iss) ? j : null); } catch (e) { res(null); } });
    }).on('error', () => res(null));
  });
}
function authErr(c, msg) { c.send({ t: 'authErr', msg }); }
function attach(c, u) {
  if (!u.stats) u.stats = blankStats();
  save();
  const id = u.id, old = online.get(id);
  if (old && old !== c) { leaveMatch(id); leaveParty(id); old.uid = null; old.send({ t: 'needAuth', kicked: true }); }
  c.uid = id; c.legacy = null; online.set(id, c);
  c.send({ t: 'welcome', me: { id, token: u.token, name: u.name, username: u.username || '', google: !!u.gsub }, stats: u.stats, cache: { pw: u.pw || '', gsub: u.gsub || '' } });
  pushFriends(id); notifyFriends(id);
  const p = parties.get(partyOf.get(id)); if (p) pushParty(p);
}
async function authHandle(c, m) {
  if (m.t === 'register') {
    const un = String(m.username || '').trim(), pw = String(m.password || '');
    if (!validUser(un)) return authErr(c, '帳號要 3～16 個字，只能用英文、數字或底線 _');
    if (pw.length < 4 || pw.length > 64) return authErr(c, '密碼至少要 4 個字');
    if (unameIdx.has(un.toLowerCase())) return authErr(c, '這個帳號已經有人用了，換一個試試');
    const leg = c.legacy && db.users[c.legacy] && !db.users[c.legacy].username && !db.users[c.legacy].gsub ? db.users[c.legacy] : null;
    let u = leg || newUser(m.name || un);
    u.stats = cleanStats(m.stats, leg && leg.stats);   // 把這台裝置上原本的金幣、皮膚帶進新帳號
    u.username = un.toLowerCase(); u.pw = hashPw(pw); if (m.name) u.name = cleanName(m.name);
    unameIdx.set(u.username, u.id); toast2(c, '註冊成功！歡迎加入方塊突擊'); return attach(c, u);
  }
  if (m.t === 'login') {
    const id = unameIdx.get(String(m.username || '').trim().toLowerCase()), u = id && db.users[id];
    if (!u || !checkPw(m.password, u.pw)) return authErr(c, '帳號或密碼不對');
    return attach(c, u);
  }
  if (m.t === 'google') {
    if (!GOOGLE_CLIENT_ID) return authErr(c, '這個伺服器還沒設定 Google 登入');
    const g = await verifyGoogle(m.credential);
    if (!g) return authErr(c, 'Google 登入失敗，請再試一次');
    let u = db.users[gsubIdx.get(g.sub)];
    if (!u) { u = newUser(g.given_name || g.name || '玩家'); u.gsub = g.sub; gsubIdx.set(g.sub, u.id); toast2(c, '已用 Google 註冊，歡迎加入！'); }
    return attach(c, u);
  }
}
function toast2(c, msg) { c.send({ t: 'toast', msg }); }

/* ---------------- 登入 ---------------- */
function hello(c, m) {
  if (c.uid) return;
  const id = String(m.id || ''), tok = String(m.token || '');
  let u = db.users[id];
  if (u && u.token === tok) {
    if (u.username || u.gsub) return attach(c, u);
    c.legacy = id; return c.send({ t: 'needAuth', legacy: true });          // 舊版沒有帳號密碼的玩家：註冊後保留好友
  }
  // 伺服器重開、資料不見了：用玩家這台裝置記住的帳號資料還原（包含遊玩紀錄）
  const k = m.cache || {};
  if (!u && isId(id) && tok.length >= 16 && (k.username || k.gsub)) {
    const un = String(k.username || '').toLowerCase();
    if ((!un || !unameIdx.has(un)) && (!k.gsub || !gsubIdx.has(String(k.gsub)))) {
      u = db.users[id] = { id, token: tok, name: cleanName(k.name || m.name), friends: [], reqIn: [], stats: cleanStats(k.stats) };
      if (un && validUser(un)) { u.username = un; u.pw = String(k.pw || ''); unameIdx.set(un, id); }
      if (k.gsub) { u.gsub = String(k.gsub); gsubIdx.set(u.gsub, id); }
      for (const f of (Array.isArray(k.friends) ? k.friends : []).slice(0, 200)) { const fid = String(f); if (isId(fid) && fid !== id && !u.friends.includes(fid)) u.friends.push(fid); }
      return attach(c, u);
    }
  }
  c.send({ t: 'needAuth' });
}

/* ---------------- 訊息處理 ---------------- */
function handle(c, m) {
  if (m.t === 'hello') return hello(c, m);
  if (m.t === 'register' || m.t === 'login' || m.t === 'google') { if (!c.uid) authHandle(c, m); return; }
  if (m.t === 'ping') return c.send({ t: 'pong' });
  const uid = c.uid; if (!uid) return;
  const u = user(uid); if (!u) return;
  const myParty = () => parties.get(partyOf.get(uid));

  switch (m.t) {
    case 'logout': { disconnectUid(c); c.send({ t: 'needAuth' }); break; }
    case 'saveStats': { u.stats = cleanStats(Object.assign({}, m.stats, { kills: undefined, deaths: undefined, wins: undefined, matches: undefined }), u.stats); for (const k of ['kills','deaths','wins','matches']) u.stats[k] = (u.stats[k] || 0); save(); break; }
    case 'matchResult': {
      const st = u.stats || (u.stats = blankStats());
      st.kills += int(m.kills, 0, 300, 0); st.deaths += int(m.deaths, 0, 300, 0); st.matches += 1; if (m.win) st.wins += 1;
      save(); c.send({ t: 'stats', stats: st }); break;
    }
    case 'setName': {
      u.name = cleanName(m.name); save(); notifyFriends(uid);
      const p = myParty(); if (p) pushParty(p);
      break;
    }
    case 'friendAdd': {
      const id = String(m.id || '').trim(), t = user(id);
      if (!t) return toast(uid, '找不到 ID ' + id + ' 的玩家');
      if (id === uid) return toast(uid, '不能加自己為好友');
      if (u.friends.includes(id)) return toast(uid, t.name + ' 已經是你的好友了');
      if (u.reqIn.includes(id)) return makeFriends(uid, id);   // 對方也邀請過我 → 直接成為好友
      if (!t.reqIn.includes(uid)) { t.reqIn.push(uid); save(); }
      toast(uid, '已送出好友邀請給 ' + t.name);
      toast(id, u.name + ' 想加你為好友，到好友欄通過就可以了');
      pushFriends(id); pushFriends(uid);
      break;
    }
    case 'friendAccept': { const id = String(m.id); if (u.reqIn.includes(id) && user(id)) makeFriends(uid, id); break; }
    case 'friendDecline': { const id = String(m.id); u.reqIn = u.reqIn.filter(x => x !== id); save(); pushFriends(uid); pushFriends(id); break; }
    case 'friendCancel': { const id = String(m.id), t = user(id); if (t) { t.reqIn = t.reqIn.filter(x => x !== uid); save(); pushFriends(id); } pushFriends(uid); break; }
    case 'friendRemove': {
      const id = String(m.id), t = user(id);
      u.friends = u.friends.filter(x => x !== id);
      if (t) t.friends = t.friends.filter(x => x !== uid);
      save(); pushFriends(uid); pushFriends(id);
      break;
    }
    case 'partyInvite': {
      const id = String(m.id), t = user(id);
      if (!t || !u.friends.includes(id)) return;
      if (!online.has(id)) return toast(uid, t.name + ' 不在線上');
      if (matchOf.has(id)) return toast(uid, t.name + ' 正在對戰中');
      let p = myParty();
      if (p && p.leader !== uid) return toast(uid, '只有隊長可以邀請');
      if (p && p.queued) return toast(uid, '匹配中不能邀請，請先取消匹配');
      if (p && p.members.length >= 4) return toast(uid, '隊伍已滿');
      if (p && p.members.includes(id)) return;
      if (!p) { p = makeParty(uid, m.map); pushParty(p); }
      p.invites.add(id);
      sendTo(id, { t: 'invite', party: p.id, from: uid, name: u.name });
      toast(uid, '已邀請 ' + t.name + '，等對方接受');
      break;
    }
    case 'partyAccept': {
      const p = parties.get(String(m.party));
      if (!p || !p.invites.has(uid)) return toast(uid, '這個邀請已經失效了');
      if (matchOf.has(uid)) return;
      if (p.members.length >= 4) return toast(uid, '隊伍已滿');
      if (p.queued) return toast(uid, '對方正在匹配中，請稍後再試');
      leaveParty(uid);
      p.invites.delete(uid); p.members.push(uid); partyOf.set(uid, p.id);
      pushParty(p);
      for (const x of p.members) notifyFriends(x);
      for (const x of p.members) if (x !== uid) toast(x, u.name + ' 加入了隊伍！');
      break;
    }
    case 'partyLeave': leaveParty(uid); break;
    case 'partyKick': {
      const p = myParty(), id = String(m.id);
      if (!p || p.leader !== uid || id === uid || !p.members.includes(id)) return;
      leaveParty(id); toast(id, '你被移出隊伍了');
      break;
    }
    case 'partyMap': { const p = myParty(); if (p && p.leader === uid) { p.map = clampMap(m.map); pushParty(p); } break; }
    case 'queue': {
      if (matchOf.has(uid)) return;
      let p = myParty();
      if (p && p.leader !== uid) return;
      if (!p) p = makeParty(uid, m.map, true);
      if (p.queued) return;
      p.map = clampMap(m.map); p.diff = Math.max(0, Math.min(2, Number(m.diff) || 0));
      setQueued(p, true);
      break;
    }
    case 'unqueue': {
      const p = myParty(); if (!p || p.leader !== uid || !p.queued) return;
      setQueued(p, false);
      if (p.solo) { parties.delete(p.id); partyOf.delete(uid); }
      break;
    }
    case 'm': { // 對戰中的訊息：轉送給同一場的其他玩家
      const mt = matches.get(matchOf.get(uid)); if (!mt) return;
      const buf = Buffer.from(JSON.stringify({ t: 'm', from: uid, d: m.d }));
      if (buf.length > 8000) return;
      for (const x of mt.players) if (x !== uid) { const cc = online.get(x); if (cc) cc.frame(1, buf); }
      break;
    }
    case 'matchLeave': leaveMatch(uid); break;
  }
}

/* ---------------- 匹配 ---------------- */
// 同一張地圖的隊伍會被湊在一起；湊滿 8 個真人或最久的等了 6 秒就開打，空位補 AI。
const WAIT_MS = 6000;
setInterval(() => {
  const queued = [...parties.values()].filter(p => p.queued).sort((a, b) => a.qAt - b.qAt);
  const byMap = {};
  for (const p of queued) (byMap[p.map] = byMap[p.map] || []).push(p);
  for (const k in byMap) {
    let list = byMap[k];
    while (list.length) {
      const total = list.reduce((s, p) => s + p.members.length, 0);
      if (total < 8 && Date.now() - list[0].qAt < WAIT_MS) break;
      const teams = [[], []], used = [];
      for (const p of list) {
        const t = teams[0].length <= teams[1].length ? 0 : 1;
        if (teams[t].length + p.members.length <= 4) { teams[t].push(...p.members); used.push(p); }
        else if (teams[1 - t].length + p.members.length <= 4) { teams[1 - t].push(...p.members); used.push(p); }
      }
      if (!used.length) break;
      startMatch(Number(k), teams, used, list[0].diff);
      list = list.filter(p => !used.includes(p));
    }
  }
}, 1000);

function startMatch(map, teams, used, diff) {
  const id = 'm' + (seq++);
  const players = [];
  teams.forEach((t, ti) => t.forEach(uid => players.push({ id: uid, name: user(uid).name, team: ti })));
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  const bots = []; let bi = 0;
  for (let ti = 0; ti < 2; ti++) for (let i = teams[ti].length; i < 4; i++) bots.push({ id: 'b' + (bi++), name: names.pop() + ' [AI]', team: ti });
  const mt = { id, players: new Set(players.map(p => p.id)), host: players[0].id, map };
  matches.set(id, mt);
  for (const p of used) {
    p.queued = false;
    if (p.solo) { parties.delete(p.id); for (const m of p.members) partyOf.delete(m); }
  }
  for (const p of players) matchOf.set(p.id, id);
  for (const p of players) sendTo(p.id, { t: 'match', id, map, diff, host: mt.host, players, bots, me: p.id });
  for (const p of players) notifyFriends(p.id);
  console.log(`對戰 ${id} 開始：地圖 ${map}，真人 ${players.length} 位`);
}

server.listen(PORT, () => console.log('方塊突擊伺服器已啟動：http://localhost:' + PORT));
