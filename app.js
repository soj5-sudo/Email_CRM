/* ============================================================
   Palak Diam · RJO Booth 315 — Campaign Engine
   Vanilla JS. Sends through the EmailJS REST API.
   ============================================================ */

'use strict';

/* ---------- defaults (your EmailJS account) ---------- */
const DEFAULTS = {
  serviceId: '',                       // <-- paste your service_xxx in the UI
  templateId: 'template_k8y7cnf',
  publicKey: 'K6RBeDdBy6uGRlIM4',
  privateKey: 'YpoX13Cbxg2IWXCiAtPr',
  subject: 'Meeting at RJO Booth 315?',
  preview: 'A quick note before the Lexington show — hope to see you there.',
  logoUrl: 'https://d36hbw14aib5lz.cloudfront.net/310519663581052431/5Ki78xKZckhVPucWsF9STm/logo-stacked-cropped_2ba9bdc9.webp?Expires=1782853133&Signature=BVW35Pb6SUfBa6NywXdnjCETA8Kl7lABYRMr0MAT9dbspJ9kGSoWgteYp~ffIauWPF3HL3SxshxJP00A-cQa4aegqh1aiLela4jsoXyoP0aHcc-tk8bs0Rdp4atcC7dSAg6dwBN03jPRjbdbgwlgY6-NyV4Ko60Xp0McDl031GsILtBpm-yRN0mxserppS1uLX-zaOb2q2Yogl22jA04ZU1va2QgKaB1SxCTQWaeNl02gBfodo-gD-Zx3SiWWVqwH1yA~jmUfmVk683UvIIiA7Bil2o-v-AH0enaM7Ca7kkt7XCpYXQ1wDZ3uAa8vZaeGKOGdHLkpUJ7lXAqctfn5Q__&Key-Pair-Id=K1MP89RTKNH4J',
  bookingLink: '',
  replyTo: 'Sales@PalakDiam.com',
  fromName: 'Ankur Savani · Palak Diam',
  postalAddress: '',
};

const LS_KEY = 'palakdiam_rjo_campaign_v5';
const QUOTA_KEY = 'palakdiam_quota';
const DAILY_CAP = 400;            // max emails per calendar day
const API_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const MAX_TIMEOUT = 2147483647; // setTimeout 32-bit cap (~24.8 days)

const $ = (id) => document.getElementById(id);

const els = {
  serviceId: $('serviceId'), templateId: $('templateId'),
  publicKey: $('publicKey'), privateKey: $('privateKey'),
  subject: $('subject'), preview: $('preview'), logoUrl: $('logoUrl'),
  bookingLink: $('bookingLink'), replyTo: $('replyTo'), fromName: $('fromName'),
  postalAddress: $('postalAddress'),
  quotaCount: $('quotaCount'), quotaTimer: $('quotaTimer'),
  connStatus: $('connStatus'), tplEcho: $('tplEcho'),
  toolbarLed: $('toolbarLed'), toolbarConn: $('toolbarConn'),
  canvas: $('canvas'), cables: $('cables'),
  dropzone: $('dropzone'), fileInput: $('fileInput'), browseBtn: $('browseBtn'),
  pasteToggle: $('pasteToggle'), pasteArea: $('pasteArea'), pasteActions: $('pasteActions'),
  parsePasteBtn: $('parsePasteBtn'), sampleBtn: $('sampleBtn'),
  tableWrap: $('tableWrap'), recipientsBody: $('recipientsBody'), counts: $('counts'),
  previewPicker: $('previewPicker'), previewFrame: $('previewFrame'),
  delay: $('delay'), scheduleAt: $('scheduleAt'), scheduleNote: $('scheduleNote'),
  testEmail: $('testEmail'), sendTestBtn: $('sendTestBtn'),
  sendBtn: $('sendBtn'), stopBtn: $('stopBtn'),
  progressFill: $('progressFill'), progressMeta: $('progressMeta'),
  log: $('log'), toast: $('toast'),
};

const CONFIG_FIELDS = [
  'serviceId', 'templateId', 'publicKey', 'privateKey',
  'subject', 'preview', 'logoUrl', 'bookingLink', 'replyTo', 'fromName', 'postalAddress',
];
// fields that change the rendered email body (trigger a re-render)
const PREVIEW_FIELDS = ['preview', 'logoUrl', 'bookingLink', 'postalAddress'];

let recipients = [];   // { company, owner, email, status, error }
let sending = false;
let stopRequested = false;
let scheduleTimer = null;

