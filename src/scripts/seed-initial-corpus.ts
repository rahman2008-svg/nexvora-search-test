/**
 * NexVora Seed Corpus Initializer
 * Pre-indexes foundational documents from the GitHub source registry
 * so the search engine works immediately with high-quality deterministic results.
 */
import crypto from 'crypto';
import { categorizeDocument } from '../crawler/categorizer.ts';
import { tokenizeText } from '../crawler/parser.ts';
import { dbService } from '../database/db.ts';
import { IndexedPageRecord } from '../database/schema.ts';
import { searchEngine } from '../indexer/search-engine.ts';
import { normalizeUrl } from '../lib/url-normalizer.ts';

interface SeedDocDef {
  url: string;
  title: string;
  description: string;
  h1: string[];
  h2: string[];
  h3: string[];
  body: string;
  sourceCategory: string;
}

const SEED_DOCS: SeedDocDef[] = [
  // 1. Bangladesh Government
  {
    url: 'https://bangladesh.gov.bd/',
    title: 'Bangladesh National Portal | People\'s Republic of Bangladesh',
    description: 'The single digital entry point for all citizens and global visitors to the Government of Bangladesh ministries, public citizen services, and official information.',
    h1: ['Bangladesh National Portal'],
    h2: ['Citizens Digital Services', 'Government Ministries & Departments', 'Divisions and District Portals'],
    h3: ['Dhaka, Chittagong, Sylhet, Rajshahi, Khulna administrative hubs'],
    body: 'The National Web Portal of Bangladesh is an integrated government website offering digital services, e-services, passport, birth registration, tax submission, national id card nid, and official gazette notifications across Dhaka and all districts.',
    sourceCategory: 'Bangladesh',
  },
  {
    url: 'https://pmo.gov.bd/',
    title: 'Prime Minister\'s Office | Government of the People\'s Republic of Bangladesh',
    description: 'Official portal of the Prime Minister\'s Office of Bangladesh. Policy directives, executive orders, governance initiatives, and citizen welfare programs.',
    h1: ['Prime Minister\'s Office Bangladesh'],
    h2: ['Executive Governance Directives', 'Vision and National Development Initiatives', 'Press Releases and Public Speeches'],
    h3: ['Dhaka Secretariat and PMO Administration'],
    body: 'The Prime Minister\'s Office PMO serves as the central executive coordinator of government policy, national projects, economic corridors, development vision, public administration, and inter-ministerial coordination in Bangladesh.',
    sourceCategory: 'Bangladesh',
  },
  {
    url: 'https://ictd.gov.bd/',
    title: 'Information and Communication Technology Division | Bangladesh ICT Ministry',
    description: 'ICT Division Bangladesh is responsible for building digital infrastructure, software industry growth, cyber security, startup ecosystems, and broadband expansion.',
    h1: ['ICT Division - Government of Bangladesh'],
    h2: ['Digital Bangladesh Initiatives', 'Hi-Tech Parks and IT Hubs', 'Cyber Security Policy & Training'],
    h3: ['Software exports, innovation labs, and digital connectivity in Dhaka'],
    body: 'The Information and Communication Technology Division fosters IT innovation, computer software programming, artificial intelligence research policies, freelance developers, hi-tech parks in Kaliakair and regional software technology parks.',
    sourceCategory: 'Bangladesh',
  },
  {
    url: 'https://www.du.ac.bd/',
    title: 'University of Dhaka | The Premier University of Bangladesh',
    description: 'University of Dhaka (DU), founded in 1921, is the oldest and leading public research university in Bangladesh, known as the Oxford of the East.',
    h1: ['University of Dhaka'],
    h2: ['Academic Faculties and Research Institutes', 'Admissions, Curriculums, and Degrees', 'Dhaka University Library and Historic Campus'],
    h3: ['Faculty of Science, Arts, Business Studies, and Law'],
    body: 'Dhaka University DU comprises numerous faculties, research institutes, central library, higher degree programs in physics, chemistry, mathematics, economics, literature, and computer science located in central Dhaka.',
    sourceCategory: 'Bangladesh',
  },
  {
    url: 'https://www.buet.ac.bd/',
    title: 'Bangladesh University of Engineering and Technology (BUET)',
    description: 'BUET is the topmost engineering institution and university in Bangladesh specializing in engineering, architecture, urban planning, computer science, and technical innovation.',
    h1: ['Bangladesh University of Engineering and Technology'],
    h2: ['Department of Computer Science and Engineering (CSE)', 'Civil, Mechanical, and Electrical Engineering', 'Research and Development'],
    h3: ['Postgraduate degrees, engineering innovations, and academic excellence in Dhaka'],
    body: 'BUET is recognized globally for its engineering curriculum, competitive entrance exams, computer science CSE graduates, robotics labs, structural engineering research, and software engineering competitions.',
    sourceCategory: 'Bangladesh',
  },

  // 2. Technology & Programming
  {
    url: 'https://www.python.org/',
    title: 'Welcome to Python.org | Python Programming Language',
    description: 'Python is a high-level programming language that lets you work quickly and integrate systems more effectively. Open source, clear syntax, powerful libraries.',
    h1: ['Python Programming Language'],
    h2: ['Download Python Releases', 'Documentation and Tutorials', 'Python Package Index (PyPI)'],
    h3: ['Data science, web development, scripting, and system automation'],
    body: 'Python is an interpreted, interactive, object-oriented programming language. It incorporates modules, exceptions, dynamic typing, very high level dynamic data types, and classes. It supports multiple programming paradigms.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://docs.python.org/3/',
    title: 'Python 3 Documentation | Official Python Guides and Reference',
    description: 'Comprehensive Python 3 documentation including the Python Tutorial, Library Reference, Language Reference, and Global Module Index.',
    h1: ['Python 3 Documentation'],
    h2: ['The Python Tutorial', 'Python Standard Library Reference', 'Language Syntax Specification'],
    h3: ['Built-in functions, data structures, asyncio, and object-oriented programming'],
    body: 'Official Python 3 documentation contains tutorials for beginners, standard library documentation, language reference manual, installing python modules, distributing python modules with setuptools and pip.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://www.typescriptlang.org/',
    title: 'TypeScript: JavaScript With Syntax For Types',
    description: 'TypeScript is a strongly typed programming language that builds on JavaScript, giving you better tooling at any scale. Developed by Microsoft.',
    h1: ['TypeScript: JavaScript With Syntax For Types'],
    h2: ['Type Safety and Static Checking', 'TypeScript Handbook and Documentation', 'Compiler Options (tsconfig.json)'],
    h3: ['Interfaces, Generics, Union Types, and Modern ECMAScript support'],
    body: 'TypeScript adds optional types to JavaScript that support tools for large-scale JavaScript applications. It compiles to clean, readable JavaScript code which runs on any browser or Node.js runtime.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://nodejs.org/',
    title: 'Node.js — Run JavaScript Everywhere',
    description: 'Node.js is an open-source, cross-platform JavaScript runtime environment that executes JavaScript code outside a web browser, built on Chrome\'s V8 engine.',
    h1: ['Node.js JavaScript Runtime'],
    h2: ['Asynchronous Event-Driven Architecture', 'npm - Node Package Manager', 'Building Fast Scalable Network Applications'],
    h3: ['HTTP servers, streams, buffer, file system, and worker threads'],
    body: 'As an asynchronous event-driven JavaScript runtime, Node.js is designed to build scalable network applications. Node.js uses an event-driven, non-blocking I/O model that makes it lightweight and efficient.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://www.rust-lang.org/',
    title: 'Rust Programming Language | Fast, Reliable, Memory-Safe',
    description: 'A language empowering everyone to build reliable and efficient software. Performance, reliability, memory safety without garbage collection.',
    h1: ['Rust Programming Language'],
    h2: ['Memory Safety and Ownership Model', 'Zero-Cost Abstractions', 'Cargo Package Manager & Crates.io'],
    h3: ['Systems programming, WebAssembly, CLI tools, and network services'],
    body: 'Rust is blazingly fast and memory-efficient: with no runtime or garbage collector, it can power performance-critical services, run on embedded devices, and easily integrate with other languages.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://go.dev/',
    title: 'The Go Programming Language | Simple, Fast, Open Source',
    description: 'Go is an open-source programming language supported by Google that makes it easy to build simple, reliable, and efficient software with built-in concurrency.',
    h1: ['Build Simple, Secure, Scalable Systems with Go'],
    h2: ['Goroutines and Concurrency Channels', 'Standard Library and Tooling', 'Go Modules and Cloud Microservices'],
    h3: ['Fast compilation, garbage collection, and systems programming'],
    body: 'Go makes it easy to build simple, reliable, and highly scalable software. With native concurrency support through goroutines and channels, Go powers major cloud infrastructure such as Docker and Kubernetes.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://developer.mozilla.org/en-US/',
    title: 'MDN Web Docs | Resources for Developers, by Developers',
    description: 'The MDN Web Docs site provides information about open Web technologies including HTML, CSS, JavaScript, and Web APIs for websites and progressive web apps.',
    h1: ['MDN Web Docs'],
    h2: ['HTML: Structuring the Web', 'CSS: Styling the Web', 'JavaScript: Dynamic Client-Side Scripting'],
    h3: ['Web APIs, DOM manipulation, HTTP protocols, and WebAssembly documentation'],
    body: 'MDN Web Docs is an evolving learning platform for Web technologies and the software that powers the Web, documenting standard HTML elements, CSS stylesheets, JavaScript specifications, and browser compatibility matrices.',
    sourceCategory: 'Technology',
  },

  // 3. Databases & Systems
  {
    url: 'https://www.postgresql.org/',
    title: 'PostgreSQL: The World\'s Most Advanced Open Source Relational Database',
    description: 'PostgreSQL is a powerful, open source object-relational database system with over 35 years of active development that has earned it a strong reputation for reliability.',
    h1: ['PostgreSQL Relational Database System'],
    h2: ['ACID Compliance and Transactions', 'JSONB, Full-Text Search, and Indexes', 'Replication and High Availability'],
    h3: ['SQL queries, foreign keys, triggers, and partitioning'],
    body: 'PostgreSQL comes with many features aimed to help developers build applications, administrators to protect data integrity, and build fault-tolerant environments. It supports SQL standard, JSON queries, and high concurrency.',
    sourceCategory: 'Technology',
  },
  {
    url: 'https://sqlite.org/',
    title: 'SQLite Home Page | Small, Fast, Reliable SQL Database Engine',
    description: 'SQLite is a C-language library that implements a small, fast, self-contained, high-reliability, full-featured, SQL database engine.',
    h1: ['SQLite Database Engine'],
    h2: ['Serverless and Zero-Configuration', 'Single-File Database Storage', 'Public Domain and Highly Tested'],
    h3: ['Embedded applications, mobile apps, and lightweight systems'],
    body: 'SQLite is the most used database engine in the world. SQLite is built into all mobile phones and most computers and comes bundled inside countless other applications that people use every day.',
    sourceCategory: 'Technology',
  },

  // 4. Science & Academic
  {
    url: 'https://arxiv.org/',
    title: 'arXiv.org e-Print Archive | Open Access Research Papers',
    description: 'arXiv is a free distribution service and an open-access archive for nearly 2.4 million scholarly articles in physics, mathematics, computer science, and statistics.',
    h1: ['arXiv Scientific Research Repository'],
    h2: ['Computer Science and Information Theory', 'Quantum Physics, Astrophysics, and Mathematics', 'Quantitative Biology and Economics'],
    h3: ['Peer scientific preprints, open access publications, and research discovery'],
    body: 'arXiv provides open access to scientific preprints in physics, mathematics, computer science, quantitative biology, quantitative finance, statistics, electrical engineering, and systems science.',
    sourceCategory: 'Science',
  },
  {
    url: 'https://www.nature.com/',
    title: 'Nature | International Journal of Science',
    description: 'Nature is the world\'s leading multidisciplinary science journal, publishing peer-reviewed research in all fields of science and technology.',
    h1: ['Nature: International Journal of Science'],
    h2: ['Leading Peer-Reviewed Research', 'Scientific Discoveries and Editorials', 'Biological, Physical, and Earth Sciences'],
    h3: ['Scientific breakthroughs, climate studies, and genomic research'],
    body: 'Nature is a weekly international journal publishing the finest peer-reviewed research in all fields of science and technology on the basis of its originality, importance, interdisciplinary interest, and surprising conclusions.',
    sourceCategory: 'Science',
  },
  {
    url: 'https://nasa.gov/',
    title: 'National Aeronautics and Space Administration (NASA)',
    description: 'Pioneering the future in space exploration, scientific discovery, aeronautics research, Earth science, and Artemis lunar missions.',
    h1: ['NASA: Exploring the Universe and Our Home Planet'],
    h2: ['James Webb Space Telescope & Astronomy', 'Artemis Moon and Mars Exploration', 'Earth Observation and Climate Science'],
    h3: ['Planetary science, astrophysics, space stations, and rocketry'],
    body: 'NASA explores the unknown in air and space, innovates for the benefit of humanity, and inspires the world through discovery. Features telescope imagery, planetary rover data, and space exploration mission logs.',
    sourceCategory: 'Science',
  },

  // 5. Education
  {
    url: 'https://ocw.mit.edu/',
    title: 'MIT OpenCourseWare | Free Online Course Materials',
    description: 'MIT OpenCourseWare is a web-based publication of virtually all MIT course content. OCW is open and available to the world and is a permanent MIT activity.',
    h1: ['MIT OpenCourseWare'],
    h2: ['Computer Science and Electrical Engineering Courses', 'Calculus, Linear Algebra, and Physics Lectures', 'Free Syllabus, Assignments, and Video Lectures'],
    h3: ['Global education access from Massachusetts Institute of Technology'],
    body: 'Explore materials from thousands of MIT courses, covering the entire MIT curriculum, from introductory to the most advanced graduate courses in mathematics, engineering, algorithms, and biology.',
    sourceCategory: 'Education',
  },
  {
    url: 'https://www.khanacademy.org/',
    title: 'Khan Academy | Free Online Courses, Lessons & Practice',
    description: 'Learn for free about math, art, computer programming, economics, physics, chemistry, biology, medicine, finance, history, and more.',
    h1: ['A Free, World-Class Education for Anyone, Anywhere'],
    h2: ['Math from Early Math to Calculus', 'Science, Computing, and Engineering', 'Economics and Personal Finance'],
    h3: ['Interactive practice exercises and instructional videos'],
    body: 'Khan Academy offers practice exercises, instructional videos, and a personalized learning dashboard that empower learners to study at their own pace in and outside of the classroom.',
    sourceCategory: 'Education',
  },

  // 6. Finance & Economics
  {
    url: 'https://www.imf.org/',
    title: 'International Monetary Fund (IMF)',
    description: 'The IMF works to foster global monetary cooperation, secure financial stability, facilitate international trade, promote high employment and sustainable economic growth.',
    h1: ['International Monetary Fund'],
    h2: ['World Economic Outlook & Global Growth Forecasts', 'Monetary Policy, Inflation, and Fiscal Stability', 'Financial Assistance and Economic Surveillance'],
    h3: ['Exchange rates, central banking, sovereign debt, and macroeconomic research'],
    body: 'The International Monetary Fund (IMF) works to achieve sustainable growth and prosperity for all of its 190 member countries by supporting economic policies that promote financial stability and monetary cooperation.',
    sourceCategory: 'Finance',
  },
  {
    url: 'https://www.bb.org.bd/',
    title: 'Bangladesh Bank | The Central Bank of Bangladesh',
    description: 'Official website of Bangladesh Bank, the central bank of Bangladesh. Monetary policy, foreign exchange reserve, banking regulation, inflation control, and financial stability.',
    h1: ['Bangladesh Bank - Central Bank of Bangladesh'],
    h2: ['Monetary Policy Statement & Policy Rates', 'Foreign Exchange Reserves & Exchange Rates', 'Banking Sector Regulations & Financial Inclusion in Dhaka'],
    h3: ['Treasury bonds, commercial bank supervision, and currency circulation'],
    body: 'Bangladesh Bank acts as the central bank and monetary authority of the People\'s Republic of Bangladesh. It manages money supply, credit conditions, interbank payments, and banking regulation in Dhaka.',
    sourceCategory: 'Finance',
  },

  // 7. Reference & Standards
  {
    url: 'https://en.wikipedia.org/',
    title: 'Wikipedia, the Free Encyclopedia',
    description: 'Wikipedia is a free online encyclopedia, created and edited by volunteers around the world and hosted by the Wikimedia Foundation.',
    h1: ['Wikipedia, the Free Encyclopedia'],
    h2: ['Featured Articles and Reference Entries', 'History, Science, Arts, Geography, and Biography', 'Open Knowledge and Collaborative Citation'],
    h3: ['Multilingual encyclopedia entries with peer citations'],
    body: 'Wikipedia contains millions of free encyclopedia articles created through collaborative editing. It covers history, mathematics, scientific discoveries, world literature, computing, and international geopolitics.',
    sourceCategory: 'Reference',
  },
  {
    url: 'https://www.w3.org/standards/',
    title: 'W3C Standards | World Wide Web Consortium',
    description: 'W3C standards define the open Web platform for application development, including HTML, CSS, SVG, WebRTC, and Accessibility Guidelines (WCAG).',
    h1: ['World Wide Web Consortium (W3C) Standards'],
    h2: ['Web Architecture, HTML & DOM Standards', 'CSS Stylesheets & Web Fonts', 'Web Accessibility Initiative (WCAG)'],
    h3: ['Open web protocols, internet governance, and interoperability'],
    body: 'The World Wide Web Consortium W3C develops open standards to ensure the long-term growth of the Web. W3C standards specify the building blocks of the web platform from markup to accessibility.',
    sourceCategory: 'Reference',
  },
];

