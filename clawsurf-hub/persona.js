/* ═══════════════════════════════════════════════════════════
   persona.js — AMI Browser Persona Page Logic
   Local OCR-like text parsing for CV/LinkedIn/text import
   ═══════════════════════════════════════════════════════════ */
'use strict';

const PERSONA_FIELDS = [
  'name','firstName','lastName','email','phone','company','jobTitle',
  'address','city','zip','country','website','bio','skills','education','languages'
];

/* ══════════════ Storage helpers ══════════════ */
function storeGet(key, fallback) {
  return new Promise(resolve => {
    chrome.storage.local.get(key, d => resolve(d[key] ?? fallback));
  });
}
function storeSet(key, val) {
  return new Promise(resolve => chrome.storage.local.set({ [key]: val }, resolve));
}

/* ══════════════ Toast ══════════════ */
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2500);
}

/* ══════════════ Load / Save ══════════════ */
async function loadPersona() {
  const persona = await storeGet('ami_persona', {});
  PERSONA_FIELDS.forEach(f => {
    const el = document.getElementById(`persona-${f}`);
    if (el && persona[f]) el.value = persona[f];
  });
}

function getPersonaFromForm() {
  const persona = {};
  PERSONA_FIELDS.forEach(f => {
    const el = document.getElementById(`persona-${f}`);
    if (el && el.value.trim()) persona[f] = el.value.trim();
  });
  return persona;
}

async function savePersona() {
  const persona = getPersonaFromForm();
  await storeSet('ami_persona', persona);
  showToast('✅ Persona saved');
}

function applyPersonaToForm(data) {
  PERSONA_FIELDS.forEach(f => {
    const el = document.getElementById(`persona-${f}`);
    if (el && data[f]) el.value = data[f];
  });
}