/* ============================================================
   Persistence
   ============================================================ */
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) {}
  CONFIG_FIELDS.forEach((k) => {
    els[k].value = (saved[k] !== undefined) ? saved[k] : DEFAULTS[k];
  });
  els.tplEcho.textContent = els.templateId.value || DEFAULTS.templateId;
}
function saveConfig() {
  const data = {};
  CONFIG_FIELDS.forEach((k) => { data[k] = els[k].value.trim(); });
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (_) {}
  refreshConnStatus();
  els.tplEcho.textContent = els.templateId.value || DEFAULTS.templateId;
}
function getConfig() {
  const c = {};
  CONFIG_FIELDS.forEach((k) => { c[k] = els[k].value.trim(); });
  return c;
}
function refreshConnStatus() {
  const c = getConfig();
  const ready = c.serviceId && c.templateId && c.publicKey;
  els.connStatus.textContent = ready ? 'ready' : (c.serviceId ? 'incomplete' : 'add service id');
  els.connStatus.className = 'status-pill ' + (ready ? 'ok' : 'bad');
  els.toolbarLed.className = 'led ' + (ready ? 'ok' : 'bad');
  els.toolbarConn.textContent = ready ? 'emailjs: ready' : 'emailjs: not set';
}

/* ============================================================
   CSV parsing
   ============================================================ */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function detectColumns(header) {
  const norm = header.map((h) => h.toLowerCase().trim());
  const taken = new Set();
  const find = (cands) => {
    for (let n = 0; n < norm.length; n++) {            // pass 1: exact
      if (!taken.has(n) && cands.some((c) => norm[n] === c)) { taken.add(n); return n; }
    }
    for (let n = 0; n < norm.length; n++) {            // pass 2: substring
      if (!taken.has(n) && cands.some((c) => norm[n].includes(c))) { taken.add(n); return n; }
    }
    return -1;
  };
  // resolve in order: email, owner, company (so owner_name isn't stolen by "name")
  const email = find(['email', 'e-mail', 'mail', 'email_address', 'email address']);
  const owner = find(['owner_name', 'owner name', 'owner', 'contact_name', 'contact', 'first_name', 'firstname', 'manager', 'buyer']);
  const company = find(['company_name', 'company name', 'company', 'store', 'organization', 'brand', 'business', 'name']);
  return { company, owner, email };
}

function ingestRows(grid) {
  if (!grid.length) { toast('No rows found in that file.', 'bad'); return; }

  const noHeader = grid[0].some((c) => validEmail(c)); // row 0 holds a real email => no header
  let map, dataRows;
  if (noHeader) {
    dataRows = grid;
    const emailIdx = grid[0].findIndex((c) => validEmail(c));
    const rest = [0, 1, 2, 3].filter((n) => n !== emailIdx);
    map = { email: emailIdx, company: rest[0] ?? -1, owner: rest[1] ?? -1 };
  } else {
    map = detectColumns(grid[0]);
    dataRows = grid.slice(1);
    if (map.email < 0) {
      const probe = dataRows[0] || [];
      map.email = probe.findIndex((c) => validEmail(c));
    }
  }

  const next = [];
  dataRows.forEach((r) => {
    const email = (map.email >= 0 ? (r[map.email] || '') : '').trim();
    const company = (map.company >= 0 ? (r[map.company] || '') : '').trim();
    const owner = (map.owner >= 0 ? (r[map.owner] || '') : '').trim();
    if (!email && !company && !owner) return;
    next.push({ company, owner, email, status: validEmail(email) ? 'pending' : 'invalid', error: '' });
  });

  recipients = next;
  renderTable();
  if (recipients.length) {
    els.tableWrap.classList.remove('hidden');
    const bad = recipients.filter((r) => !validEmail(r.email)).length;
    toast(`Loaded ${recipients.length} row${recipients.length > 1 ? 's' : ''}${bad ? ` · ${bad} missing/!email` : ''}.`, bad ? 'bad' : 'good');
  }
  scheduleCables();
}

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || '').trim()); }

/* ============================================================
   Recipients table
   ============================================================ */
