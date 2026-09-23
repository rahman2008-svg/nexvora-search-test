/**
 * NexVora Deterministic BM25 Search Engine
 * Features field boosting (title, headings, url, description, body),
 * exact phrase matching, operator parsing (site:, intitle:, inurl:, "", -),
 * freshness decay, explainable scoring breakdown, and zero AI.
 */
import { STOPWORDS, tokenizeText } from '../crawler/parser.ts';
import { dbService } from '../database/db.ts';
import { IndexedPageRecord } from '../database/schema.ts';

export interface SearchOperatorQuery {
  rawQuery: string;
  cleanedTerms: string[];
  exactPhrases: string[];
  excludedTerms: string[];
  siteFilter?: string;
  inTitleTerms: string[];
  inUrlTerms: string[];
  categoryFilter?: string;
}

export interface ExplainScore {
  termFrequency: Record<string, number>;
  bm25Base: number;
  titleBonus: number;
  headingBonus: number;
  urlBonus: number;
  phraseBonus: number;
  freshnessBonus: number;
  categoryBonus: number;
  finalScore: number;
}

export interface SearchResultItem {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  description: string;
  snippet: string;
  canonicalUrl: string | null;
  categories: string[];
  topics: string[];
  language: string;
  publishedAt?: string | null;
  indexedAt: string;
  score: number;
  explain?: ExplainScore;
}

export interface SearchResponse {
  query: string;
  parsedQuery: SearchOperatorQuery;
  totalResults: number;
  page: number;
  limit: number;
  totalPages: number;
  executionTimeMs: number;
  results: SearchResultItem[];
  suggestions: string[];
  availableCategories: string[];
}

export class SearchEngine {
  private indexedPages: IndexedPageRecord[] = [];
  private invertedIndex: Map<string, Set<string>> = new Map(); // term -> Set of page IDs
  private docLengths: Map<string, number> = new Map(); // page ID -> docLength
  private avgDocLength = 100;
  private lastIndexedCount = 0;
  private isIndexFresh = false;

  // BM25 Hyperparameters
  private readonly k1 = 1.2;
  private readonly b = 0.75;

  /**
   * Refreshes the in-memory inverted index from the persistent storage
   */
  public async refreshIndex(): Promise<void> {
    const pages = await dbService.getAllIndexedPages();
    this.indexedPages = pages;
    this.invertedIndex.clear();
    this.docLengths.clear();

    if (pages.length === 0) {
      this.avgDocLength = 100;
      this.isIndexFresh = true;
      return;
    }

    let totalLength = 0;

    for (const page of pages) {
      const length = page.docLength || (page.tokens ? page.tokens.length : 50);
      this.docLengths.set(page.id, length);
      totalLength += length;

      // Inverted index build
      const terms = page.termFrequencies ? Object.keys(page.termFrequencies) : page.tokens || [];
      for (const term of terms) {
        const lower = term.toLowerCase();
        let set = this.invertedIndex.get(lower);
        if (!set) {
          set = new Set<string>();
          this.invertedIndex.set(lower, set);
        }
        set.add(page.id);
      }
    }

    this.avgDocLength = Math.max(10, Math.round(totalLength / pages.length));
    this.lastIndexedCount = pages.length;
    this.isIndexFresh = true;
  }

