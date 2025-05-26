import fs from 'fs';
import pdfParse from 'pdf-parse';

export async function parseResume(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  const rawText = pdfData.text;

  return {
    name: extractName(rawText),
    email: extractEmail(rawText),
    phone: extractPhone(rawText),
    skills: extractSkills(rawText),
    certifications: extractCertifications(rawText),
    experience: extractExperience(rawText),
    education: extractEducation(rawText),
    raw: rawText
  };
}

function extractName(text) {
  const match = text.match(/^[A-Z][a-z]+\s+[A-Z][a-z]+/);
  return match ? match[0] : null;
}

function extractEmail(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text) {
  const match = text.match(/(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{4}/);
  return match ? match[0] : null;
}

function extractSkills(text) {
  const skillKeywords = ['JavaScript', 'Python', 'Node.js', 'React', 'SQL', 'Docker', 'AWS', 'Java', 'C++'];
  return skillKeywords.filter(skill => new RegExp(`\\b${skill}\\b`, 'i').test(text));
}

function extractCertifications(text) {
  const certPatterns = [
    /AWS Certified[^.\n]*/gi,
    /Google Certified[^.\n]*/gi,
    /Microsoft Certified[^.\n]*/gi,
    /Certified[^.\n]*/gi
  ];
  return certPatterns.flatMap(pattern => text.match(pattern) || []);
}

function extractExperience(text) {
  const lines = text.split('\n');
  return lines.filter(line => /experience|worked at|role|position/i.test(line)).slice(0, 5);
}

function extractEducation(text) {
  const lines = text.split('\n');
  return lines.filter(line => /university|college|bachelor|master|ph\.?d/i.test(line)).slice(0, 5);
}