function renderTable() {
  els.recipientsBody.innerHTML = '';
  recipients.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="row-num">${idx + 1}</td>
      <td><input class="cell-input" data-i="${idx}" data-k="company" value="${escAttr(r.company)}" placeholder="Company"></td>
      <td><input class="cell-input" data-i="${idx}" data-k="owner" value="${escAttr(r.owner)}" placeholder="Owner"></td>
      <td><input class="cell-input" data-i="${idx}" data-k="email" value="${escAttr(r.email)}" placeholder="email@..."></td>
      <td>${statusBadge(r)}</td>
      <td><button class="row-x" data-x="${idx}" title="Remove">×</button></td>`;
    els.recipientsBody.appendChild(tr);
  });
  updateCounts();
  refreshPreviewPicker();
  scheduleCables();
}

function statusBadge(r) {
  const map = {
    pending: ['', 'queued'], sending: ['sending', 'sending…'],
    sent: ['sent', '✓ sent'], failed: ['failed', '✗ failed'], invalid: ['invalid', 'no email'],
  };
  const [cls, label] = map[r.status] || ['', r.status];
  const title = r.error ? ` title="${escAttr(r.error)}"` : '';
  return `<span class="badge ${cls}"${title}>${label}</span>`;
}

function updateCounts() {
  const total = recipients.length;
  const valid = recipients.filter((r) => validEmail(r.email)).length;
  const sent = recipients.filter((r) => r.status === 'sent').length;
  els.counts.innerHTML = total ? `<b>${valid}</b> valid · ${sent} sent · ${total} rows` : '';
}

els.recipientsBody.addEventListener('input', (e) => {
  const inp = e.target.closest('.cell-input');
  if (!inp) return;
  const i = +inp.dataset.i, k = inp.dataset.k;
  recipients[i][k] = inp.value;
  if (k === 'email') {
    recipients[i].status = validEmail(inp.value) ? 'pending' : 'invalid';
    recipients[i].error = '';
    inp.closest('tr').children[4].innerHTML = statusBadge(recipients[i]);
    updateCounts();
  }
  if (+els.previewPicker.value === i) renderPreview();
});
els.recipientsBody.addEventListener('click', (e) => {
  const x = e.target.closest('.row-x');
  if (!x) return;
  recipients.splice(+x.dataset.x, 1);
  renderTable();
});

/* ============================================================
   The designed email (what recipients receive)
   ============================================================ */
function greetingName(r) {
  return (r.owner || '').trim() || (r.company || '').trim() || (getConfig().greetFallback || 'RJO Member');
}
function fillTokens(str, r) {
  return (str || '')
    .replace(/\{\{\s*owner\s*\}\}/gi, (r.owner || '').trim() || greetingName(r))
    .replace(/\{\{\s*company\s*\}\}/gi, (r.company || '').trim() || 'your store')
    .replace(/\{\{\s*email\s*\}\}/gi, r.email || '');
}

function buildEmailHtml(r) {
  const c = getConfig();
  const name = escHtml(greetingName(r));
  const preview = escHtml(fillTokens(c.preview, r));
  const booking = (c.bookingLink || '').trim();
  const addr = (c.postalAddress || '').trim();
  const logo = (c.logoUrl || '').trim();

  const letterhead = logo
    ? `<img src="${escAttr(logo)}" alt="Palak Diam" width="220" style="width:220px;max-width:64%;height:auto;display:block;margin:0 auto;">`
    : `<div style="font-family:Georgia,'Times New Roman',serif;font-size:27px;letter-spacing:.2em;color:#1f2937;font-weight:bold;">PALAK&nbsp;DIAM</div>
       <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:8px auto 0;"><tr><td width="188" height="2" style="width:188px;height:2px;border-bottom:2px solid #1f2937;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>
       <div style="font-family:Georgia,serif;font-style:italic;font-size:13px;color:#6b7280;margin-top:7px;">The Passion for Perfection</div>`;

  const bring = [
    'Diamond pairs for studs',
    'GIA-certified stones',
    'Non-certified stones',
    'Value-priced loose natural diamonds',
    'Special RJO member pricing and terms available at the show',
  ].map((t) => `<tr><td valign="top" style="width:16px;color:#9ca3af;font-size:15px;line-height:25px;padding:1px 8px 1px 0;">&bull;</td><td style="font-size:15px;line-height:25px;color:#333a44;padding:1px 0;">${t}</td></tr>`).join('');

  const bookingPara = booking
    ? 'If you are attending RJO, we would appreciate the opportunity to meet with you at Booth&nbsp;315. You can stop by during the show, or book a time in advance here:'
    : 'If you are attending RJO, we would appreciate the opportunity to meet with you at Booth&nbsp;315. You can stop by during the show, or simply reply to this email and we will set a time.';

  const bookingButton = booking ? `
    <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:18px auto 22px;">
      <tr><td align="center" bgcolor="#1f4e79" style="border-radius:6px;background-color:#1f4e79;">
        <a href="${escAttr(booking)}" target="_blank" style="display:inline-block;padding:14px 36px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;letter-spacing:.02em;">Book an Appointment</a>
      </td></tr>
    </table>` : '';

  // FLYER 1 · SELLING — recreated natively (renders in every client, no hosting)
  const sellingFlyer = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#0a0a0a;border-radius:14px;">
      <tr><td style="padding:24px 26px 22px;">
        <div style="font-family:Georgia,serif;font-size:17px;letter-spacing:.04em;color:#ffffff;font-weight:bold;text-align:center;">PALAK&nbsp;DIAM INC.</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:10px;color:#c9a24b;text-align:center;margin-top:2px;letter-spacing:.04em;">the passion for perfection</div>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:12px auto;"><tr><td width="120" height="1" style="width:120px;border-bottom:1px solid #3a2f12;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:1.05;font-weight:800;color:#ffffff;">NOW SELLING</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:29px;line-height:1.08;font-weight:800;color:#d8b154;">LOOSE NATURAL DIAMONDS</div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;letter-spacing:.2em;margin-top:8px;">TO RJO MEMBERS</div>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;"><tr><td width="54" height="2" style="width:54px;border-bottom:2px solid #d8b154;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:1.2;font-weight:800;color:#ffffff;">VALUE PRICING. <span style="color:#e0352b;">REAL SAVINGS</span> PASSED TO YOU.</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:16px;">
          ${[
            'DIAMOND PAIRS FOR STUDS',
            'GIA-CERTIFIED STONES AVAILABLE',
            'NON-CERTIFIED STONES AVAILABLE',
            'SELECT GIA-CERTIFIED STONES UP TO <span style="color:#e0352b;font-weight:800;">70 BACK OF RAP</span>',
          ].map((t) => `<tr><td valign="top" style="width:16px;color:#d8b154;font-size:12px;line-height:20px;padding:4px 9px 4px 0;">◆</td><td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;letter-spacing:.03em;color:#eaeaea;line-height:20px;padding:4px 0;">${t}</td></tr>`).join('')}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border:1px solid #d8b154;border-radius:10px;">
          <tr><td style="padding:14px 18px;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.12em;color:#ffffff;font-weight:700;">VISIT PALAK DIAM AT</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:30px;font-weight:800;color:#d8b154;line-height:1.15;">BOOTH 315</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;letter-spacing:.05em;">RJO BUYING SHOW</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#c9a24b;margin-top:4px;">Lexington, KY &nbsp;·&nbsp; July 31 – August 3</div>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 8px;"><tr><td height="1" style="border-bottom:1px solid #3a2f12;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr></table>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#d8b154;text-align:center;letter-spacing:.02em;">213.228.0077&nbsp;&nbsp;·&nbsp;&nbsp;Sales@PalakDiam.com&nbsp;&nbsp;·&nbsp;&nbsp;www.PalakDiam.com</div>
      </td></tr>
    </table>`;

  // FLYER 2 · BUYING — recreated natively
  const buyingFlyer = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;background:#0a0a0a;border-radius:14px;">
      <tr><td style="padding:20px 0 0;text-align:center;">
        <div style="font-family:Georgia,serif;font-size:18px;letter-spacing:.1em;color:#ffffff;font-weight:bold;">PALAK&nbsp;DIAM</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-size:10px;color:#bdbdbd;margin-top:2px;">the passion for perfection</div>
      </td></tr>
      <tr><td style="padding:14px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#29abe2;">
          <tr><td style="padding:14px 20px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:30px;font-weight:800;color:#ffffff;">WE BUY DIAMONDS!</div>
            <div style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:#ffffff;margin-top:2px;">Same-Day Payment</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:14px 16px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          ${['ANY SIZE', 'ANY SHAPE', 'ANY QUALITY', 'ANY QUANTITY'].map((t) => `<td style="padding:0 3px;"><div style="background:#ffd400;color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:800;text-align:center;padding:6px 0;border-radius:3px;letter-spacing:.02em;">${t}</div></td>`).join('')}
        </tr></table>
      </td></tr>
      <tr><td style="padding:18px 20px 0;text-align:center;">
        <div style="font-family:Georgia,serif;font-style:italic;font-size:16px;color:#ffffff;">Breakout diamonds from VVS to I3</div>
        <div style="font-family:Georgia,serif;font-style:italic;font-weight:800;font-size:18px;color:#ffd400;margin-top:3px;">WE BUY IT ALL!</div>
      </td></tr>
      <tr><td style="padding:16px 20px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="50%" valign="top" style="padding:0 14px 0 0;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#29abe2;text-align:center;letter-spacing:.02em;">SECURED PAYMENT METHODS</div>
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ffffff;text-align:center;line-height:1.9;margin-top:8px;">E-Check&nbsp;·&nbsp;Zelle&nbsp;·&nbsp;ACH<br>Wire&nbsp;·&nbsp;Business Check</div>
          </td>
          <td width="50%" valign="top" style="padding:0 0 0 14px;border-left:1px solid #242424;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:800;color:#29abe2;text-align:center;">24 HOUR TURNAROUND</div>
            <div style="font-family:Georgia,serif;font-style:italic;font-weight:800;font-size:12px;color:#ffd400;text-align:center;margin-top:6px;">FREE INSURED SHIPPING</div>
            <div style="font-family:Georgia,serif;font-size:13px;color:#ffffff;text-align:center;line-height:1.4;margin-top:5px;">Every deal backed by a clear, written offer.</div>
          </td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:18px 20px 22px;">
        <div style="background:#ffffff;border-radius:12px;padding:14px 18px;text-align:center;">
          <div style="font-family:Georgia,serif;font-style:italic;font-size:17px;font-weight:800;color:#1a6fa0;">I WANT TO EARN YOUR BUSINESS!</div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#222222;margin-top:6px;">Direct/Text: 213-268-8485&nbsp;&nbsp;·&nbsp;&nbsp;Sales@palakdiam.com&nbsp;&nbsp;·&nbsp;&nbsp;www.palakdiam.com</div>
        </div>
      </td></tr>
    </table>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>Palak Diam · RJO Booth 315</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f6;font-size:1px;line-height:1px;">${preview}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:30px 12px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:6px;">

  <tr><td style="padding:36px 48px 16px;text-align:center;">
    ${letterhead}
  </td></tr>
  <tr><td style="padding:0 48px;"><div style="border-top:1px solid #edeff2;font-size:0;line-height:0;">&nbsp;</div></td></tr>

  <tr><td style="padding:26px 48px 6px;font-family:Helvetica,Arial,sans-serif;">
    <p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:#333a44;">Hi ${name},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#333a44;">Palak Diam will be exhibiting at the upcoming RJO Buying Show in Lexington, Kentucky, from July 31st to August 3rd at Booth&nbsp;315.</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#333a44;">Many RJO members already know Palak Diam as a trusted diamond buyer. This year, we are pleased to share that we will also be selling loose natural diamonds to RJO members at the show.</p>
    <p style="margin:0 0 6px;font-size:15px;line-height:1.75;color:#333a44;">We will be bringing:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;">${bring}</table>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.75;color:#333a44;">At the same time, Palak Diam remains an active buyer of diamonds, including closeouts, breakout goods, unwanted inventory, small stones, chipped and broken diamonds, single stones, and finished jewelry with diamonds.</p>
    <p style="margin:0 0 4px;font-size:15px;line-height:1.75;color:#333a44;">${bookingPara}</p>
    ${bookingButton}
    ${sellingFlyer}
    ${buyingFlyer}
    <p style="margin:20px 0 22px;font-size:15px;line-height:1.75;color:#333a44;">Whether you are looking to buy, sell, or discuss both, we would be happy to see you in Lexington.</p>
  </td></tr>

  <tr><td style="padding:0 48px 30px;font-family:Helvetica,Arial,sans-serif;">
    <p style="margin:0 0 12px;font-size:15px;color:#333a44;">Sincerely,</p>
    <p style="margin:0;font-family:Georgia,serif;font-size:18px;color:#1f2937;">Ankur Savani</p>
    <p style="margin:4px 0 0;font-size:13px;color:#6b7280;line-height:1.9;">
      Palak Diam Inc.<br>
      Booth 315&nbsp;&nbsp;|&nbsp;&nbsp;RJO Buying Show<br>
      Lexington, KY&nbsp;&nbsp;|&nbsp;&nbsp;July 31st – August 3rd<br>
      <a href="tel:+12132280077" style="color:#1f4e79;text-decoration:none;">213.228.0077</a><br>
      <a href="mailto:Sales@PalakDiam.com" style="color:#1f4e79;text-decoration:none;">Sales@PalakDiam.com</a><br>
      <a href="https://www.PalakDiam.com" style="color:#1f4e79;text-decoration:none;">www.PalakDiam.com</a>
    </p>
  </td></tr>

  <tr><td style="padding:14px 48px 24px;border-top:1px solid #edeff2;">
    <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;line-height:1.6;">
      ${addr ? escHtml(addr) + '<br>' : ''}You are receiving this note as an RJO member. If you would prefer not to hear from us, <a href="mailto:Sales@PalakDiam.com?subject=Unsubscribe&amp;body=Please%20remove%20this%20address%20from%20your%20list." style="color:#9ca3af;text-decoration:underline;">click here to unsubscribe</a> or reply with &ldquo;unsubscribe&rdquo;.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

/* ============================================================
   Preview
   ============================================================ */
function refreshPreviewPicker() {
  const cur = els.previewPicker.value;
  els.previewPicker.innerHTML = '';
  if (!recipients.length) {
    const opt = document.createElement('option');
    opt.value = '__sample'; opt.textContent = 'Sample (no list loaded)';
    els.previewPicker.appendChild(opt);
  } else {
    recipients.forEach((r, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${r.owner || r.company || '(no name)'} — ${r.email || '(no email)'}`;
      els.previewPicker.appendChild(opt);
    });
  }
  if (cur && [...els.previewPicker.options].some((o) => o.value === cur)) els.previewPicker.value = cur;
  renderPreview();
}
function currentPreviewRecipient() {
  const v = els.previewPicker.value;
  if (v === '__sample' || v === '' || !recipients.length) {
    return { company: 'Koovai Jewelers', owner: 'John Patel', email: 'member@example.com' };
  }
  return recipients[+v] || recipients[0];
}
function renderPreview() {
  els.previewFrame.srcdoc = buildEmailHtml(currentPreviewRecipient());
}

