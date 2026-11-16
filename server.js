// Editor API: login with OTP, Razorpay payments (Pro 30 days). Node 18+, MongoDB Atlas. No extra packages besides "mongodb".
const http = require('http'), crypto = require('crypto');

// Render env values often arrive with stray spaces or quotes; clean them all.
const cleanEnv = e => { const o = {}; for (const k of Object.keys(e)) { let v = e[k]; if (typeof v === 'string') { v = v.trim(); if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1).trim(); } o[k] = v; } return o; };
const VERSION = 'v28';
// Latest app version: APP_LATEST env, else read `const VER='vNN'` from index.html in your GitHub repo (cached 10 min).
const ghLatest = env => async () => {
  const repo = env.GITHUB_REPO || 'vdadi4-cpu/Editor1.0', hd = env.GITHUB_TOKEN ? { Authorization: 'token ' + env.GITHUB_TOKEN } : {};
  for (const br of env.GITHUB_BRANCH ? [env.GITHUB_BRANCH] : ['main', 'master']) {
    const r = await fetch(env.APP_VERSION_URL || 'https://raw.githubusercontent.com/' + repo + '/' + br + '/index.html', { headers: hd, signal: AbortSignal.timeout(6000) });
    if (!r.ok) continue; const m = /const VER='(v[\d.]+)'/.exec(await r.text()); if (m) return m[1];
  }
  return '';
};
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

