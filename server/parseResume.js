import fs from 'fs';
import pdfParse from 'pdf-parse';

export async function parseResume(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);

  // Simple heuristic parsing - customize as needed
  const rawText = pdfData.text;
  return {
    name: extractName(rawText),
    skills: extractSkills(rawText),
    certifications: extractCerts(rawText),
    experience: extractExperience(rawText),
    education: extractEducation(rawText),
    raw: rawText
  };
}

function extractSkills(text) {
  const skillKeywords = ['JavaScript', 'Python', 'Node.js', 'React', 'SQL', 'Docker'];
  return skillKeywords.filter(skill => text.includes(skill));
}

// Add similar regex/keyword-based extractors for certs, experience, education
