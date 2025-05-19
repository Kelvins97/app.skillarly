import puppeteer from 'puppeteer';

export default async function scrapeLinkedInProfile(profileUrl) {
  const browser = await puppeteer.launch({ 
    headless: 'new', // Use new headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images', // Don't load images for faster scraping
      '--disable-javascript', // Disable JS after page load
    ]
  });

  const page = await browser.newPage();

  // Set realistic viewport and user agent
  await page.setViewport({ width: 1366, height: 768 });
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  // Block unnecessary resources to speed up and reduce detection
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    // Navigate with random delay to mimic human behavior
    await page.goto(profileUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // Random wait between 2-5 seconds
    await page.waitForTimeout(Math.floor(Math.random() * 3000) + 2000);

    // Scroll to load lazy-loaded content
    await autoScroll(page);

    // Wait for potential dynamic content
    await page.waitForTimeout(3000);

    // Extract data using multiple fallback selectors
    const data = await page.evaluate(() => {
      // Helper function to get text from multiple possible selectors
      function getTextBySelectors(selectors) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            return element.textContent?.trim() || '';
          }
        }
        return null;
      }

      // Helper function to get all texts from multiple possible selectors
      function getAllTextsBySelectors(selectors) {
        const results = new Set(); // Use Set to avoid duplicates
        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            const text = el.textContent?.trim();
            if (text) results.add(text);
          });
        }
        return Array.from(results);
      }

      // Helper function to get attribute from multiple possible selectors
      function getAttributeBySelectors(selectors, attribute) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            const attr = element.getAttribute(attribute);
            if (attr) return attr;
          }
        }
        return null;
      }

      // Extract name with multiple fallback selectors
      const nameSelectors = [
        '.text-heading-xlarge',
        '.pv-text-details__left-panel h1',
        '.top-card-layout__title',
        '.pv-top-card--list h1',
        'h1[data-generated-suggestion-target]',
        '.ph5 h1',
        '.pv-top-card__photo + div h1',
        '[data-anonymize="person-name"]'
      ];
      const name = getTextBySelectors(nameSelectors);

      // Extract title/headline
      const titleSelectors = [
        '.text-body-medium.break-words',
        '.pv-text-details__left-panel .text-body-medium',
        '.top-card-layout__headline',
        '.pv-top-card--list .text-body-medium',
        '.pv-text-details__left-panel .pv-shared-text-with-see-more',
        '.ph5 .text-body-medium'
      ];
      const title = getTextBySelectors(titleSelectors);

      // Extract location
      const locationSelectors = [
        '.text-body-small.inline.t-black--light.break-words',
        '.pv-text-details__left-panel .pv-text-details__left-panel-item .text-body-small',
        '.top-card-layout__first-subline',
        '.pv-top-card--list .pv-top-card--list-bullet',
        '.ph5 .text-body-small'
      ];
      const location = getTextBySelectors(locationSelectors);

      // Extract skills with multiple selectors
      const skillSelectors = [
        '.skill-entity__skill-name',
        '.pvs-skill__skill-name',
        '.skill-category-entity__skill-name',
        '[data-field="skill_name"]',
        '.skill-name',
        '.pvs-list__item .mr1',
        '.skills-section .skill'
      ];
      const skills = getAllTextsBySelectors(skillSelectors);

      // Extract certifications
      const certificationSelectors = [
        '.certification__title',
        '.pvs-certification__title',
        '.pv-accomplishments-block .pv-accomplishments-block__title',
        '[data-field="certification_name"]',
        '.certification-name',
        '.pvs-list__item .mr1'
      ];
      const certifications = getAllTextsBySelectors(certificationSelectors);

      // Extract experience/companies
      const experienceSelectors = [
        '.experience-entity__company-name',
        '.pvs-list .pvs-entity__caption-wrapper .t-14',
        '.pv-experience-entity h3',
        '[data-field="company_name"]',
        '.company-name',
        '.pvs-list__item .t-14.t-black--light'
      ];
      const companies = getAllTextsBySelectors(experienceSelectors);

      // Extract education
      const educationSelectors = [
        '.education-entity__school-name',
        '.pvs-list .pvs-entity__caption-wrapper .t-16',
        '.pv-education-entity h3',
        '[data-field="school_name"]',
        '.school-name',
        '.pvs-list__item .t-16'
      ];
      const education = getAllTextsBySelectors(educationSelectors);

      // Extract profile picture with multiple selectors
      const profilePictureSelectors = [
        '.pv-top-card-profile-picture__image',
        '.profile-photo-edit__preview',
        '.pv-top-card__photo img',
        '.photo-container img',
        '.presence-entity__image',
        'img[data-anonymize="headshot"]',
        '.top-card-layout__entity-image img'
      ];
      const profilePicture = getAttributeBySelectors(profilePictureSelectors, 'src');

      // Extract connection count
      const connectionSelectors = [
        '.top-card-layout__headline + div a',
        '.pv-top-card--list .pv-top-card--list-bullet:last-child',
        '.pv-top-card__connections',
        '.pv-text-details__left-panel .pv-text-details__left-panel-item:last-child'
      ];
      const connections = getTextBySelectors(connectionSelectors);

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

  } catch (error) {
    await browser.close();
    throw new Error(`Scraping failed: ${error.message}`);
  }
} // <- This closing brace was missing!

// Helper function to scroll page and load lazy content
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        // Stop when reached bottom or after reasonable scroll
        if (totalHeight >= scrollHeight || totalHeight >= 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
  
  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
}

// Additional utility function for rate limiting
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
    } catch (error) {
      reject(error);
    }
    
    // Wait before processing next request
    setTimeout(() => {
      isProcessing = false;
      processQueue();
    }, 60000 / requestsPerMinute);
  }

  return function rateLimitedScrape(profileUrl) {
    return new Promise((resolve, reject) => {
      queue.push({
        resolve,
        reject,
        fn: () => scrapeLinkedInProfile(profileUrl)
      });
      processQueue();
    });
  };
}

// Usage example with rate limiting:
// const rateLimitedScraper = createRateLimiter(5); // 5 requests per minute
// const data = await rateLimitedScraper('https://linkedin.com/in/username');
