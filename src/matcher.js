const TARGET_TITLE = /\b(?:software\s+(?:development\s+)?engineer(?:\s*[-–]?\s*(?:1|2|i|ii))?|sde\s*[-–]?\s*(?:1|2|i|ii)\b|backend(?:\s+software)?\s+engineer|java\s+(?:backend\s+engineer|developer)|application\s+developer|platform\s+engineer)\b/i;
const DISALLOWED_TITLE = /\b(?:staff|principal|architect|manager|director|head|vice\s+president|vp|distinguished|fellow|lead|leader|leadership)\b/i;
const DISALLOWED_SPECIALIZATION = /(?:\b(?:ph\.?d|embedded|firmware|front[- ]?end|ios|android|react\s+native|machine\s+learning|ai\s*(?:\/\s*ml|platform)?|quality\s+assurance|(?:software\s+engineer\s+in\s+)?test|test\s+automation|site\s+reliability|sre|verification|validation|software\s+support|graphics|rust)\b|\bc\+\+(?!\+))/i;
const TOO_HIGH_NUMBERED_LEVEL = /\b(?:software\s+(?:development\s+)?engineer|sde)\s*[-–]?\s*(?:3|iii|4|iv)\b/i;
const SENIOR_TITLE = /\b(?:senior|sr\.?)\b/i;
const NON_BACKEND_SENIOR_TITLE = /\b(?:front[- ]?end|mobile|ios|android|devops|test|qa|quality|systems?|embedded|firmware|graphics|machine\s+learning|data)\b/i;
const TARGET_LOCATION = /\b(?:india|hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai)\b/i;
const REMOTE = /\bremote\b/i;

const SKILLS = [
  ['Java', /\bjava\b/i],
  ['Spring Boot', /\bspring\s*boot\b/i],
  ['Spring Data JPA', /\bspring\s+data\s+jpa\b/i],
  ['JPA', /\bjpa\b/i],
  ['Hibernate', /\bhibernate\b/i],
  ['Kafka', /\bkafka\b/i],
  ['Microservices', /\bmicro[- ]?services?\b/i],
  ['REST APIs', /\brest(?:ful)?\s+api(?:s)?\b/i],
  ['MongoDB', /\bmongo\s*db\b/i],
  ['SQL', /\b(?:sql|sql\s*server)\b/i],
  ['Batch processing', /\bbatch\s+processing\b/i],
  ['Event-driven architecture', /\bevent[- ]driven(?:\s+architecture)?\b/i],
  ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\b(?:kubernetes|k8s)\b/i],
  ['OpenShift', /\bopen\s*shift\b/i],
  ['Jenkins', /\bjenkins\b/i],
  ['CI/CD', /\bci\s*\/\s*cd\b|continuous\s+(?:integration|delivery|deployment)/i],
  ['Grafana', /\bgrafana\b/i],
  ['Splunk', /\bsplunk\b/i],
];

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function extractSkills(text) {
  return SKILLS.filter(([, pattern]) => pattern.test(text || '')).map(([name]) => name);
}

