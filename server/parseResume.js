export async function parseResumeBuffer(buffer) {
  console.log(`Processing buffer of size: ${buffer.length} bytes`);
  return {
    name: "Test User",
    email: "test@example.com",
    phone: "123-456-7890",
    skills: ["JavaScript", "React"],
    certifications: [],
    experience: ["Test experience"],
    education: ["Test education"],
    raw: "Mock resume data"
  };
}
