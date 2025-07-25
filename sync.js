const puppeteer = require('puppeteer');
const fetch     = require('node-fetch');
const FormData  = require('form-data');

// 1) Your WP site + admin creds (use a machine‑user or app password!)
// At the top of sync.js
const WP_SITE = process.env.WP_SITE;
const WP_USER = process.env.WP_USER;
const WP_PASS = process.env.WP_PASS;

const AUTH    = 'Basic ' + Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

// 2) Map Woo product IDs → Warde URLs
const fabrics = [
  { wooId: 4232, wardeUrl: 'https://warde.com/products/246047' },
  // ...add more here...
];

(async()=>{
  const browser = await puppeteer.launch({args:['--no-sandbox']});
  const page    = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0');

  for(const f of fabrics){
    console.log(`🔍 Fetching ${f.wardeUrl}`);
    await page.goto(f.wardeUrl, { waitUntil: 'networkidle2' });

    // Scrape the “Available Stock” value:
    const raw = await page.$eval(
      'li span.title:contains("Available Stock") + span.value',
      el => el.textContent
    ).catch(()=>null);
    const qty = raw && raw.match(/\d+/) ? parseInt(raw.match(/\d+/)[0],10) : 0;
    console.log(`  → qty=${qty}`);

    // POST back to WP
    const form = new FormData();
    form.append('product_id', f.wooId);
    form.append('qty', qty);
    const resp = await fetch(`${WP_SITE}/wp-json/warde-sync/v1/stock`, {
      method: 'POST',
      headers: { 'Authorization': AUTH },
      body: form
    });
    console.log('  → WP response:', await resp.json());
  }

  await browser.close();
})();
