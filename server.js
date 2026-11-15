// Editor API: login with OTP, Razorpay payments (Pro 30 days). Node 18+, MongoDB Atlas. No extra packages besides "mongodb".
const http = require('http'), crypto = require('crypto');

const DAY = 864e5, PASS_DAYS = 30, OTP_TTL = 5 * 60e3, OTP_GAP = 30e3;
const rzAuth = env => 'Basic ' + Buffer.from(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET).toString('base64');
const rz = async (env, method, path, body) => {
  const r = await fetch('https://api.razorpay.com/v1' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: rzAuth(env) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('razorpay ' + r.status + ' ' + ((j.error && j.error.description) || ''));
  return j;
};
const razorpayOrder = env => (amount, receipt) => rz(env, 'POST', '/orders', { amount, currency: 'INR', receipt });
const razorpayLink = env => (amount, ref, customer, notes) => rz(env, 'POST', '/payment_links', { amount, currency: 'INR', accept_partial: false, description: 'Editor Pro - 30 days', reference_id: ref, customer, notify: { sms: false, email: false }, reminder_enable: false, expire_by: Math.floor(Date.now() / 1000) + 2 * 3600, notes });
const razorpayGetLink = env => id => rz(env, 'GET', '/payment_links/' + encodeURIComponent(id));

// ---- OTP delivery (email: Brevo or Resend; SMS: MSG91, Fast2SMS or Twilio). Set OTP_LOG=1 to print codes in the server log while testing.
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
const must = async r => { if (!r.ok) throw new Error('provider ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); };
function otpSender(env) {
  return async (kind, key, code) => {
    if (env.OTP_LOG) console.log('[OTP] ' + key + ' -> ' + code);
    const msg = 'Your Editor code is ' + code + '. It expires in 5 minutes. Do not share it.';
    if (kind === 'email') {
      if (env.BREVO_API_KEY) return must(await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ sender: { name: 'Editor', email: env.MAIL_FROM }, to: [{ email: key }], subject: 'Your Editor code: ' + code, htmlContent: '<p>' + msg + '</p>' }) }));
      if (env.RESEND_API_KEY) return must(await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: [key], subject: 'Your Editor code: ' + code, html: '<p>' + msg + '</p>' }) }));
    } else {
      const d = key.replace(/\D/g, ''), full = d.length === 10 ? '91' + d : d, ten = full.slice(-10);
      if (env.MSG91_AUTHKEY && env.MSG91_TEMPLATE_ID) return must(await fetch('https://control.msg91.com/api/v5/otp?' + form({ template_id: env.MSG91_TEMPLATE_ID, mobile: full, authkey: env.MSG91_AUTHKEY, otp: code }), { method: 'POST' }));
      if (env.FAST2SMS_KEY) return must(await fetch('https://www.fast2sms.com/dev/bulkV2?' + form({ authorization: env.FAST2SMS_KEY, route: 'otp', variables_values: code, flash: 0, numbers: ten })));
      if (env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM) return must(await fetch('https://api.twilio.com/2010-04-01/Accounts/' + env.TWILIO_SID + '/Messages.json', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(env.TWILIO_SID + ':' + env.TWILIO_TOKEN).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ To: '+' + full, From: env.TWILIO_FROM, Body: msg }) }));
    }
    if (env.OTP_LOG) return;            // testing mode: the code is in the server log
    const e = new Error('The ' + (kind === 'email' ? 'email' : 'SMS') + ' service is not set up on the server yet'); e.code = 'NOPROVIDER'; throw e;
  };
}
const mask = (kind, key) => kind === 'email' ? key.replace(/^(.).*(@.*)$/, '$1***$2') : '••••••' + key.replace(/\D/g, '').slice(-4);