export function extractExperience(text) {
  const source = compact(text);
  const values = [];
  const ranges = [];
  const patterns = [
    /\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/gi,
    /\b(?:minimum|min\.?|at\s+least)\s+(?:of\s+)?(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/gi,
    /\b(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/gi,
    /\b(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+|relevant\s+)?experience\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const min = Number(match[1]);
      const max = match[2] ? Number(match[2]) : null;
      if (min > 30 || (max != null && max > 30)) continue;
      const label = compact(match[0]);
      if (!values.some((value) => value.toLowerCase() === label.toLowerCase())) values.push(label);
      ranges.push({ min, max });
    }
  }
  return { display: values.slice(0, 3).join('; '), ranges };
}

function experienceFits(experience) {
  if (!experience.ranges.length) return true;
  return experience.ranges.some(({ min, max }) => min <= 4 && (max == null || max >= 1));
}

function reject(reasonCode, reason, details) {
  return { matched: false, reason, reasonCode, rejection: { code: reasonCode, details } };
}

export function isPotentialJob(job) {
  const text = `${job.title || ''} ${job.summary || ''}`;
  const location = `${job.location || ''} ${job.summary || ''}`;
  return TARGET_TITLE.test(text) && (TARGET_LOCATION.test(location) || (REMOTE.test(location) && /\bindia\b/i.test(location)));
}

export function matchJob(job) {
  const title = compact(job.title);
  const description = compact(job.description || job.summary);
  const location = compact(job.location || description.slice(0, 500));
  const allText = `${title} ${description}`;
  const locationText = `${location} ${description.slice(0, 800)}`;

  if (!title) return reject('TITLE_MISSING', 'title', 'No job title was parsed.');
  if (!TARGET_TITLE.test(title)) return reject('TITLE_NOT_TARGET', 'title', `Title is outside the requested role families: ${title}`);
  if (DISALLOWED_TITLE.test(title)) return reject('SENIORITY_EXCLUDED', 'seniority', `Title contains an excluded leadership or advanced-seniority marker: ${title}`);
  if (DISALLOWED_SPECIALIZATION.test(title)) return reject('SPECIALIZATION_EXCLUDED', 'specialization-or-level', `Title is an excluded specialization: ${title}`);
  if (TOO_HIGH_NUMBERED_LEVEL.test(title)) return reject('LEVEL_TOO_HIGH', 'specialization-or-level', `Numbered role level is above Engineer II/SDE-2: ${title}`);
  if (!(TARGET_LOCATION.test(locationText) || (REMOTE.test(locationText) && /\bindia\b/i.test(locationText)))) {
    return reject('LOCATION_OUTSIDE_TARGET', 'location', `No target India location was found in: ${location || 'missing location'}`);
  }

  const experience = extractExperience(description);
  if (!experienceFits(experience)) return reject('EXPERIENCE_TOO_HIGH', 'experience', `Stated experience does not overlap 1-4 years: ${experience.display}`);
  if (!description) return reject('DESCRIPTION_MISSING', 'description', 'No description or listing summary was parsed before filtering.');

  const skills = extractSkills(allText);
  if (!skills.length) return reject('SKILL_SIGNAL_MISSING', 'skills', 'No requested stack keyword was found; every skill is not required, but at least one signal is needed.');
  const senior = SENIOR_TITLE.test(title);
  if (senior) {
    const explicitBackendTitle = /\b(?:backend|back-end|java)\b/i.test(title);
    const strongBackendStack = /\bjava\b/i.test(description)
      && [/\bspring\s*boot\b/i, /\bmicro[- ]?services?\b/i, /\bkafka\b/i, /\brest(?:ful)?\s+api/i, /\b(?:hibernate|jpa)\b/i]
        .filter((pattern) => pattern.test(description)).length >= 2;
    if (!experience.ranges.length || NON_BACKEND_SENIOR_TITLE.test(title) || (!explicitBackendTitle && !strongBackendStack)) {
      return reject('SENIOR_ROLE_INSUFFICIENT_EVIDENCE', 'senior-without-suitable-backend-experience', 'Senior role lacks explicit compatible experience and strong backend evidence.');
    }
  }

  let score = 45;
  if (/\b(?:java|backend|back-end)\b/i.test(allText)) score += 18;
  score += Math.min(skills.length * 4, 24);
  if (experience.ranges.length) score += 8;
  if (/\b(?:hyderabad|bengaluru|bangalore|chennai|pune|gurugram|gurgaon|noida|mumbai)\b/i.test(location)) score += 5;
  if (senior) score -= 8;

  const why = [`The ${title} title is within the requested software/backend role family.`];
  why.push(`It mentions ${skills.slice(0, 5).join(', ')}, which overlap with your stack.`);
  if (experience.display) why.push(`The stated experience (${experience.display}) overlaps your target range.`);
  else why.push('No explicit experience requirement was found, so it remains eligible.');
  why.push(`The role is listed for ${location || 'a target India location'}.`);

  return {
    matched: true,
    reasonCode: 'ACCEPTED_PROFILE_MATCH',
    score,
    skills,
    experience: experience.display || 'Not specified',
    explanation: why.join(' '),
  };
}
