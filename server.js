// Editor login API: Node 18+, MongoDB Atlas (free M0). Stores only a salted hash of the password.
const http = require('http'), crypto = require('crypto');

const DAY = 864e5, PASS_DAYS = 30;
function razorpayOrder(env) {
  return async (amount, receipt) => {
    const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET).toString('base64') }, body: JSON.stringify({ amount, currency: 'INR', receipt }) });
    if (!r.ok) throw new Error('razorpay ' + r.status);
    return r.json();
  };
}
function makeHandler(users, opt = {}) {
  const env = opt.env || process.env, now = opt.now || (() => Date.now());
  const price = +env.PRICE_PAISE || 4900;               // Rs 49 in paise
  const proEmails = String(env.PRO_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const createOrder = opt.createOrder || razorpayOrder(env);
  const info = (d, key) => { const until = Math.max(+d.premiumUntil || 0, proEmails.includes(key) ? now() + PASS_DAYS * DAY : 0); return { pro: until > now(), until }; };
  const hits = new Map();
  const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(x => n - x < 60000); a.push(n); hits.set(ip, a); return a.length > 30; };
  const scrypt = (h, salt) => new Promise((ok, no) => crypto.scrypt(h, salt, 32, (e, k) => e ? no(e) : ok(k.toString('hex'))));
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' }); res.end(JSON.stringify(obj)); };
  return async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      if (req.method === 'GET') return send(res, 200, { ok: 1, service: 'editor-login' });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4096) return send(res, 413, { error: 'Too large' }); }
      let b; try { b = JSON.parse(raw || '{}'); } catch (_) { return send(res, 400, { error: 'Bad request' }); }
      const key = String(b.key || '').toLowerCase().slice(0, 120), h = String(b.h || '');
      if (key.length < 5 || !/^[0-9a-f]{64}$/.test(h)) return send(res, 400, { error: 'Bad details' });
      const check = async () => { const d = await users.findOne({ _id: key }); if (!d) return null; const a = Buffer.from(await scrypt(h, d.salt), 'hex'), c = Buffer.from(d.ph, 'hex'); return a.length === c.length && crypto.timingSafeEqual(a, c) ? d : false; };
      if (req.url.startsWith('/status') || req.url.startsWith('/pay/')) {
        const d = await check();
        if (d === null) return send(res, 404, { error: 'No account' });
        if (d === false) return send(res, 401, { error: 'Wrong details' });
        if (req.url.startsWith('/status')) return send(res, 200, { ok: 1, ...info(d, key), price });
        if (req.url.startsWith('/pay/order')) {
          if (!env.RAZORPAY_KEY_ID && !opt.createOrder) return send(res, 503, { error: 'Payments are not set up on the server yet' });
          const o = await createOrder(price, 'ed_' + key.slice(0, 20) + '_' + now());
          await users.updateOne({ _id: key }, { $addToSet: { orders: o.id } });
          return send(res, 200, { ok: 1, orderId: o.id, amount: price, currency: 'INR', keyId: env.RAZORPAY_KEY_ID || '' });
        }
        if (req.url.startsWith('/pay/verify')) {
          const oid = String(b.orderId || ''), pid = String(b.paymentId || ''), sig = String(b.signature || '');
          const want = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET || '').update(oid + '|' + pid).digest('hex');
          const x = Buffer.from(want), y = Buffer.from(sig);
          if (!oid || !pid || x.length !== y.length || !crypto.timingSafeEqual(x, y)) return send(res, 400, { error: 'Payment could not be verified' });
          if (!(d.orders || []).includes(oid)) return send(res, 400, { error: 'Unknown order' });
          if ((d.paid || []).includes(pid)) return send(res, 200, { ok: 1, ...info(d, key) });
          const until = Math.max(now(), +d.premiumUntil || 0) + PASS_DAYS * DAY;
          await users.updateOne({ _id: key }, { $set: { premiumUntil: until }, $addToSet: { paid: pid } });
          return send(res, 200, { ok: 1, pro: true, until });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (req.url.startsWith('/signup')) {
        const name = String(b.name || 'Creator').slice(0, 60), kind = b.kind === 'phone' ? 'phone' : 'email';
        if (await users.findOne({ _id: key })) return send(res, 409, { error: 'Account exists' });
        const salt = crypto.randomBytes(16).toString('hex'), joined = Date.now();
        try { await users.insertOne({ _id: key, name, kind, joined, salt, ph: await scrypt(h, salt) }); }
        catch (e) { if (e && e.code === 11000) return send(res, 409, { error: 'Account exists' }); throw e; }
        return send(res, 201, { ok: 1, name, kind, joined });
      }
      if (req.url.startsWith('/login')) {
        const d = await users.findOne({ _id: key });
        if (!d) return send(res, 404, { error: 'No account' });
        const a = Buffer.from(await scrypt(h, d.salt), 'hex'), c = Buffer.from(d.ph, 'hex');
        if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) return send(res, 401, { error: 'Wrong details' });
        return send(res, 200, { ok: 1, name: d.name, kind: d.kind, joined: d.joined, ...info(d, key) });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) { console.error(e); send(res, 500, { error: 'Server error' }); }
  };
}
module.exports = { makeHandler, razorpayOrder };

if (require.main === module) {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
  new MongoClient(uri).connect().then(c => {
    const users = c.db(process.env.DB_NAME || 'editor').collection('users');
    http.createServer(makeHandler(users)).listen(process.env.PORT || 3000, () => console.log('Editor login API ready'));
  }).catch(e => { console.error('Mongo connect failed', e.message); process.exit(1); });
}
