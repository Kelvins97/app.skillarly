import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export default async function scrapeLinkedInProfile(profileUrl) {
  /*const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: { width: 1366, height: 768 }
  });*/

   const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(), // 👈 dynamically resolves the path
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'stylesheet', 'font'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(Math.floor(Math.random() * 3000) + 2000);
    await autoScroll(page);
    await page.waitForTimeout(3000);

    const data = await page.evaluate(() => {
      function getTextBySelectors(selectors) {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) return el.textContent?.trim() || '';
        }
        return null;
      }

      function getAllTextsBySelectors(selectors) {
        const results = new Set();
        for (const selector of selectors) {
          document.querySelectorAll(selector).forEach(el => {
            const text = el.textContent?.trim();
            if (text) results.add(text);
          });
        }
        return Array.from(results);
      }

      function getAttributeBySelectors(selectors, attr) {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          if (el) {
            const val = el.getAttribute(attr);
            if (val) return val;
          }
        }
        return null;
      }

      const name = getTextBySelectors([
        '.text-heading-xlarge',
        '.pv-text-details__left-panel h1',
        '.top-card-layout__title'
      ]);

      const title = getTextBySelectors([
        '.text-body-medium.break-words',
        '.top-card-layout__headline'
      ]);

      const location = getTextBySelectors([
        '.text-body-small.inline.t-black--light.break-words',
        '.top-card-layout__first-subline'
      ]);

      const skills = getAllTextsBySelectors([
        '.skill-entity__skill-name',
        '.pvs-skill__skill-name',
        '.skill-category-entity__skill-name'
      ]);

      const certifications = getAllTextsBySelectors([
        '.certification__title',
        '.pvs-certification__title'
      ]);

      const companies = getAllTextsBySelectors([
        '.experience-entity__company-name',
        '.pv-experience-entity h3'
      ]);

      const education = getAllTextsBySelectors([
        '.education-entity__school-name',
        '.pv-education-entity h3'
      ]);

      const profilepicture = getAttributeBySelectors([
        '.pv-top-card-profile-picture__image',
        '.profile-photo-edit__preview'
      ], 'src');

      const connections = getTextBySelectors([
        '.top-card-layout__headline + div a',
        '.pv-top-card__connections'
      ]);

      return {
        name,
        title,
        location,
        skills,
        certifications,
        companies,
        education,
        profilepicture,
        connections: connections ? connections.replace(/[^\d]/g, '') : null
      };
    });

    await browser.close();
    return data;
  } catch (err) {
    await browser.close();
    throw new Error(`Scraping failed: ${err.message}`);
  }
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight >= 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  await page.evaluate(() => window.scrollTo(0, 0));
}

export function createRateLimiter(requestsPerMinute = 10) {
  const queue = [];
  let isProcessing = false;

  async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { resolve, reject, fn } = queue.shift();
    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    }
    setTimeout(() => {
      isProcessing = false;
      processQueue();
    }, 60000 / requestsPerMinute);
  }

  return function rateLimitedScrape(profileUrl) {
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, fn: () => scrapeLinkedInProfile(profileUrl) });
      processQueue();
    });
  };
}



