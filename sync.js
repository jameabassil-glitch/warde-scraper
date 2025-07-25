#!/usr/bin/env node
// sync.js
//
// 1) dynamic‐import node‑fetch so we don't blow up on ESM
const fetch = (...args) =>
  import('node-fetch').then(mod => mod.default(...args));

const puppeteer = require('puppeteer');
const axios     = require('axios');

// these three come from your workflow/env secrets:
const WP_SITE = process.env.WP_SITE;
const WP_USER = process.env.WP_USER;
const WP_PASS = process.env.WP_PASS;

// Basic auth for WooCommerce REST:
const wcAuth = { username: WP_USER, password: WP_PASS };

async function getFabricProducts() {
  // adjust the category ID or slug as needed for your “fabric” term
  // this uses the WC REST endpoint: /wp-json/wc/v3/products?category=<fabric_id>
  const res = await axios.get(
    `${WP_SITE.replace(/\/$/,'')}/wp-json/wc/v3/products`,
    {
      auth: wcAuth,
      params: {
        category: 'fabric', // or numeric term_id
        per_page: 100
      }
    }
  );
  return res.data; // array of product objects
}

async function scrapeStockFromWarde(url) {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page    = await browser.newPage();
  await page.goto(url, { timeout: 30000, waitUntil: 'networkidle2' });
  // wait for the stock line to appear
  await page.waitForSelector('li .title', { timeout: 15000 });
  // grab the list of <li> and find the one whose .title text is “Available Stock”
  const stock = await page.evaluate(()=>{
    const items = Array.from(document.querySelectorAll('li'));
    for (let li of items) {
      const title = li.querySelector('.title');
      const value = li.querySelector('.value');
      if (title && /Available\s+Stock/i.test(title.textContent||'')) {
        // value.textContent might include extra stuff like “73 Meters”
        const m = (value.textContent||'').match(/(\d+)/);
        if (m) return parseInt(m[1],10);
      }
    }
    return null;
  });
  await browser.close();
  return stock;
}

async function updateWooStock(productId, qty) {
  await axios.put(
    `${WP_SITE.replace(/\/$/,'')}/wp-json/wc/v3/products/${productId}`,
    { stock_quantity: qty, manage_stock: true },
    { auth: wcAuth }
  );
}

(async()=>{
  console.log('=== Fabric sync started ===');
  const fabrics = await getFabricProducts();
  console.log(`Found ${fabrics.length} fabrics`);
  for (let p of fabrics) {
    const pid = p.id;
    const url = p.meta_data.find(m=>m.key==='warde_url')?.value;
    if (!url) {
      console.warn(` • [${pid}] no warde_url meta → skipping`);
      continue;
    }
    console.log(` • [${pid}] scraping ${url}`);
    let newQty = null;
    try {
      newQty = await scrapeStockFromWarde(url);
    } catch(err) {
      console.error(`   → error scraping: ${err.message}`);
      continue;
    }
    if (newQty===null) {
      console.warn(`   → couldn’t parse stock, skipping`);
      continue;
    }
    console.log(`   → got stock = ${newQty}, updating WooCommerce…`);
    try {
      await updateWooStock(pid, newQty);
      console.log(`   ✓ stock updated`);
    } catch(err) {
      console.error(`   → update failed: ${err.response?.data||err.message}`);
    }
  }
  console.log('=== Fabric sync finished ===');
})();
