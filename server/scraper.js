import puppeteer from 'puppeteer';

export default async function scrapeLinkedInProfile(profileUrl) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(profileUrl, { waitUntil: 'networkidle2' });

  // Wait a bit to ensure all elements load
  await page.waitForTimeout(2000);

  // Scrape name
  const name = await page.$eval('.text-heading-xlarge', el => el.textContent.trim());

  // Scrape skills
  const skills = await page.$$eval('.skill-entity__skill-name', els =>
    els.map(el => el.textContent.trim())
  );

  // Scrape certifications
  const certifications = await page.$$eval('.certification__title', els =>
    els.map(el => el.textContent.trim())
  );

  // Scrape profile picture URL
  let profilePicture = null;
  try {
    profilePicture = await page.$eval('.pv-top-card-profile-picture__image, .profile-photo-edit__preview', el =>
      el.getAttribute('src')
    );
  } catch (err) {
    console.warn('Profile picture not found:', err.message);
  }

  await browser.close();

  return { name, skills, certifications, profilePicture };
}