  /**
   * Parses query string for search operators (site:, intitle:, inurl:, "", -)
   */
  public parseQuery(rawQuery: string, categoryFilter?: string): SearchOperatorQuery {
    const query = (rawQuery || '').trim();
    const exactPhrases: string[] = [];
    const excludedTerms: string[] = [];
    const inTitleTerms: string[] = [];
    const inUrlTerms: string[] = [];
    let siteFilter: string | undefined = undefined;

    // 1. Extract exact phrases in quotes "..."
    let modified = query.replace(/"([^"]+)"/g, (_, phrase) => {
      const p = phrase.trim();
      if (p) exactPhrases.push(p.toLowerCase());
      return ' ';
    });

    // 2. Tokenize remaining parts
    const rawTokens = modified.split(/\s+/).filter(Boolean);
    const cleanedTerms: string[] = [];

    for (const token of rawTokens) {
      const lower = token.toLowerCase();

      if (lower.startsWith('site:')) {
        siteFilter = lower.slice(5).trim();
      } else if (lower.startsWith('intitle:')) {
        const term = lower.slice(8).trim();
        if (term) {
          inTitleTerms.push(term);
          cleanedTerms.push(...tokenizeText(term));
        }
      } else if (lower.startsWith('inurl:')) {
        const term = lower.slice(6).trim();
        if (term) {
          inUrlTerms.push(term);
          cleanedTerms.push(...tokenizeText(term));
        }
      } else if (lower.startsWith('-') && lower.length > 1) {
        excludedTerms.push(lower.slice(1));
      } else {
        const words = tokenizeText(token);
        cleanedTerms.push(...words);
      }
    }

    return {
      rawQuery: query,
      cleanedTerms: Array.from(new Set(cleanedTerms)),
      exactPhrases,
      excludedTerms: Array.from(new Set(excludedTerms)),
      siteFilter,
      inTitleTerms,
      inUrlTerms,
      categoryFilter,
    };
  }

  /**
   * Calculates Inverse Document Frequency (IDF) using Lucene/BM25 formula
   */
  private calculateIdf(term: string, totalDocs: number): number {
    const matchingDocs = this.invertedIndex.get(term)?.size || 0;
    if (matchingDocs === 0) return 0;
    return Math.log(1 + (totalDocs - matchingDocs + 0.5) / (matchingDocs + 0.5));
  }

  /**
   * Executes deterministic search
   */
  public async search(
    queryStr: string,
    options: {
      category?: string;
      page?: number;
      limit?: number;
      explain?: boolean;
    } = {}
  ): Promise<SearchResponse> {
    const startTime = performance.now();

    // Ensure index is loaded
    if (!this.isIndexFresh || this.indexedPages.length === 0) {
      await this.refreshIndex();
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(50, Math.max(1, options.limit || 10));
    const parsed = this.parseQuery(queryStr, options.category);

    const totalDocs = this.indexedPages.length;
    const scoredResults: SearchResultItem[] = [];

    // Pre-calculate IDF for query terms
    const idfMap = new Map<string, number>();
    for (const term of parsed.cleanedTerms) {
      idfMap.set(term, this.calculateIdf(term, totalDocs));
    }

    // Evaluate each document
    for (const doc of this.indexedPages) {
      // 1. Check Exclusion Operator (-term)
      let isExcluded = false;
      const docTextLower = `${doc.title} ${doc.description} ${doc.contentPreview}`.toLowerCase();
      for (const exc of parsed.excludedTerms) {
        if (docTextLower.includes(exc)) {
          isExcluded = true;
          break;
        }
      }
      if (isExcluded) continue;

      // 2. Check Site Operator (site:)
      if (parsed.siteFilter) {
        const filter = parsed.siteFilter.toLowerCase();
        if (!doc.domain.toLowerCase().includes(filter) && !doc.normalizedUrl.toLowerCase().includes(filter)) {
          continue;
        }
      }

      // 3. Check inTitle Operator (intitle:)
      if (parsed.inTitleTerms.length > 0) {
        const titleLower = doc.title.toLowerCase();
        const hasAllTitle = parsed.inTitleTerms.every((t) => titleLower.includes(t));
        if (!hasAllTitle) continue;
      }

      // 4. Check inUrl Operator (inurl:)
      if (parsed.inUrlTerms.length > 0) {
        const urlLower = doc.normalizedUrl.toLowerCase();
        const hasAllUrl = parsed.inUrlTerms.every((t) => urlLower.includes(t));
        if (!hasAllUrl) continue;
      }

      // 5. Check Exact Phrase Matching ("...")
      if (parsed.exactPhrases.length > 0) {
        let hasAllPhrases = true;
        for (const phrase of parsed.exactPhrases) {
          if (!docTextLower.includes(phrase)) {
            hasAllPhrases = false;
            break;
          }
        }
        if (!hasAllPhrases) continue;
      }

      // 6. Check Category Filter if provided
      if (parsed.categoryFilter && parsed.categoryFilter !== 'All') {
        const hasCat = doc.categories?.some(
          (c) => c.toLowerCase() === parsed.categoryFilter!.toLowerCase()
        );
        if (!hasCat) continue;
      }

      // 7. Calculate BM25 Base Score and Field Boosts
      let bm25Score = 0;
      let titleBonus = 0;
      let headingBonus = 0;
      let urlBonus = 0;
      const tfBreakdown: Record<string, number> = {};

      const docLen = this.docLengths.get(doc.id) || this.avgDocLength;
      const lenNorm = 1 - this.b + this.b * (docLen / this.avgDocLength);

      const titleLower = doc.title.toLowerCase();
      const urlLower = doc.normalizedUrl.toLowerCase();
      const headingsJoined = doc.headings
        ? [...doc.headings.h1, ...doc.headings.h2, ...doc.headings.h3].join(' ').toLowerCase()
        : '';

      let matchedTermsCount = 0;

      for (const term of parsed.cleanedTerms) {
        const tf = doc.termFrequencies ? doc.termFrequencies[term] || 0 : 0;
        tfBreakdown[term] = tf;

        if (tf > 0 || titleLower.includes(term) || urlLower.includes(term)) {
          matchedTermsCount++;
        }

        const idf = idfMap.get(term) || 0.1;
        // BM25 term saturation
        const bm25Term = (tf * (this.k1 + 1)) / (tf + this.k1 * lenNorm);
        bm25Score += idf * bm25Term;

        // Title Boost (3.0x multiplier)
        if (titleLower.includes(term)) {
          titleBonus += idf * 3.0;
        }

        // Heading Boost (2.0x multiplier)
        if (headingsJoined.includes(term)) {
          headingBonus += idf * 2.0;
        }

        // URL Boost (1.8x multiplier)
        if (urlLower.includes(term)) {
          urlBonus += idf * 1.8;
        }
      }

      // Require at least one term match if terms were provided and no exact phrase matched
      if (parsed.cleanedTerms.length > 0 && matchedTermsCount === 0 && parsed.exactPhrases.length === 0) {
        continue;
      }

      // Coordination factor: reward documents matching a higher percentage of query terms
      const coordFactor = parsed.cleanedTerms.length > 0 ? (matchedTermsCount / parsed.cleanedTerms.length) : 1;
      bm25Score *= Math.pow(coordFactor, 1.2);

      // Exact Phrase Bonus
      let phraseBonus = 0;
      if (parsed.exactPhrases.length > 0) {
        phraseBonus += parsed.exactPhrases.length * 8.0;
      } else if (parsed.cleanedTerms.length >= 2) {
        const joinedQuery = parsed.cleanedTerms.join(' ');
        if (titleLower.includes(joinedQuery)) {
          phraseBonus += 5.0;
        } else if (docTextLower.includes(joinedQuery)) {
          phraseBonus += 3.0;
        }
      }

      // Freshness Bonus (logarithmic age factor)
      let freshnessBonus = 0;
      if (doc.indexedAt) {
        const ageHours = Math.max(1, (Date.now() - new Date(doc.indexedAt).getTime()) / (1000 * 3600));
        freshnessBonus = Math.max(0, 1.5 - Math.log10(ageHours) * 0.3);
      }

      // Category / Domain Match Bonus
      let categoryBonus = 0;
      if (parsed.categoryFilter && parsed.categoryFilter !== 'All') {
        categoryBonus += 2.0;
      }

      const totalScore = Number((bm25Score + titleBonus + headingBonus + urlBonus + phraseBonus + freshnessBonus + categoryBonus).toFixed(3));

      // Build context snippet highlighting matched terms
      const snippet = this.generateSnippet(doc.contentPreview || doc.description, parsed.cleanedTerms);

      scoredResults.push({
        id: doc.id,
        url: doc.url,
        normalizedUrl: doc.normalizedUrl,
        domain: doc.domain,
        title: doc.title,
        description: doc.description,
        snippet,
        canonicalUrl: doc.canonicalUrl,
        categories: doc.categories || [],
        topics: doc.topics || [],
        language: doc.language || 'en',
        publishedAt: doc.lastModified,
        indexedAt: doc.indexedAt,
        score: totalScore,
        explain: options.explain
          ? {
              termFrequency: tfBreakdown,
              bm25Base: Number(bm25Score.toFixed(3)),
              titleBonus: Number(titleBonus.toFixed(3)),
              headingBonus: Number(headingBonus.toFixed(3)),
              urlBonus: Number(urlBonus.toFixed(3)),
              phraseBonus: Number(phraseBonus.toFixed(3)),
              freshnessBonus: Number(freshnessBonus.toFixed(3)),
              categoryBonus: Number(categoryBonus.toFixed(3)),
              finalScore: totalScore,
            }
          : undefined,
      });
    }

    // Sort by deterministic total score descending
    scoredResults.sort((a, b) => b.score - a.score);

    // Apply domain diversity (prevent a single domain from capturing all top positions)
    const diversified = this.diversifyResults(scoredResults);

    const totalResults = diversified.length;
    const totalPages = Math.ceil(totalResults / limit);
    const paginated = diversified.slice((page - 1) * limit, page * limit);

    // Record query statistics asynchronously for deterministic query suggestions
    dbService.recordQuery(queryStr).catch(() => {});

    // Generate deterministic suggestions
    const suggestions = await this.generateSuggestions(queryStr);

    const availableCategories = ['All', 'Technology', 'Bangladesh', 'Government', 'Education', 'Science', 'Finance', 'Documentation', 'Reference', 'News'];

    const executionTimeMs = Number((performance.now() - startTime).toFixed(2));

    return {
      query: queryStr,
      parsedQuery: parsed,
      totalResults,
      page,
      limit,
      totalPages,
      executionTimeMs,
      results: paginated,
      suggestions,
      availableCategories,
    };
  }

  /**
   * Promotes domain diversity in top rankings (max 3 consecutive results from same domain)
   */
  private diversifyResults(results: SearchResultItem[]): SearchResultItem[] {
    if (results.length <= 4) return results;

    const out: SearchResultItem[] = [];
    const pool = [...results];
    const domainCounts: Record<string, number> = {};

    while (pool.length > 0) {
      let foundIdx = -1;

      for (let i = 0; i < pool.length; i++) {
        const item = pool[i];
        const count = domainCounts[item.domain] || 0;

        if (count < 2 || i >= 10) {
          foundIdx = i;
          break;
        }
      }

      if (foundIdx === -1) {
        foundIdx = 0; // Take next best if all top candidates exceed limit
      }

      const [selected] = pool.splice(foundIdx, 1);
      domainCounts[selected.domain] = (domainCounts[selected.domain] || 0) + 1;
      out.push(selected);
    }

    return out;
  }

  /**
   * Generates a relevant text snippet around matched query words
   */
  private generateSnippet(text: string, terms: string[]): string {
    if (!text) return '';
    if (terms.length === 0) return text.slice(0, 180) + (text.length > 180 ? '...' : '');

    const lower = text.toLowerCase();
    let bestPos = -1;

    for (const term of terms) {
      const idx = lower.indexOf(term);
      if (idx !== -1) {
        bestPos = idx;
        break;
      }
    }

    if (bestPos === -1) {
      return text.slice(0, 180) + (text.length > 180 ? '...' : '');
    }

    const start = Math.max(0, bestPos - 60);
    const end = Math.min(text.length, bestPos + 140);
    let snippet = text.slice(start, end).trim();

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }

  /**
   * Generates deterministic autocomplete suggestions
   */
  public async generateSuggestions(prefix: string): Promise<string[]> {
    const p = (prefix || '').trim().toLowerCase();
    if (!p) return [];

    const suggestions = new Set<string>();

    // 1. From previous query stats in DB
    const dbQueries = await dbService.getQuerySuggestions(p, 4);
    dbQueries.forEach((q) => suggestions.add(q));

    // 2. From page titles
    for (const page of this.indexedPages) {
      const titleLower = page.title.toLowerCase();
      if (titleLower.startsWith(p) && titleLower !== p) {
        suggestions.add(page.title.slice(0, 40));
        if (suggestions.size >= 6) break;
      }
    }

    // 3. From domains
    for (const page of this.indexedPages) {
      if (page.domain.toLowerCase().startsWith(p)) {
        suggestions.add(`site:${page.domain}`);
        if (suggestions.size >= 7) break;
      }
    }

    // 4. From vocabulary
    for (const term of this.invertedIndex.keys()) {
      if (term.startsWith(p) && term !== p && term.length > 2 && !STOPWORDS.has(term)) {
        suggestions.add(term);
        if (suggestions.size >= 8) break;
      }
    }

    return Array.from(suggestions).slice(0, 7);
  }
}

export const searchEngine = new SearchEngine();