export async function seedInitialCorpus(): Promise<number> {
  console.log('[SeedCorpus] Pre-populating high-quality initial indexed corpus...');
  await dbService.initialize();

  let count = 0;

  for (const doc of SEED_DOCS) {
    const norm = normalizeUrl(doc.url);
    if (!norm.isValid) continue;

    const headingsJoined = [...doc.h1, ...doc.h2, ...doc.h3].join(' ');
    const allText = `${doc.title} ${headingsJoined} ${doc.description} ${doc.body}`;
    const tokens = tokenizeText(allText);

    const termFrequencies: Record<string, number> = {};
    for (const t of tokens) {
      termFrequencies[t] = (termFrequencies[t] || 0) + 1;
    }

    const catResult = categorizeDocument(
      norm.normalizedUrl,
      norm.domain,
      doc.title,
      headingsJoined,
      doc.body,
      doc.sourceCategory
    );

    const contentHash = crypto.createHash('sha256').update(doc.body).digest('hex');

    const indexedRecord: IndexedPageRecord = {
      id: crypto.createHash('md5').update(norm.normalizedUrl).digest('hex'),
      url: doc.url,
      normalizedUrl: norm.normalizedUrl,
      domain: norm.domain,
      title: doc.title,
      description: doc.description,
      canonicalUrl: norm.normalizedUrl,
      headings: {
        h1: doc.h1,
        h2: doc.h2,
        h3: doc.h3,
      },
      contentPreview: doc.body.slice(0, 320),
      tokens,
      termFrequencies,
      docLength: tokens.length,
      language: 'en',
      categories: catResult.categories,
      topics: catResult.topics,
      contentHash,
      indexedAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
    };

    await dbService.saveIndexedPage(indexedRecord);
    count++;
  }

  await searchEngine.refreshIndex();
  console.log(`[SeedCorpus] Seeded ${count} high-quality reference documents into persistent index.`);
  return count;
}

// Run if called directly
if (process.argv[1]?.endsWith('seed-initial-corpus.ts')) {
  seedInitialCorpus()
    .then((c) => {
      console.log(`Successfully completed seeding ${c} documents.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed error:', err);
      process.exit(1);
    });
}
