/**
 * Static snapshot of the public site.
 *
 * Pages are captured AFTER hydration in a real browser, so server-computed
 * prices and the client-side quote preview are already in the DOM. The Next
 * runtime is then stripped — its router would fetch RSC payloads that do not
 * exist in a snapshot — and links are flattened to local files.
 *
 * The configurator stays usable: one page is captured per account size, and
 * choosing a size navigates between them. Every figure on every variant is the
 * one the server actually calculated.
 *
 * Usage: node scripts/snapshot-site.mjs <outDir> [baseUrl]
 */
import { chromium } from 'playwright';
import { writeFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.argv[2];
const BASE = process.argv[3] ?? 'http://localhost:4400';
if (!OUT) throw new Error('usage: node scripts/snapshot-site.mjs <outDir> [baseUrl]');

const PAGES = [
  ['/', 'index'], ['/rules', 'rules'], ['/payouts', 'payouts'], ['/platform', 'platform'],
  ['/about', 'about'], ['/faq', 'faq'], ['/contact', 'contact'],
  ['/login', 'login'], ['/register', 'register'],
  ['/legal/trader-agreement', 'legal-trader-agreement'],
  ['/legal/simulation-and-reward-disclosure', 'legal-simulation-and-reward-disclosure'],
  ['/legal/payout-policy', 'legal-payout-policy'],
  ['/legal/purchase-and-refund-terms', 'legal-purchase-and-refund-terms'],
  ['/legal/prohibited-conduct', 'legal-prohibited-conduct'],
  ['/legal/privacy-and-data', 'legal-privacy-and-data'],
  ['/legal/electronic-signature-consent', 'legal-electronic-signature-consent'],
];

const slugFor = new Map([...PAGES.map(([p, n]) => [p, `${n}.html`]), ['/accounts', 'accounts.html']]);
const cssFiles = new Set();

const NOTICE = `<div style="background:#3a2a05;border-bottom:1px solid rgba(251,191,36,.4);color:#fbbf24;padding:8px 16px;text-align:center;font:400 13px Arial,Helvetica,sans-serif">
<strong>Static snapshot.</strong> Real pages from the running build. Navigation, layout, the hero animation and account selection are live &mdash; sign-in, checkout and the dashboards need the server.
</div>`;

const PLAN_NAV = `<script>
document.querySelectorAll('input[name="planKey"]').forEach(function (input) {
  input.addEventListener('change', function () { location.href = 'accounts-' + input.value + '.html'; });
});
document.querySelectorAll('input[type=checkbox], #coupon').forEach(function (el) {
  el.disabled = true;
  el.title = 'Add-ons and discount codes are priced on the server, which a snapshot does not run.';
});
</script>`;

function rewrite(html, { planNav = false } = {}) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<link[^>]+rel="preload"[^>]*>/gi, '');
  html = html.replace(/href="(\/_next\/static\/[^"]+\.css)"/g, (_m, h) => {
    cssFiles.add(h); return `href="${h.split('/').pop()}"`;
  });
  html = html.replace(/\/_next\/image\?url=%2Fbrand%2F([^"&\s]+)[^"\s]*/g, (_m, f) => `brand/${f}`);
  html = html.replace(/\ssrcset="[^"]*"/gi, '');
  html = html.replace(/href="\/checkout\?plan=(SIM_[0-9]+K)"/g, 'href="accounts-$1.html"');
  html = html.replace(/href="\/icon\.png[^"]*"/g, 'href="icon.png"');
  html = html.replace(/href="(\/[^"#?]*)"/g, (match, path) => {
    const clean = path.replace(/\/$/, '') || '/';
    if (slugFor.has(clean)) return `href="${slugFor.get(clean)}"`;
    if (/^\/(api|dashboard|admin|checkout)/.test(clean)) return 'href="#" data-needs-server="true"';
    return match;
  });
  html = html.replace(/<form\b/gi, '<form onsubmit="return false"');
  html = html.replace(/(<body[^>]*>)/i, `$1${NOTICE}`);
  if (planNav) html = html.replace(/<\/body>/i, `${PLAN_NAV}</body>`);
  return html;
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await mkdir(join(OUT, 'brand'), { recursive: true });

// Account sizes come from the live page, so a catalog change needs no edit here.
const probe = await ctx.newPage();
await probe.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded', timeout: 60000 });
const plans = await probe.$$eval('input[name="planKey"]', (els) => els.map((e) => e.value));
await probe.close();
console.log(`plans found: ${plans.join(', ')}`);

for (const [path, name] of PAGES) {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 })
    .catch(() => page.goto(BASE + path, { waitUntil: 'domcontentloaded' }));
  await page.waitForTimeout(600);
  await writeFile(join(OUT, `${name}.html`), rewrite(await page.content()), 'utf8');
  console.log(`captured ${path}`);
  await page.close();
}

const DEFAULT_PLAN = plans.includes('SIM_50K') ? 'SIM_50K' : plans[0];
for (const plan of plans) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/accounts`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(500);
  await page.locator(`label:has(input[name="planKey"][value="${plan}"])`).click();
  await page.waitForFunction(() => !document.body.textContent.includes('Calculating…'), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const html = rewrite(await page.content(), { planNav: true });
  await writeFile(join(OUT, `accounts-${plan}.html`), html, 'utf8');
  if (plan === DEFAULT_PLAN) await writeFile(join(OUT, 'accounts.html'), html, 'utf8');
  const total = await page.locator('dt:has-text("Total due today") + dd').textContent().catch(() => '?');
  console.log(`accounts-${plan}.html  total ${total.trim()}`);
  await page.close();
}

for (const href of cssFiles) {
  const res = await fetch(BASE + href);
  await writeFile(join(OUT, href.split('/').pop()), await res.text(), 'utf8');
}
for (const file of ['bull-rush-futures.png', 'bull-mark.png']) {
  await copyFile(join('public/brand', file), join(OUT, 'brand', file));
}
await copyFile('src/app/icon.png', join(OUT, 'icon.png'));
await browser.close();
console.log('snapshot complete');
