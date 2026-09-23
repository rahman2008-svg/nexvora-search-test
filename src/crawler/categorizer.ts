/**
 * NexVora Deterministic Categorization & Topic Extraction Engine
 * Categorizes documents strictly using rule-based signals, domain registries,
 * path patterns, heading heuristics, and keyword scoring.
 * (NO AI, NO LLMs, NO EMBEDDINGS)
 */

export interface CategorizationResult {
  primaryCategory: string;
  categories: string[];
  topics: string[];
}

interface CategoryRule {
  category: string;
  domainPatterns: RegExp[];
  pathPatterns: RegExp[];
  keywords: string[];
  weight: number;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'Bangladesh',
    domainPatterns: [/\.gov\.bd$/i, /\.bd$/i, /bangladesh/i, /dhaka/i, /chittagong/i],
    pathPatterns: [/\/bangladesh\b/i, /\/bd\b/i, /\/dhaka\b/i],
    keywords: [
      'bangladesh', 'dhaka', 'chittagong', 'sylhet', 'rajshahi', 'khulna',
      'bangla', 'bengali', 'taka', 'btrc', 'nbr', 'pmo', 'ictd', 'du.ac.bd', 'buet'
    ],
    weight: 2.5,
  },
  {
    category: 'Government',
    domainPatterns: [/\.gov(\.[a-z]{2})?$/i, /cabinet\.gov/i, /pmo\.gov/i, /whitehouse\.gov/i, /gov\.uk/i],
    pathPatterns: [/\/gov\b/i, /\/government\b/i, /\/ministry\b/i, /\/public-service\b/i, /\/policy\b/i],
    keywords: [
      'government', 'ministry', 'department', 'official', 'citizen', 'policy',
      'legislation', 'gazette', 'cabinet', 'parliament', 'public sector', 'administration'
    ],
    weight: 2.2,
  },
  {
    category: 'Programming',
    domainPatterns: [/github\.com/i, /python\.org/i, /rust-lang\.org/i, /go\.dev/i, /nodejs\.org/i, /typescriptlang\.org/i],
    pathPatterns: [/\/code\b/i, /\/programming\b/i, /\/api\b/i, /\/sdk\b/i, /\/developer\b/i, /\/tutorial\b/i],
    keywords: [
      'programming', 'javascript', 'typescript', 'python', 'rust', 'golang', 'compiler',
      'function', 'algorithm', 'syntax', 'repository', 'debug', 'package', 'npm', 'git'
    ],
    weight: 2.3,
  },
  {
    category: 'Technology',
    domainPatterns: [/w3\.org/i, /whatwg\.org/i, /vite\.dev/i, /react\.dev/i, /expressjs\.com/i, /tailwindcss\.com/i, /redis\.io/i, /postgresql\.org/i, /sqlite\.org/i],
    pathPatterns: [/\/tech\b/i, /\/software\b/i, /\/framework\b/i, /\/system\b/i, /\/database\b/i],
    keywords: [
      'technology', 'software', 'hardware', 'database', 'network', 'protocol',
      'cloud', 'server', 'computing', 'cybersecurity', 'infrastructure', 'web'
    ],
    weight: 2.0,
  },
  {
    category: 'Documentation',
    domainPatterns: [/docs\./i, /developer\.mozilla\.org/i, /man7\.org/i],
    pathPatterns: [/\/docs?\b/i, /\/documentation\b/i, /\/manual\b/i, /\/reference\b/i, /\/guide\b/i],
    keywords: [
      'documentation', 'api reference', 'getting started', 'quickstart', 'installation',
      'guide', 'handbook', 'cheat sheet', 'specification', 'rfc'
    ],
    weight: 2.2,
  },
  {
    category: 'Education',
    domainPatterns: [/\.edu(\.[a-z]{2})?$/i, /\.ac\.[a-z]{2}$/i, /khanacademy\.org/i, /edx\.org/i, /coursera\.org/i, /openstax\.org/i, /mit\.edu/i, /stanford\.edu/i],
    pathPatterns: [/\/courses?\b/i, /\/curriculum\b/i, /\/learn\b/i, /\/academic\b/i, /\/education\b/i, /\/university\b/i],
    keywords: [
      'education', 'university', 'curriculum', 'lecture', 'student', 'professor',
      'degree', 'campus', 'syllabus', 'course', 'academy', 'learning'
    ],
    weight: 2.1,
  },
  {
    category: 'Science',
    domainPatterns: [/nature\.com/i, /science\.org/i, /arxiv\.org/i, /cern\.ch/i, /nasa\.gov/i, /sciencedirect\.com/i],
    pathPatterns: [/\/science\b/i, /\/research\b/i, /\/physics\b/i, /\/biology\b/i, /\/astronomy\b/i],
    keywords: [
      'science', 'physics', 'chemistry', 'astronomy', 'biology', 'experiment',
      'scientific', 'quantum', 'particle', 'telescope', 'peer-reviewed', 'laboratory'
    ],
    weight: 2.1,
  },
  {
    category: 'Mathematics',
    domainPatterns: [/mathworld\.wolfram\.com/i, /ams\.org/i],
    pathPatterns: [/\/math\b/i, /\/mathematics\b/i, /\/algebra\b/i, /\/calculus\b/i],
    keywords: [
      'mathematics', 'algebra', 'calculus', 'geometry', 'theorem', 'equation',
      'matrix', 'probability', 'statistics', 'topology', 'discrete math'
    ],
    weight: 2.2,
  },
  {
    category: 'Finance',
    domainPatterns: [/imf\.org/i, /worldbank\.org/i, /bis\.org/i, /bloomberg\.com/i, /reuters\.com\/finance/i, /bb\.org\.bd/i, /dse\.com\.bd/i],
    pathPatterns: [/\/finance\b/i, /\/economy\b/i, /\/banking\b/i, /\/market\b/i, /\/investing\b/i],
    keywords: [
      'finance', 'banking', 'economy', 'monetary', 'inflation', 'stock market',
      'treasury', 'central bank', 'gdp', 'fiscal', 'investment', 'currency'
    ],
    weight: 2.2,
  },
  {
    category: 'Reference',
    domainPatterns: [/wikipedia\.org/i, /britannica\.com/i, /archive\.org/i, /gutenberg\.org/i, /merriam-webster\.com/i],
    pathPatterns: [/\/wiki\b/i, /\/encyclopedia\b/i, /\/dictionary\b/i, /\/archive\b/i],
    keywords: [
      'encyclopedia', 'dictionary', 'reference', 'definition', 'bibliography',
      'archive', 'almanac', 'lexicon', 'compendium'
    ],
    weight: 2.0,
  },
  {
    category: 'Health',
    domainPatterns: [/who\.int/i, /nih\.gov/i, /cdc\.gov/i, /mayoclinic\.org/i],
    pathPatterns: [/\/health\b/i, /\/medical\b/i, /\/disease\b/i, /\/wellness\b/i],
    keywords: [
      'health', 'medical', 'medicine', 'hospital', 'clinical', 'treatment',
      'disease', 'wellness', 'physician', 'healthcare', 'nutrition'
    ],
    weight: 2.2,
  },
  {
    category: 'News',
    domainPatterns: [/reuters\.com/i, /apnews\.com/i, /bbc\.com\/news/i, /thedailystar\.net/i, /prothomalo\.com/i],
    pathPatterns: [/\/news\b/i, /\/breaking\b/i, /\/headlines\b/i, /\/article\b/i],
    keywords: [
      'news', 'headline', 'breaking news', 'report', 'journalism', 'press',
      'correspondent', 'daily news', 'editorial'
    ],
    weight: 1.8,
  },
];