// ---- music search on the server (open-licence catalogues only: Jamendo [needs JAMENDO_CLIENT_ID], Openverse, ccMixter) ----
const licOf = u => { const m = /licenses\/([a-z-]+)\/([\d.]+)/i.exec(u || ''); return m ? 'CC ' + m[1].toUpperCase() + ' ' + m[2] : /publicdomain|zero/i.test(u || '') ? 'Public domain' : 'Creative Commons'; };
// v28: a result must really match what was typed
const MSTOP = new Set(['song','songs','music','mp3','the','a','an','from','movie','film','full','video','new','audio','free','download','lyrics','by','of','and']);
const normS = s => String(s || '').toLowerCase().replace(/[\u0300-\u036f]/g, '');
const wordsOf = s => normS(s).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
const relScore = (r, q) => {
  const T = wordsOf(q).filter(x => !MSTOP.has(x)); if (!T.length) return 1;
  const req = T.filter(x => !/^\d+$/.test(x)), nums = T.filter(x => /^\d+$/.test(x)), H = normS((r.title || '') + ' ' + (r.artist || '')), W = wordsOf(H);
  const hit = x => W.some(w => w === x || w.startsWith(x)) || (x.length >= 4 && H.includes(x));
  const R0 = req.length ? req : T, m = R0.filter(hit).length, need = R0.length >= 4 ? R0.length - 1 : R0.length;
  if (m < need) return 0;
  let s = m * 2 + nums.filter(hit).length; if (normS(r.title).includes(normS(q).trim())) s += 3; return s;
};
const musicSearch = env => async (q, tag, com) => {
  const out = [], failed = [], e = encodeURIComponent, lq = e(q), tg = tag ? ' ' + tag : '';
  const J = async (name, u, map) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error('HTTP ' + r.status); out.push(...map(await r.json())); } catch (x) { failed.push(name); } };
  const jobs = [];
  if (env.JAMENDO_CLIENT_ID) {
    const base = 'https://api.jamendo.com/v3.0/tracks/?client_id=' + e(env.JAMENDO_CLIENT_ID) + '&format=json&limit=15&include=musicinfo&audioformat=mp32&order=popularity_total';
    const mp = j => (j.results || []).map(r => ({ title: r.name, artist: r.artist_name, url: r.audio, dur: r.duration, license: licOf(r.license_ccurl), src: 'Jamendo' }));
    jobs.push(J('Jamendo', base + '&search=' + lq + (tag ? '&tags=' + e(tag) : ''), mp), J('Jamendo', base + '&artist_name=' + lq + (tag ? '&tags=' + e(tag) : ''), mp));
  }
  const ov = j => (j.results || []).filter(r => r.url).map(r => ({ title: r.title || 'Untitled', artist: r.creator || 'Unknown', url: r.url, dur: r.duration ? r.duration / 1000 : 0, license: 'CC ' + String(r.license || '').toUpperCase() + ' ' + (r.license_version || ''), src: 'Openverse' }));
  const ovb = 'https://api.openverse.org/v1/audio/?page_size=15&mature=false' + (com ? '&license_type=commercial' : '');
  jobs.push(J('Openverse', ovb + '&q=' + e(q + tg), ov), J('Openverse', ovb + '&creator=' + lq, ov));
  jobs.push(J('ccMixter', 'https://ccmixter.org/api/query?f=json&limit=12&sort=rank&search=' + lq, j => (Array.isArray(j) ? j : []).map(r => { const f = (r.files || []).find(x => /mp3/i.test((x.file_format_info || {})['default-ext'] || x.download_url || '')) || (r.files || [])[0]; return f && f.download_url ? { title: r.upload_name, artist: r.user_real_name || r.user_name, url: f.download_url, dur: 0, license: licOf(r.license_url), src: 'ccMixter' } : null; }).filter(Boolean)));
  if (!com) jobs.push(J('Licensed', 'https://itunes.apple.com/search?media=music&entity=song&country=IN&limit=15&term=' + lq, j => (j.results || []).filter(r => r.previewUrl).map(r => ({ title: r.trackName || 'Untitled', artist: r.artistName || 'Unknown', url: r.previewUrl, dur: 30, license: 'Licensed · 30s preview only', src: 'Licensed', licensed: 1 }))));
  await Promise.all(jobs);
  const seen = new Set(), res = []; for (const r of out) { if (!r.url || seen.has(r.url)) continue; seen.add(r.url); if (com && /\b(NC|ND)\b/i.test(r.license)) continue; res.push(r); }
  const sc = res.map(r => ({ r, s: relScore(r, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || (a.r.licensed ? 1 : 0) - (b.r.licensed ? 1 : 0)).map(x => x.r);
  return { res: sc.filter(r => !r.licensed).slice(0, 30).concat(sc.filter(r => r.licensed).slice(0, 12)), failed: [...new Set(failed)] };
};

// ---- AI video (fal.ai text-to-video) and script planner (Anthropic). Keys live only in Render: FAL_KEY, ANTHROPIC_API_KEY ----
const FAL = 'https://queue.fal.run';
const falSubmit = env => async (model, input) => {
  const r = await fetch(FAL + '/' + model, { method: 'POST', headers: { Authorization: 'Key ' + env.FAL_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.request_id) throw new Error('video service ' + r.status + ' ' + String(j.detail ? JSON.stringify(j.detail) : j.message || '').slice(0, 160));
  const app = model.split('/').slice(0, 2).join('/');
  return { statusUrl: j.status_url || FAL + '/' + app + '/requests/' + j.request_id + '/status', responseUrl: j.response_url || FAL + '/' + app + '/requests/' + j.request_id };
};
const falStatus = env => async job => {
  const hd = { Authorization: 'Key ' + env.FAL_KEY };
  const r = await fetch(job.statusUrl, { headers: hd, signal: AbortSignal.timeout(20000) }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('video service ' + r.status);
  if (j.status !== 'COMPLETED') return { status: j.status === 'IN_QUEUE' ? 'queued' : 'running' };
  const rr = await fetch(job.responseUrl, { headers: hd, signal: AbortSignal.timeout(20000) }), out = await rr.json().catch(() => ({}));
  if (!rr.ok || !out.video || !out.video.url) return { status: 'failed', error: String(out.detail ? JSON.stringify(out.detail) : 'The video could not be made').slice(0, 200) };
  return { status: 'done', url: out.video.url };
};
const PLAN_SYS = `You turn a person's description into a shot list for an AI text-to-video model. The person may write in ANY language (English, Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Hinglish...). Their text mixes a description of what to show with instructions about the video itself (length, style, "generate a video of 30 sec"). Rules:
1. Instructions about the video (length, format, style, music, "make/generate a video") are NOT scenes and NOT captions. Use them to set the total length and style.
2. Total length: use the length the person asks for (in any language), otherwise the default given. Clamp to 5-60 seconds. Make exactly round(total / clip) scenes, at most the maximum given. Each scene is one continuous shot of "clip" seconds.
3. Follow the story order. Put each described event in the right shot. If the description is short, extend it naturally (establishing shot, slow camera move, continuation) without adding unrelated content.
4. "visual": English, 40-80 words, concrete: subject, action, setting, camera movement, lighting, mood, realism. Repeat the key recurring subjects in EVERY scene for continuity (for example "the same rocky asteroid with jagged, crumbling edges"). Include every specific requirement the person gave (colours, materials, behaviour). No text, subtitles, logos or watermarks inside the video.
5. "caption": only when the person wants on-screen text or wrote a quoted line; keep it in the person's own language and script. Otherwise "".
6. "style": one of cinematic, energetic, calm, vlog, travel, party, romantic, festival, sports, vintage, documentary, dreamy (best match, default cinematic).
Reply with ONLY JSON: {"language":"<ISO code>","seconds":<int>,"style":"<style>","scenes":[{"visual":"...","caption":"...","seconds":<clip>}]}`;
const anthropicPlan = env => async ({ script, seconds, clip, max }) => {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({ model: env.AI_PLANNER_MODEL || 'claude-haiku-5-5', max_tokens: 2500, system: PLAN_SYS, messages: [{ role: 'user', content: 'Default length: ' + seconds + ' seconds. Clip length: ' + clip + ' seconds. Maximum scenes: ' + max + '.\n\nDescription:\n' + script }] }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error('planner ' + r.status + ' ' + String((j.error && j.error.message) || '').slice(0, 140));
  const txt = (j.content || []).map(c => c.text || '').join(''), m = /\{[\s\S]*\}/.exec(txt); if (!m) throw new Error('planner gave no plan');
  const p = JSON.parse(m[0]); const sc = (Array.isArray(p.scenes) ? p.scenes : []).filter(x => x && x.visual).slice(0, max);
  if (!sc.length) throw new Error('planner gave no scenes');
  return { language: String(p.language || '').slice(0, 8), seconds: Math.max(5, Math.min(60, Math.round(+p.seconds || seconds))), style: String(p.style || 'cinematic').slice(0, 20), scenes: sc.map(x => ({ visual: String(x.visual).slice(0, 700), caption: String(x.caption || '').slice(0, 120), seconds: clip })) };
};

// ---- OTP delivery (email: Brevo or Resend; SMS: MSG91, Fast2SMS or Twilio). Set OTP_LOG=1 to print codes in the server log while testing.
const form = o => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
const must = async r => { if (!r.ok) throw new Error('provider ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 120)); };
function otpSender(env) {
  return async (kind, key, code) => {
    if (env.OTP_LOG) console.log('[OTP] ' + key + ' -> ' + code);
    const msg = 'Your Editor code is ' + code + '. It expires in 5 minutes. Do not share it.';
    if (kind === 'email') {
      if ((env.BREVO_API_KEY || env.RESEND_API_KEY) && !env.MAIL_FROM) { const e = new Error('MAIL_FROM is not set in Render. Set it to the sender address you verified in ' + (env.BREVO_API_KEY ? 'Brevo' : 'Resend') + '.'); e.code = 'NOPROVIDER'; throw e; }
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
  const env = cleanEnv(opt.env || process.env), now = opt.now || (() => Date.now());
  const price = +env.PRICE_PAISE || 4900;               // Rs 49 in paise
  const proEmails = String(env.PRO_EMAILS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const createOrder = opt.createOrder || razorpayOrder(env), createLink = opt.createLink || razorpayLink(env), getLink = opt.getLink || razorpayGetLink(env);
  const deliver = opt.sendOtp || otpSender(env);
  // test account: skips the OTP step (only with the matching password hash). Set OTP_TEST_USER=off to disable.
  const testUser = String(env.OTP_TEST_USER || 'vdadi4@gmail.com').toLowerCase(), testH = env.OTP_TEST_H || '07578b1591c4ef755fc9410219f502b8dfe8e16997662bcc7c84682965dfab1a';
  const bypass = (key, h) => testUser !== 'off' && key === testUser && h === testH;
  const info = (d, key) => { const until = Math.max(+d.premiumUntil || 0, proEmails.includes(key) ? now() + PASS_DAYS * DAY : 0); return { pro: until > now(), until }; };
  let latest = { at: 0, v: '' };
  const getLatest = async () => { if (env.APP_LATEST) return env.APP_LATEST; const t = Date.now(); if (latest.v && t - latest.at < 600e3) return latest.v; try { const v = await (opt.fetchLatest || ghLatest(env))(); if (v) latest = { at: t, v }; else latest.at = t - 540e3; } catch (e) { latest.at = t - 540e3; } return latest.v; };
  const aiModel = env.AI_VIDEO_MODEL || 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', aiClip = +env.AI_CLIP_SECONDS === 10 ? 10 : 5, aiMonthCap = +env.AI_MONTH_CLIPS || 6, aiTestCap = +env.AI_TESTER_CLIPS || 60;
  const aiSubmit = opt.aiSubmit || falSubmit(env), aiStatus = opt.aiStatus || falStatus(env), aiPlan = opt.aiPlan || anthropicPlan(env), aiFetch = opt.aiFetch || (u => fetch(u, { signal: AbortSignal.timeout(120000) }));
  const aiOn = { video: !!(env.FAL_KEY || opt.aiSubmit), planner: !!(env.ANTHROPIC_API_KEY || opt.aiPlan) };
  const jobs = new Map();
  const musicFn = opt.music || musicSearch(env), mcache = new Map();
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
      try { await deliver(kind, key, c); } catch (e) { console.error('otp send failed:', e.message); return [e.code === 'NOPROVIDER' ? 503 : 502, { error: e.code === 'NOPROVIDER' ? e.message : 'Couldn’t send the code. Check the address or number and try again.', detail: String(e.message || '').slice(0, 200) }]; }
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
      if (req.method === 'GET' && req.url.startsWith('/music')) {
        const ipm = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        if (limited(ipm)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
        const u = new URL(req.url, 'http://x'), q = String(u.searchParams.get('q') || '').trim().slice(0, 80), tag = String(u.searchParams.get('tag') || '').slice(0, 20), com = u.searchParams.get('com') == '1';
        if (!q && !tag) return send(res, 400, { error: 'Type a song or artist' });
        const ck = q + '|' + tag + '|' + com, hit = mcache.get(ck);
        if (hit && Date.now() - hit.at < 600e3) return send(res, 200, { ok: 1, ...hit.v });
        const v = await musicFn(q || tag, q ? tag : '', com); if (v.res.length) mcache.set(ck, { at: Date.now(), v }); if (mcache.size > 200) mcache.clear();
        return send(res, 200, { ok: 1, ...v });
      }
      if (req.method === 'GET') return send(res, 200, { ok: 1, service: 'editor-login', version: VERSION, ai: { ...aiOn, model: aiOn.video ? aiModel : '', clip: aiClip, monthClips: aiMonthCap }, latest: await getLatest(), appUrl: env.APP_URL || 'https://github.com/' + (env.GITHUB_REPO || 'vdadi4-cpu/Editor1.0') + '/actions', payKeys: { id: !!env.RAZORPAY_KEY_ID, secret: !!env.RAZORPAY_KEY_SECRET }, mailFrom: !!env.MAIL_FROM, mailer: env.BREVO_API_KEY ? 'brevo' : env.RESEND_API_KEY ? 'resend' : env.OTP_LOG ? 'log' : 'none', testUser: testUser !== 'off', pay: env.RAZORPAY_KEY_ID ? (/^rzp_test/.test(env.RAZORPAY_KEY_ID) ? 'test' : 'live') : 'off', otp: { email: !!(env.BREVO_API_KEY || env.RESEND_API_KEY || env.OTP_LOG), sms: !!(env.MSG91_AUTHKEY || env.FAST2SMS_KEY || env.TWILIO_SID || env.OTP_LOG) } });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'Too many tries. Wait a minute.' });
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > (req.url.startsWith('/ai/') ? 16384 : 4096)) return send(res, 413, { error: 'Too large' }); }
      let b; try { b = JSON.parse(raw || '{}'); } catch (_) { return send(res, 400, { error: 'Bad request' }); }
      const key = String(b.key || '').toLowerCase().slice(0, 120), h = String(b.h || '');
      if (key.length < 5 || !/^[0-9a-f]{64}$/.test(h)) return send(res, 400, { error: 'Bad details' });
      const kind = b.kind === 'phone' ? 'phone' : 'email';
      const check = async () => { const d = await users.findOne({ _id: key }); if (!d) return null; const a = Buffer.from(await scrypt(h, d.salt), 'hex'), c = Buffer.from(d.ph, 'hex'); return a.length === c.length && crypto.timingSafeEqual(a, c) ? d : false; };
      if (req.url.startsWith('/status') || req.url.startsWith('/pay/') || req.url.startsWith('/ai/')) {
        const d = await check();
        if (d === null) return send(res, 404, { error: 'No account' });
        if (d === false) return send(res, 401, { error: 'Wrong details' });
        if (req.url.startsWith('/status')) { await settleLinks(d, key); return send(res, 200, { ok: 1, ...info(d, key), price }); }
        if (req.url.startsWith('/ai/')) {                       // AI video: Pro members (and the tester) only
          const month = new Date(now()).toISOString().slice(0, 7), used = d.aiUsed && d.aiUsed.m === month ? d.aiUsed.n : 0, cap = bypass(key, h) ? aiTestCap : aiMonthCap;
          if (!info(d, key).pro && !bypass(key, h)) return send(res, 403, { error: 'AI video is part of Pro.' });
          if (req.url.startsWith('/ai/plan')) {
            if (!aiOn.planner) return send(res, 503, { error: 'planner_off' });
            const script = String(b.script || '').trim().slice(0, 6000); if (!script) return send(res, 400, { error: 'Write your script first.' });
            const sec = Math.max(5, Math.min(60, +b.seconds || 15)), max = Math.min(12, Math.ceil(60 / aiClip));
            try { const p = await aiPlan({ script, seconds: sec, clip: aiClip, max }); return send(res, 200, { ok: 1, clip: aiClip, left: Math.max(0, cap - used), ...p }); }
            catch (e) { console.error('plan failed:', e.message); return send(res, 502, { error: 'Could not plan the video: ' + String(e.message).slice(0, 160) }); }
          }
          if (req.url.startsWith('/ai/video/start')) {
            if (!aiOn.video) return send(res, 503, { error: 'video_off' });
            if (used >= cap) return send(res, 429, { error: 'You have used all ' + cap + ' AI video clips for this month.', left: 0 });
            const prompt = String(b.prompt || '').trim().slice(0, 1500); if (!prompt) return send(res, 400, { error: 'Describe the scene.' });
            const ratio = ['9:16', '16:9', '1:1'].includes(b.ratio) ? b.ratio : '9:16';
            let job; try { job = await aiSubmit(aiModel, { prompt, duration: String(aiClip), aspect_ratio: ratio, negative_prompt: 'blur, distort, low quality, text, subtitles, watermark, logo' }); }
            catch (e) { console.error('video start failed:', e.message); return send(res, 502, { error: 'Could not start the video: ' + String(e.message).slice(0, 180) }); }
            const id = crypto.randomBytes(12).toString('hex'); jobs.set(id, { ...job, owner: key, month, at: now() }); if (jobs.size > 400) jobs.delete(jobs.keys().next().value);
            await users.updateOne({ _id: key }, { $set: { aiUsed: { m: month, n: used + 1 } } });
            return send(res, 200, { ok: 1, id, left: Math.max(0, cap - used - 1), clip: aiClip });
          }
          if (req.url.startsWith('/ai/video/status') || req.url.startsWith('/ai/video/file')) {
            const job = jobs.get(String(b.id || '')); if (!job || job.owner !== key) return send(res, 404, { error: 'That video job was not found (the server may have restarted). Generate it again.' });
            if (req.url.startsWith('/ai/video/status')) {
              if (job.url) return send(res, 200, { ok: 1, status: 'done' });
              if (job.error) return send(res, 200, { ok: 1, status: 'failed', error: job.error });
              if (now() - job.at > 15 * 60e3) { job.error = 'Timed out.'; return send(res, 200, { ok: 1, status: 'failed', error: job.error }); }
              let st; try { st = await aiStatus(job); } catch (e) { return send(res, 200, { ok: 1, status: 'running' }); }
              if (st.status === 'done') job.url = st.url;
              if (st.status === 'failed') { job.error = st.error || 'The video could not be made'; if (!job.refunded) { job.refunded = 1; const dd = await users.findOne({ _id: key }); if (dd && dd.aiUsed && dd.aiUsed.m === job.month && dd.aiUsed.n > 0) await users.updateOne({ _id: key }, { $set: { aiUsed: { m: job.month, n: dd.aiUsed.n - 1 } } }); } }
              return send(res, 200, { ok: 1, status: st.status, error: job.error });
            }
            if (!job.url) return send(res, 409, { error: 'Not ready yet.' });
            let f; try { f = await aiFetch(job.url); if (!f.ok) throw new Error('HTTP ' + f.status); } catch (e) { return send(res, 502, { error: 'Could not download the finished video.' }); }
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
            const { Readable } = require('stream'); if (f.body && f.body.getReader) Readable.fromWeb(f.body).pipe(res); else res.end(Buffer.from(await f.arrayBuffer()));
            return;
          }
          return send(res, 404, { error: 'Not found' });
        }
        if (req.url.startsWith('/pay/test')) {   // simulated payment: only for the tester account and only while Razorpay is in test mode (or not set up)
          const testMode = !env.RAZORPAY_KEY_ID || /^rzp_test/.test(env.RAZORPAY_KEY_ID);
          if (!bypass(key, h) || !testMode || env.TEST_PAY === 'off') return send(res, 403, { error: 'Test payments are not allowed here.' });
          const until = await grant(key, d, { paid: 'sim_' + now() }); return send(res, 200, { ok: 1, pro: true, until, test: true });
        }
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
        let d = await check();
        if (d === null) return send(res, 404, { error: 'No account' });
        if (d === false && bypass(key, h)) { const salt = crypto.randomBytes(16).toString('hex'); await users.updateOne({ _id: key }, { $set: { salt, ph: await scrypt(h, salt) } }); d = await users.findOne({ _id: key }); }   // tester account: always lets the known test password in
        if (d === false) return send(res, 401, { error: 'Wrong details' });
        if (!bypass(key, h)) { const r = await otpStep('login', d.kind || kind, key, b.otp); if (r) return send(res, r[0], r[1]); }
        return send(res, 200, { ok: 1, name: d.name, kind: d.kind, joined: d.joined, ...info(d, key) });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) { console.error(e); send(res, 500, { error: 'Server error' }); }
  };
}
module.exports = { falSubmit, falStatus, anthropicPlan, musicSearch, makeHandler, razorpayOrder, otpSender, cleanEnv };

if (require.main === module) {
  const { MongoClient } = require('mongodb');
  const uri = cleanEnv(process.env).MONGODB_URI;
  if (!uri) { console.error('Set MONGODB_URI'); process.exit(1); }
  new MongoClient(uri).connect().then(c => {
    const users = c.db(process.env.DB_NAME || 'editor').collection('users');
    http.createServer(makeHandler(users)).listen(process.env.PORT || 3000, () => console.log('Editor login API ready'));
  }).catch(e => { console.error('Mongo connect failed', e.message); process.exit(1); });
}