/* ══════════════ Text parsing engine (local OCR-like) ══════════════ */
function parseTextToPersona(text) {
  const result = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = text;

  // Email
  const emailMatch = fullText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (emailMatch) result.email = emailMatch[0];

  // Phone — international formats
  const phoneMatch = fullText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/);
  if (phoneMatch) {
    const cleaned = phoneMatch[0].replace(/[^\d+()-\s]/g, '').trim();
    if (cleaned.replace(/\D/g, '').length >= 7) result.phone = cleaned;
  }

  // Website / URL
  const urlMatch = fullText.match(/https?:\/\/[\w.-]+(?:\.[\w.-]+)+[^\s,)>]*/i);
  if (urlMatch) result.website = urlMatch[0];

  // LinkedIn URL extraction
  const linkedinMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+/i);
  if (linkedinMatch && !result.website) result.website = linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`;

  // Name — try labeled patterns first, then heuristic (first non-empty line that looks like a name)
  const namePatterns = [
    /(?:full\s*name|name)\s*[:：]\s*(.+)/i,
    /(?:^|\n)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s*(?:\n|$)/,
  ];
  for (const p of namePatterns) {
    const m = fullText.match(p);
    if (m) { result.name = m[1].trim(); break; }
  }
  // Fallback: first line if it looks like a name (2-4 capitalized words, no digits, no special chars)
  if (!result.name && lines.length) {
    const firstLine = lines[0];
    if (/^[A-Z][a-zA-ZÀ-ÿ'-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'-]+){0,3}$/.test(firstLine) && firstLine.length < 60) {
      result.name = firstLine;
    }
  }

  // Split name into first/last
  if (result.name) {
    const parts = result.name.split(/\s+/);
    if (parts.length >= 2) {
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ');
    } else {
      result.firstName = result.name;
    }
  }

  // Email-based name extraction fallback
  if (!result.name && result.email) {
    const local = result.email.split('@')[0];
    const nameParts = local.split(/[._-]/).filter(p => p.length > 1);
    if (nameParts.length >= 2) {
      result.firstName = nameParts[0].charAt(0).toUpperCase() + nameParts[0].slice(1);
      result.lastName = nameParts[1].charAt(0).toUpperCase() + nameParts[1].slice(1);
      result.name = `${result.firstName} ${result.lastName}`;
    }
  }

  // Job title patterns
  const jobPatterns = [
    /(?:title|position|role|job\s*title)\s*[:：]\s*(.+)/i,
    /(?:^|\n)\s*(?:Senior|Junior|Lead|Chief|Head|Director|Manager|Engineer|Developer|Designer|Analyst|Consultant|Specialist|Coordinator|Associate|VP|Vice President|CTO|CEO|CFO|COO|CIO|Founder|Co-founder)\s*.{0,50}(?:\n|$)/i,
  ];
  for (const p of jobPatterns) {
    const m = fullText.match(p);
    if (m) { result.jobTitle = (m[1] || m[0]).trim(); break; }
  }

  // Company
  const compPatterns = [
    /(?:company|organization|employer|org|at)\s*[:：]\s*(.+)/i,
    /(?:at|@)\s+([A-Z][\w\s&.-]{1,40}?)(?:\s*[-–|,]|\n|$)/,
  ];
  for (const p of compPatterns) {
    const m = fullText.match(p);
    if (m) { result.company = m[1].trim(); break; }
  }

  // Address patterns
  const addrPattern = /(?:address)\s*[:：]\s*(.+)/i;
  const addrMatch = fullText.match(addrPattern);
  if (addrMatch) result.address = addrMatch[1].trim();

  // City
  const cityPattern = /(?:city|town|location)\s*[:：]\s*(.+)/i;
  const cityMatch = fullText.match(cityPattern);
  if (cityMatch) result.city = cityMatch[1].trim();

  // Country
  const countryPattern = /(?:country|nation)\s*[:：]\s*(.+)/i;
  const countryMatch = fullText.match(countryPattern);
  if (countryMatch) result.country = countryMatch[1].trim();

  // ZIP
  const zipPattern = /(?:zip|postal\s*code|postcode)\s*[:：]\s*(\d{4,10}[-\s]?\d{0,4})/i;
  const zipMatch = fullText.match(zipPattern);
  if (zipMatch) result.zip = zipMatch[1].trim();

  // Skills
  const skillsPattern = /(?:skills?|expertise|technologies|tech\s*stack)\s*[:：]\s*(.+(?:\n(?!\n).+)*)/i;
  const skillsMatch = fullText.match(skillsPattern);
  if (skillsMatch) result.skills = skillsMatch[1].replace(/\n/g, ', ').trim();

  // Education
  const eduPattern = /(?:education|degree|university|college|school)\s*[:：]\s*(.+(?:\n(?!\n).+)*)/i;
  const eduMatch = fullText.match(eduPattern);
  if (eduMatch) result.education = eduMatch[1].replace(/\n/g, ', ').trim();

  // Languages
  const langPattern = /(?:languages?|speaks?)\s*[:：]\s*(.+)/i;
  const langMatch = fullText.match(langPattern);
  if (langMatch) result.languages = langMatch[1].trim();

  // Bio — "about" section or "summary"
  const bioPattern = /(?:about|summary|bio|profile|objective)\s*[:：]?\s*\n?(.{20,500})/is;
  const bioMatch = fullText.match(bioPattern);
  if (bioMatch) result.bio = bioMatch[1].trim().substring(0, 300);

  return result;
}

/* ══════════════ LinkedIn-specific parser ══════════════ */
function parseLinkedInText(text) {
  const result = parseTextToPersona(text);

  // LinkedIn-specific patterns
  // "Name\nTitle at Company\nLocation"
  const headerPattern = /^(.+)\n(.+?)(?:\s+at\s+|\s+chez\s+|\s+@\s+)(.+?)\n(.+?)$/m;
  const headerMatch = text.match(headerPattern);
  if (headerMatch) {
    if (!result.name) result.name = headerMatch[1].trim();
    if (!result.jobTitle) result.jobTitle = headerMatch[2].trim();
    if (!result.company) result.company = headerMatch[3].trim();
    if (!result.city) result.city = headerMatch[4].trim();
  }

  // "Experience" section
  const expPattern = /Experience\n(.+?)(?:\n(?:Education|Skills|Licenses|Certifications|Languages|Interests)\n|$)/is;
  const expMatch = text.match(expPattern);
  if (expMatch && !result.jobTitle) {
    const expLines = expMatch[1].split('\n').filter(Boolean);
    if (expLines[0]) result.jobTitle = expLines[0].trim();
    if (expLines[1]) result.company = expLines[1].trim();
  }

  // "Skills" section
  const skillsSection = /Skills\n(.+?)(?:\n(?:Education|Experience|Languages|Interests|Certifications)\n|$)/is;
  const skillsMatch = text.match(skillsSection);
  if (skillsMatch) {
    result.skills = skillsMatch[1].split('\n').filter(l => l.trim() && !l.match(/^\d+\s*endorsement/i)).map(l => l.trim()).join(', ');
  }

  // Split name
  if (result.name && !result.firstName) {
    const parts = result.name.split(/\s+/);
    if (parts.length >= 2) {
      result.firstName = parts[0];
      result.lastName = parts.slice(1).join(' ');
    }
  }

  return result;
}

/* ══════════════ File reader ══════════════ */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file'));

    if (file.type === 'application/pdf') {
      // For PDF we read as text — basic extraction
      // PDFs are binary, but FileReader.readAsText often captures enough text for parsing
      reader.readAsText(file);
    } else {
      reader.readAsText(file);
    }
  });
}

/* ══════════════ Preview ══════════════ */
let pendingImport = null;

function showPreview(data) {
  pendingImport = data;
  const container = document.getElementById('import-preview');
  const content = document.getElementById('import-preview-content');
  if (!container || !content) return;

  content.innerHTML = '';
  const fields = Object.entries(data).filter(([, v]) => v);
  if (!fields.length) {
    content.innerHTML = '<p style="color:#9ca3af">No data could be extracted. Try pasting more text or a different format.</p>';
    container.classList.remove('hidden');
    return;
  }

  fields.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `<span class="field-label">${k}:</span><span>${escHtml(String(v).substring(0, 200))}</span>`;
    content.appendChild(row);
  });
  container.classList.remove('hidden');
}

function hidePreview() {
  pendingImport = null;
  const container = document.getElementById('import-preview');
  if (container) container.classList.add('hidden');
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ══════════════ Event bindings ══════════════ */
document.addEventListener('DOMContentLoaded', () => {
  loadPersona();

  // Save
  document.getElementById('btn-save-persona')?.addEventListener('click', savePersona);

  // Export
  document.getElementById('btn-export-persona')?.addEventListener('click', async () => {
    const persona = getPersonaFromForm();
    const blob = new Blob([JSON.stringify(persona, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ami-persona-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📋 Persona exported');
  });

  // Clear
  document.getElementById('btn-clear-persona')?.addEventListener('click', async () => {
    if (!confirm('Clear all persona data?')) return;
    PERSONA_FIELDS.forEach(f => {
      const el = document.getElementById(`persona-${f}`);
      if (el) el.value = '';
    });
    await storeSet('ami_persona', {});
    showToast('🗑️ Persona cleared');
  });

  // CV upload
  document.getElementById('btn-import-cv')?.addEventListener('click', () => {
    document.getElementById('file-cv')?.click();
  });
  document.getElementById('file-cv')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const parsed = parseTextToPersona(text);
      showPreview(parsed);
      showToast(`📄 Parsed ${Object.keys(parsed).length} fields from ${file.name}`);
    } catch (err) {
      showToast('❌ Failed to read file');
    }
    e.target.value = '';
  });

  // JSON import
  document.getElementById('btn-import-json')?.addEventListener('click', () => {
    document.getElementById('file-json')?.click();
  });
  document.getElementById('file-json')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      const data = JSON.parse(text);
      showPreview(data);
      showToast(`📋 Loaded ${Object.keys(data).length} fields from JSON`);
    } catch {
      showToast('❌ Invalid JSON file');
    }
    e.target.value = '';
  });

  // Text import
  document.getElementById('btn-import-text')?.addEventListener('click', () => {
    document.getElementById('text-import-area')?.classList.remove('hidden');
  });
  document.getElementById('btn-cancel-text')?.addEventListener('click', () => {
    document.getElementById('text-import-area')?.classList.add('hidden');
  });
  document.getElementById('btn-parse-text')?.addEventListener('click', () => {
    const input = document.getElementById('text-import-input');
    if (!input?.value.trim()) { showToast('Paste some text first'); return; }
    const parsed = parseTextToPersona(input.value);
    showPreview(parsed);
    document.getElementById('text-import-area')?.classList.add('hidden');
    showToast(`📝 Extracted ${Object.keys(parsed).length} fields`);
  });

  // LinkedIn import
  document.getElementById('btn-import-linkedin')?.addEventListener('click', () => {
    document.getElementById('linkedin-import-area')?.classList.remove('hidden');
  });
  document.getElementById('btn-cancel-linkedin')?.addEventListener('click', () => {
    document.getElementById('linkedin-import-area')?.classList.add('hidden');
  });
  document.getElementById('btn-parse-linkedin')?.addEventListener('click', () => {
    const input = document.getElementById('linkedin-import-input');
    if (!input?.value.trim()) { showToast('Paste LinkedIn data first'); return; }
    const parsed = parseLinkedInText(input.value);
    showPreview(parsed);
    document.getElementById('linkedin-import-area')?.classList.add('hidden');
    showToast(`💼 Extracted ${Object.keys(parsed).length} fields from LinkedIn`);
  });

  // Apply imported data
  document.getElementById('btn-apply-import')?.addEventListener('click', async () => {
    if (!pendingImport) return;
    applyPersonaToForm(pendingImport);
    await savePersona();
    hidePreview();
    showToast('✅ Persona updated from import');
  });
  document.getElementById('btn-cancel-import')?.addEventListener('click', hidePreview);
});