/**
 * Deterministically categorizes a page based on URL, domain, text, headings, and source metadata
 */
export function categorizeDocument(
  url: string,
  domain: string,
  title: string,
  headingsText: string,
  bodyText: string,
  sourceCategory?: string
): CategorizationResult {
  const scores: Record<string, number> = {};
  const lowerUrl = url.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerHeadings = headingsText.toLowerCase();
  const lowerBody = bodyText.toLowerCase();

  // If a source folder category was specified (e.g. from GitHub sources/Technology/...), give strong prior
  if (sourceCategory) {
    const matchedRule = CATEGORY_RULES.find(
      (r) => r.category.toLowerCase() === sourceCategory.toLowerCase()
    );
    if (matchedRule) {
      scores[matchedRule.category] = (scores[matchedRule.category] || 0) + 15;
    }
  }

  for (const rule of CATEGORY_RULES) {
    let score = scores[rule.category] || 0;

    // 1. Domain match (high confidence)
    for (const pat of rule.domainPatterns) {
      if (pat.test(lowerDomain)) {
        score += 8 * rule.weight;
        break;
      }
    }

    // 2. Path match
    for (const pat of rule.pathPatterns) {
      if (pat.test(lowerUrl)) {
        score += 5 * rule.weight;
        break;
      }
    }

    // 3. Title match
    for (const kw of rule.keywords) {
      if (lowerTitle.includes(kw)) {
        score += 4 * rule.weight;
      }
    }

    // 4. Headings match
    for (const kw of rule.keywords) {
      if (lowerHeadings.includes(kw)) {
        score += 2 * rule.weight;
      }
    }

    // 5. Body match (sampled)
    let bodyHits = 0;
    for (const kw of rule.keywords) {
      if (lowerBody.includes(kw)) {
        bodyHits++;
      }
    }
    score += Math.min(bodyHits, 8) * 0.8 * rule.weight;

    scores[rule.category] = score;
  }

  // Sort categories by score
  const sorted = Object.entries(scores)
    .filter(([_, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1]);

  const assignedCategories: string[] = [];
  if (sorted.length > 0) {
    assignedCategories.push(...sorted.slice(0, 3).map(([cat]) => cat));
  } else if (sourceCategory) {
    assignedCategories.push(sourceCategory);
  } else {
    assignedCategories.push('General');
  }

  // Extract lightweight topics (deterministic keywords with high frequency)
  const candidateTopics = new Set<string>();
  for (const cat of assignedCategories) {
    const rule = CATEGORY_RULES.find((r) => r.category === cat);
    if (rule) {
      for (const kw of rule.keywords) {
        if (lowerTitle.includes(kw) || lowerHeadings.includes(kw)) {
          candidateTopics.add(kw);
        }
      }
    }
  }

  return {
    primaryCategory: assignedCategories[0] || 'General',
    categories: assignedCategories,
    topics: Array.from(candidateTopics).slice(0, 6),
  };
}