/* ============================================================
   Sending (EmailJS REST API)
   ============================================================ */
async function sendOne(r) {
  const c = getConfig();
  const params = {
    // recipient address sent under every common alias so the template's
    // "To Email" binding resolves no matter how it's wired (fixes 422).
    email: r.email, to_email: r.email, user_email: r.email, recipient: r.email, reply_to: c.replyTo,
    to_name: greetingName(r), owner_name: r.owner || '', company: r.company || '', company_name: r.company || '',
    subject: fillTokens(c.subject, r),
    preview: fillTokens(c.preview, r),
    message: buildEmailHtml(r),       // template Content must be {{{message}}}
    from_name: c.fromName,
  };
  const payload = {
    service_id: c.serviceId,
    template_id: c.templateId,
    user_id: c.publicKey,
    template_params: params,
  };
  if (c.privateKey) payload.accessToken = c.privateKey;

  const res = await fetch(API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')) || res.statusText;
    if (res.status === 422 && /recipient|address/i.test(text)) {
      throw new Error('EmailJS has no "To Email" (422). In your template → Settings → To Email, set {{email}} (or {{to_email}}) and Save.');
    }
    if (res.status === 403) {
      const hint = location.protocol === 'file:'
        ? 'EmailJS rejected the request (403). This page is open from disk — serve it over http:// (run "node server.js", then open http://localhost:8766).'
        : 'EmailJS rejected the origin (403). In EmailJS → Account → Security, allow this origin (or enable the API for non-browser apps).';
      throw new Error(`${hint}${text ? ' (' + text + ')' : ''}`);
    }
    if (res.status === 429) throw new Error('Rate limited by EmailJS (max ~1 email/sec) — increase the delay and retry.');
    throw new Error(`HTTP ${res.status} — ${text}`);
  }
  return true;
}