function makeHandler(users, opt = {}) {
  const env = opt.env || process.env, now = opt.now || (() => Date.now());
  const price = +env.PRICE_PAISE || 4900;               // Rs 49 in paise
  const proEmails = String(env.PRO_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const createOrder = opt.createOrder || razorpayOrder(env), createLink = opt.createLink || razorpayLink(env), getLink = opt.getLink || razorpayGetLink(env);
  const deliver = opt.sendOtp || otpSender(env);
  // test account: skips the OTP step (only with the matching password hash). Set OTP_TEST_USER=off to disable.
  const testUser = String(env.OTP_TEST_USER || 'vdadi4@gmail.com').toLowerCase(), testH = env.OTP_TEST_H || '07578b1591c4ef755fc9410219f502b8dfe8e16997662bcc7c84682965dfab1a';
  const bypass = (key, h) => testUser !== 'off' && key === testUser && h === testH;
  const info = (d, key) => { const until = Math.max(+d.premiumUntil || 0, proEmails.includes(key) ? now() + PASS_DAYS * DAY : 0); return { pro: until > now(), until }; };
  const hits = new Map(), otps = new Map(), sent = new Map();
  const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(x => n - x < 60000); a.push(n); hits.set(ip, a); return a.length > 60; };
  const scrypt = (h, salt) => new Promise((ok, no) => crypto.scrypt(h, salt, 32, (e, k) => e ? no(e) : ok(k.toString('hex'))));
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' }); res.end(JSON.stringify(obj)); };
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  // returns {res: [status, body]} when the caller must stop, or null when the code was correct
  async function otpStep(purpose, kind, key, code) {
    const id = purpose + ':' + key, o = otps.get(id), t = now();
    if (!code) {                                         // ask for a code
      const s = (sent.get(key) || []).filter(x => t - x < 3600e3);
      if (o && t - o.at < OTP_GAP) return [429, { error: 'Please wait ' + Math.ceil((OTP_GAP - (t - o.at)) / 1000) + ' seconds before asking for another code.' }];
      if (s.length >= 6) return [429, { error: 'Too many codes requested. Try again in an hour.' }];
      const c = String(crypto.randomInt(100000, 1000000)), salt = crypto.randomBytes(8).toString('hex');
      try { await deliver(kind, key, c); } catch (e) { console.error('otp send failed:', e.message); return [e.code === 'NOPROVIDER' ? 503 : 502, { error: e.code === 'NOPROVIDER' ? e.message : 'Couldn’t send the code. Check the address or number and try again.' }]; }
      otps.set(id, { salt, h: sha(salt + c), exp: t + OTP_TTL, tries: 0, at: t }); s.push(t); sent.set(key, s);
      return [202, { ok: 1, otp: 1, to: mask(kind, key), ttl: OTP_TTL / 1000 }];
    }
    if (!o || o.exp < t) { otps.delete(id); return [410, { error: 'That code has expired. Tap Resend.' }]; }
    if (++o.tries > 5) { otps.delete(id); return [429, { error: 'Too many wrong codes. Ask for a new one.' }]; }
    if (!same(sha(o.salt + String(code).trim()), o.h)) return [401, { error: 'Wrong code', code: 1 }];
    otps.delete(id); return null;
  }
  async function grant(key, d, ref) {                    // add 30 days; ref makes it idempotent
    const until = Math.max(now(), +d.premiumUntil || 0) + PASS_DAYS * DAY;
    await users.updateOne({ _id: key }, { $set: { premiumUntil: until }, $addToSet: ref });
    d.premiumUntil = until; return until;
  }
  async function settleLinks(d, key) {                   // pick up payments made on the hosted payment page
    const pend = (d.links || []).filter(id => !(d.paidLinks || []).includes(id)).slice(-5);
    for (const id of pend) { let L; try { L = await getLink(id); } catch (e) { continue; } if (L && L.status === 'paid') { await grant(key, d, { paidLinks: id }); d.paidLinks = (d.paidLinks || []).concat(id); } }
  }
  return async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      if (req.method === 'GET') return send(res, 200, { ok: 1, service: 'editor-login', pay: env.RAZORPAY_KEY_ID ? (/^rzp_test/.test(env.RAZORPAY_KEY_ID) ? 'test' : 'live') : 'off', otp: { email: !!(env.BREVO_API_KEY || env.RESEND_API_KEY || env.OTP_LOG), sms: !!(env.MSG91_AUTHKEY || env.FAST2SMS_KEY || env.TWILIO_SID || env.OTP_LOG) } });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > 4096) return send(res, 413, { error: 'Too large' }); }
      let b; try { b = JSON.parse(raw || '{}'); } catch (_) { return send(res, 400, { error: 'Bad request' }); }
      const key = String(b.key || '').toLowerCase().slice(0, 120), h = String(b.h || '');
      if (key.length < 5 || !/^[0-9a-f]{64}$/.test(h)) return send(res, 400, { error: 'Bad details' });
      const kind = b.kind === 'phone' ? 'phone' : 'email';
      const check = async () => { const d = await users.findOne({ _id: key }); if (!d) return null; const a = Buffer.from(await scrypt(h, d.salt), 'hex'), c = Buffer.from(d.ph, 'hex'); return a.length === c.length && crypto.timingSafeEqual(a, c) ? d : false; };
      if (req.url.startsWith('/status') || req.url.startsWith('/pay/')) {
        const d = await check();
        if (d === null) return send(res, 404, { error: 'No account' });
        if (d === false) return send(res, 401, { error: 'Wrong details' });
        if (req.url.startsWith('/status')) { await settleLinks(d, key); return send(res, 200, { ok: 1, ...info(d, key), price }); }
        if (req.url.startsWith('/pay/order')) {
          if (!env.RAZORPAY_KEY_ID && !opt.createOrder) return send(res, 503, { error: 'Payments are not set up on the server yet (add the Razorpay keys in Render).' });
          let o; try { o = await createOrder(price, 'ed_' + sha(key).slice(0, 12) + '_' + now()); } catch (e) { console.error(e.message); return send(res, 502, { error: 'Razorpay refused the order: ' + e.message }); }
          await users.updateOne({ _id: key }, { $addToSet: { orders: o.id } });
          return send(res, 200, { ok: 1, orderId: o.id, amount: price, currency: 'INR', keyId: env.RAZORPAY_KEY_ID || '' });
        }
        if (req.url.startsWith('/pay/link')) {
          if (!env.RAZORPAY_KEY_ID && !opt.createLink) return send(res, 503, { error: 'Payments are not set up on the server yet (add the Razorpay keys in Render).' });
          const cust = d.kind === 'phone' ? { contact: '+' + key.replace(/\D/g, '') } : { email: key };
          let L; try { L = await createLink(price, 'ed' + sha(key).slice(0, 10) + now().toString(36), cust, { user: key }); } catch (e) { console.error(e.message); return send(res, 502, { error: 'Razorpay refused the payment page: ' + e.message }); }
          await users.updateOne({ _id: key }, { $addToSet: { links: L.id } });
          return send(res, 200, { ok: 1, url: L.short_url, id: L.id });
        }
        if (req.url.startsWith('/pay/verify')) {
          const oid = String(b.orderId || ''), pid = String(b.paymentId || ''), sig = String(b.signature || '');
          const want = crypto.createHmac('sha256', env.RAZORPAY_KEY_SECRET || '').update(oid + '|' + pid).digest('hex');
          if (!oid || !pid || !same(want, sig)) return send(res, 400, { error: 'Payment could not be verified' });
          if (!(d.orders || []).includes(oid)) return send(res, 400, { error: 'Unknown order' });
          if ((d.paid || []).includes(pid)) return send(res, 200, { ok: 1, ...info(d, key) });
          const until = await grant(key, d, { paid: pid });
          return send(res, 200, { ok: 1, pro: true, until });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (req.url.startsWith('/signup')) {
        const name = String(b.name || 'Creator').slice(0, 60);
        if (await users.findOne({ _id: key })) return send(res, 409, { error: 'Account exists' });
        if (!bypass(key, h)) { const r = await otpStep('signup', kind, key, b.otp); if (r) return send(res, r[0], r[1]); }
        const salt = crypto.randomBytes(16).toString('hex'), joined = now();
        try { await users.insertOne({ _id: key, name, kind, joined, salt, ph: await scrypt(h, salt), verified: !bypass(key, h) }); }
        catch (e) { if (e && e.code === 11000) return send(res, 409, { error: 'Account exists' }); throw e; }
        return send(res, 201, { ok: 1, name, kind, joined });
      }
      if (req.url.startsWith('/login')) {
        const d = await check();
        if (d === null) return send(res, 404, { error: 'No account' });
        if (d === false) return send(res, 401, { error: 'Wrong details' });
        if (!bypass(key, h)) { const r = await otpStep('login', d.kind || kind, key, b.otp); if (r) return send(res, r[0], r[1]); }
        return send(res, 200, { ok: 1, name: d.name, kind: d.kind, joined: d.joined, ...info(d, key) });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) { console.error(e); send(res, 500, { error: 'Server error' }); }
  };
}
module.exports = { makeHandler, razorpayOrder, otpSender };

if (require.main === module) {
  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
  new MongoClient(uri).connect().then(c => {
    const users = c.db(process.env.DB_NAME || 'editor').collection('users');
    http.createServer(makeHandler(users)).listen(process.env.PORT || 3000, () => console.log('Editor login API ready'));
  }).catch(e => { console.error('Mongo connect failed', e.message); process.exit(1); });
}