function preflight() {
  const c = getConfig();
  if (!c.serviceId) { toast('Add your EmailJS Service ID first (node 1).', 'bad'); els.serviceId.focus(); return false; }
  if (!c.templateId || !c.publicKey) { toast('Template ID and Public Key are required.', 'bad'); return false; }
  return true;
}

/* ---- daily 400/email quota (per calendar day, stored locally) ---- */
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function getQuota() {
  let q = {};
  try { q = JSON.parse(localStorage.getItem(QUOTA_KEY)) || {}; } catch (_) {}
  if (q.date !== todayKey()) q = { date: todayKey(), count: 0 };
  return q;
}
function sentToday() { return getQuota().count; }
function remainingToday() { return Math.max(0, DAILY_CAP - sentToday()); }
function addSent(n) {
  const q = getQuota(); q.count += n;
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify(q)); } catch (_) {}
  updateQuotaUI();
}
function updateQuotaUI() {
  const used = sentToday();
  els.quotaCount.textContent = `${used} / ${DAILY_CAP} sent today`;
  els.quotaCount.className = used >= DAILY_CAP ? 'quota-count full' : 'quota-count';
  if (used < DAILY_CAP) { stopResetCountdown(); els.quotaTimer.textContent = ''; }
}
let resetTimer = null;
function startResetCountdown() {
  stopResetCountdown();
  const pad = (x) => String(x).padStart(2, '0');
  const tick = () => {
    const now = new Date();
    const reset = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const s = Math.max(0, Math.floor((reset - now) / 1000));
    els.quotaTimer.textContent = `· resets in ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    if (s <= 0) { stopResetCountdown(); updateQuotaUI(); }
  };
  tick();
  resetTimer = setInterval(tick, 1000);
}
function stopResetCountdown() { if (resetTimer) { clearInterval(resetTimer); resetTimer = null; } }

async function sendCampaign(skipConfirm) {
  if (sending) return;
  if (!preflight()) return;
  clearTimeout(scheduleTimer); scheduleTimer = null;

  const targets = recipients.filter((r) => validEmail(r.email) && r.status !== 'sent');
  if (!targets.length) { toast('No valid, unsent recipients.', 'bad'); return; }

  if (!getConfig().postalAddress) {
    toast('Add a postal mailing address (node 2 → Optional) — legally required for bulk email.', 'bad');
    const det = els.postalAddress.closest('details'); if (det) det.open = true;
    els.postalAddress.focus();
    return;
  }

  const remaining = remainingToday();
  if (remaining <= 0) {
    toast(`Daily cap of ${DAILY_CAP} reached — resumes after midnight.`, 'bad');
    startResetCountdown();
    return;
  }
  const batch = targets.slice(0, remaining);
  const deferred = targets.length - batch.length;
  if (!skipConfirm && !confirm(`Send to ${batch.length} recipient${batch.length > 1 ? 's' : ''} now?${deferred ? `\n(${deferred} more exceed today's ${DAILY_CAP} cap — run again after midnight to send them.)` : ''}`)) return;

  sending = true; stopRequested = false;
  els.sendBtn.disabled = true;
  els.stopBtn.classList.remove('hidden');
  els.log.classList.add('show');
  els.log.innerHTML = '';
  const delayMs = Math.max(1100, (parseFloat(els.delay.value) || 0) * 1000); // never faster than ~1/sec

  let done = 0, ok = 0, fail = 0;
  for (const r of batch) {
    if (stopRequested) { logLine('info', 'Stopped by user.'); break; }
    if (remainingToday() <= 0) {
      logLine('info', `Daily cap of ${DAILY_CAP} reached — stopping; run again after midnight to send the rest.`);
      startResetCountdown();
      break;
    }
    setStatus(r, 'sending');
    try {
      await sendOne(r);
      setStatus(r, 'sent'); addSent(1);
      ok++; logLine('ok', `sent → ${r.email}${r.owner ? ' (' + r.owner + ')' : ''}`);
    } catch (err) {
      setStatus(r, 'failed', err.message);
      fail++; logLine('err', `fail → ${r.email}: ${err.message}`);
    }
    done++;
    setProgress(done / batch.length, `${done}/${batch.length} · ${ok} sent · ${fail} failed`);
    if (delayMs && done < batch.length && !stopRequested) await sleep(delayMs);
  }

  sending = false;
  els.sendBtn.disabled = false;
  els.stopBtn.classList.add('hidden');
  updateCounts();
  const stillPending = recipients.filter((r) => validEmail(r.email) && r.status !== 'sent').length;
  if (remainingToday() <= 0 && stillPending > 0) {
    startResetCountdown();
    toast(`Daily cap reached — ${ok} sent, ${stillPending} remaining. Run again after midnight.`, 'bad');
  } else {
    toast(`Done — ${ok} sent${fail ? ', ' + fail + ' failed' : ''}.`, fail ? 'bad' : 'good');
  }
}

async function sendTest() {
  if (!preflight()) return;
  const email = els.testEmail.value.trim();
  if (!validEmail(email)) { toast('Enter a valid test email.', 'bad'); els.testEmail.focus(); return; }
  els.sendTestBtn.disabled = true;
  els.log.classList.add('show');
  const r = { company: 'Koovai Jewelers', owner: 'John Patel', email };
  logLine('info', `test → ${email}…`);
  try {
    await sendOne(r);
    logLine('ok', `test delivered to ${email}.`);
    toast('Test sent — check your inbox.', 'good');
  } catch (err) {
    logLine('err', `test failed: ${err.message}`);
    toast('Test failed — see log.', 'bad');
  }
  els.sendTestBtn.disabled = false;
}

function setStatus(r, status, error) {
  r.status = status; r.error = error || '';
  const i = recipients.indexOf(r);
  const tr = els.recipientsBody.children[i];
  if (tr) tr.children[4].innerHTML = statusBadge(r);
}
function setProgress(frac, meta) {
  els.progressFill.style.width = Math.round(frac * 100) + '%';
  els.progressMeta.textContent = meta;
}
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

/* ============================================================
   Scheduling
   ============================================================ */
function handleSchedule() {
  clearTimeout(scheduleTimer); scheduleTimer = null;
  const v = els.scheduleAt.value;
  if (!v) {
    els.scheduleNote.textContent = ''; els.sendBtn.innerHTML = '<span class="run-ico">▶</span> Run Campaign';
    if (!sending) els.stopBtn.classList.add('hidden');
    return;
  }
  const delay = new Date(v).getTime() - Date.now();
  if (delay <= 0) {
    els.scheduleNote.textContent = 'Time is in the past — will run immediately.';
    els.sendBtn.innerHTML = '<span class="run-ico">▶</span> Run Campaign';
    return;
  }
  if (delay > MAX_TIMEOUT) {
    els.scheduleNote.textContent = 'Too far out (max ~24 days). Pick a sooner time.';
    els.sendBtn.innerHTML = '<span class="run-ico">▶</span> Run Campaign';
    return;
  }
  els.sendBtn.innerHTML = '<span class="run-ico">▶</span> Schedule Run';
  els.scheduleNote.textContent = `Queued for ${new Date(v).toLocaleString()} — keep this tab open.`;
}

function startOrSchedule() {
  const v = els.scheduleAt.value;
  if (!v) { sendCampaign(); return; }
  const when = new Date(v).getTime();
  const delay = when - Date.now();
  if (delay <= 0) { sendCampaign(); return; }
  if (delay > MAX_TIMEOUT) { toast('Schedule too far out (max ~24 days).', 'bad'); return; }
  clearTimeout(scheduleTimer);
  scheduleTimer = setTimeout(() => { els.scheduleNote.textContent = 'Running now…'; sendCampaign(true); }, delay);
  els.scheduleNote.textContent = `Scheduled for ${new Date(when).toLocaleString()} — keep this tab open.`;
  els.stopBtn.classList.remove('hidden');
  toast('Campaign scheduled.', 'good');
}

/* ============================================================
   Logging / toast
   ============================================================ */
function logLine(cls, msg) {
  const t = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.innerHTML = `<span class="time">${t}</span> <span class="${cls}">${escHtml(msg)}</span>`;
  els.log.appendChild(div);
  els.log.scrollTop = els.log.scrollHeight;
  scheduleCables();
}
let toastTimer = null;
function toast(msg, kind) {
  els.toast.textContent = msg;
  els.toast.className = 'toast show ' + (kind || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 3400);
}

/* ============================================================
   Escaping
   ============================================================ */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escAttr(s) { return escHtml(s); }

/* ============================================================
   Node cables (the "ropes" between nodes)
   ============================================================ */
let cableTimer = null;
function scheduleCables() {
  if (cableTimer) clearTimeout(cableTimer);
  cableTimer = setTimeout(drawCables, 30); // setTimeout (not rAF) so it fires even when the tab is backgrounded
}
function portCenter(el, cr) {
  const r = el.getBoundingClientRect();
  return { x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2 };
}
function drawCables() {
  cableTimer = null;
  const svg = els.cables, canvas = els.canvas;
  if (!svg || !canvas) return;
  const cr = canvas.getBoundingClientRect();
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  const nodes = [...canvas.querySelectorAll('.node')];
  let defs = `<defs>
    <linearGradient id="wire" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3dd7ff"/><stop offset="1" stop-color="#d8b154"/>
    </linearGradient>
    <filter id="wglow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
  let body = '';
  for (let i = 0; i < nodes.length - 1; i++) {
    const out = nodes[i].querySelector('.port-out');
    const inp = nodes[i + 1].querySelector('.port-in');
    if (!out || !inp) continue;
    const a = portCenter(out, cr), b = portCenter(inp, cr);
    const bow = Math.max(46, (b.y - a.y) * 0.55);
    const d = `M ${a.x} ${a.y} C ${a.x} ${a.y + bow}, ${b.x} ${b.y - bow}, ${b.x} ${b.y}`;
    body += `<path d="${d}" fill="none" stroke="url(#wire)" stroke-width="2.4" stroke-linecap="round" opacity="0.5" filter="url(#wglow)"/>`;
    body += `<path d="${d}" fill="none" stroke="#bff0ff" stroke-width="2" stroke-linecap="round" stroke-dasharray="5 16" opacity="0.85"><animate attributeName="stroke-dashoffset" from="42" to="0" dur="1.3s" repeatCount="indefinite"/></path>`;
    body += `<circle r="3.4" fill="#eafdff"><animateMotion dur="2.6s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear" path="${d}"/></circle>`;
  }
  svg.innerHTML = defs + body;
}

/* ============================================================
   Sample data
   ============================================================ */
const SAMPLE_CSV = `Company_Name,Owner_Name,Email
Koovai Jewelers,John Patel,soj5@cornell.edu
Karat Fine Jewelry,Maria Lopez,soj5@cornell.edu
Lumiere Diamonds,Ankur Shah,soj5@cornell.edu`;

/* ============================================================
   Wiring
   ============================================================ */
function init() {
  loadConfig();
  refreshConnStatus();
  updateQuotaUI();
  if (remainingToday() <= 0) startResetCountdown();
  if (location.protocol === 'file:') {
    els.log.classList.add('show');
    logLine('err', 'Open from disk (file://) — EmailJS will 403. Run "node server.js" in this folder, then open http://localhost:8766.');
  }
  refreshPreviewPicker();

  CONFIG_FIELDS.forEach((k) => {
    els[k].addEventListener('input', () => {
      saveConfig();
      if (PREVIEW_FIELDS.includes(k)) renderPreview();
    });
  });

  document.querySelectorAll('[data-reveal]').forEach((b) => {
    b.addEventListener('click', () => {
      const inp = $(b.dataset.reveal);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      b.textContent = show ? 'hide' : 'show';
    });
  });

  els.browseBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readFile(f); });
  ['dragenter', 'dragover'].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => els.dropzone.addEventListener(ev, (e) => { e.preventDefault(); els.dropzone.classList.remove('drag'); }));
  els.dropzone.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });

  els.pasteToggle.addEventListener('click', () => {
    els.pasteArea.classList.toggle('hidden');
    els.pasteActions.classList.toggle('hidden');
    els.pasteArea.focus(); scheduleCables();
  });
  els.parsePasteBtn.addEventListener('click', () => {
    const txt = els.pasteArea.value.trim();
    if (!txt) { toast('Paste some rows first.', 'bad'); return; }
    ingestRows(parseCSV(txt));
  });
  els.sampleBtn.addEventListener('click', () => { els.pasteArea.value = SAMPLE_CSV; ingestRows(parseCSV(SAMPLE_CSV)); });

  els.previewPicker.addEventListener('change', renderPreview);
  els.previewFrame.addEventListener('load', scheduleCables);
  els.scheduleAt.addEventListener('change', handleSchedule);

  els.sendBtn.addEventListener('click', startOrSchedule);
  els.stopBtn.addEventListener('click', () => {
    if (scheduleTimer) {
      clearTimeout(scheduleTimer); scheduleTimer = null;
      els.scheduleNote.textContent = 'Schedule cancelled.';
      els.sendBtn.innerHTML = '<span class="run-ico">▶</span> Run Campaign';
      if (!sending) els.stopBtn.classList.add('hidden');
      toast('Scheduled campaign cancelled.', 'good');
    }
    if (sending) stopRequested = true;
  });
  els.sendTestBtn.addEventListener('click', sendTest);

  // cables: redraw on layout changes
  if (window.ResizeObserver) new ResizeObserver(scheduleCables).observe(els.canvas);
  window.addEventListener('resize', scheduleCables);
  window.addEventListener('load', scheduleCables);

  renderPreview();
  scheduleCables();
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => ingestRows(parseCSV(String(reader.result)));
  reader.onerror = () => toast('Could not read that file.', 'bad');
  reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', init);
