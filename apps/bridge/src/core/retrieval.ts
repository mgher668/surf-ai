import type { ChatMessage, MessageRole } from "@surf-ai/shared";

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const HYBRID_LEXICAL_WEIGHT = 0.68;
const HYBRID_SEMANTIC_WEIGHT = 0.32;
const LOW_CONFIDENCE_THRESHOLD = 0.45;
const SEMANTIC_RECALL_MIN = 0.08;
const MARKER_BOOST_PER_HIT = 0.2;
const MARKER_BOOST_MAX = 0.8;
const CHAR_NGRAM_SIZE = 3;
const TOP_DIRECT_LIMIT_DEFAULT = 6;
const NEIGHBOR_WINDOW_DEFAULT = 1;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "that",
  "this",
  "it",
  "as",
  "at",
  "from",
  "by",
  "was",
  "were",
  "请",
  "帮我",
  "这个",
  "那个",
  "一下",
  "一下子",
  "还是",
  "以及",
  "然后",
  "我们",
  "你",
  "我",
  "他",
  "她",
  "它"
]);

interface ScoredDoc {
  message: ChatMessage & { seq: number };
  score: number;
  lexicalScore: number;
  semanticScore: number;
}

export interface RetrievedMessage {
  seq: number;
  role: MessageRole;
  content: string;
  score: number;
  source: "direct" | "neighbor";
}

export interface RetrievalResult {
  query: string;
  queryTokens: string[];
  topScore: number;
  lowConfidence: boolean;
  expanded: boolean;
  items: RetrievedMessage[];
}

export function retrieveSessionMessages(params: {
  messages: ChatMessage[];
  query: string;
  excludeSeqs?: Set<number>;
  topDirectLimit?: number;
  neighborWindow?: number;
}): RetrievalResult {
  const query = params.query.trim();
  const queryTokens = tokenize(query);
  const docs = params.messages
    .filter((item): item is ChatMessage & { seq: number } => typeof item.seq === "number")
    .filter((item) => item.content.trim().length > 0);

  if (!query || queryTokens.length === 0 || docs.length === 0) {
    return {
      query,
      queryTokens,
      topScore: 0,
      lowConfidence: true,
      expanded: false,
      items: []
    };
  }

  const scored = scoreDocuments({
    docs,
    queryTokens,
    query
  });

  const excludeSeqs = params.excludeSeqs ?? new Set<number>();
  const topDirectLimit = params.topDirectLimit ?? TOP_DIRECT_LIMIT_DEFAULT;
  const neighborWindow = params.neighborWindow ?? NEIGHBOR_WINDOW_DEFAULT;

  const direct = scored
    .filter((item) => !excludeSeqs.has(item.message.seq))
    .slice(0, topDirectLimit);

  const topScore = direct[0]?.score ?? scored[0]?.score ?? 0;
  const lowConfidence = topScore < LOW_CONFIDENCE_THRESHOLD;

  const directItems: RetrievedMessage[] = direct.map((item) => ({
    seq: item.message.seq,
    role: item.message.role,
    content: item.message.content,
    score: Number(item.score.toFixed(4)),
    source: "direct"
  }));

  if (!lowConfidence || directItems.length === 0) {
    return {
      query,
      queryTokens,
      topScore,
      lowConfidence,
      expanded: false,
      items: directItems
    };
  }

  const bySeq = new Map<number, ChatMessage & { seq: number }>();
  for (const doc of docs) {
    bySeq.set(doc.seq, doc);
  }

  const usedSeqs = new Set<number>(directItems.map((item) => item.seq));
  const expandedItems = [...directItems];

  for (const item of directItems.slice(0, 2)) {
    for (let offset = 1; offset <= neighborWindow; offset += 1) {
      const prev = bySeq.get(item.seq - offset);
      if (prev && !excludeSeqs.has(prev.seq) && !usedSeqs.has(prev.seq)) {
        usedSeqs.add(prev.seq);
        expandedItems.push({
          seq: prev.seq,
          role: prev.role,
          content: prev.content,
          score: Math.max(0.01, item.score * 0.5),
          source: "neighbor"
        });
      }

      const next = bySeq.get(item.seq + offset);
      if (next && !excludeSeqs.has(next.seq) && !usedSeqs.has(next.seq)) {
        usedSeqs.add(next.seq);
        expandedItems.push({
          seq: next.seq,
          role: next.role,
          content: next.content,
          score: Math.max(0.01, item.score * 0.5),
          source: "neighbor"
        });
      }
    }
  }

  expandedItems.sort((a, b) => b.score - a.score || a.seq - b.seq);

  return {
    query,
    queryTokens,
    topScore,
    lowConfidence,
    expanded: true,
    items: expandedItems.slice(0, topDirectLimit + 2)
  };
}

function scoreDocuments(input: {
  docs: Array<ChatMessage & { seq: number }>;
  queryTokens: string[];
  query: string;
}): ScoredDoc[] {
  const docTerms: Array<Map<string, number>> = [];
  const docSemanticVectors: Array<Map<string, number>> = [];
  const docSemanticNorms: number[] = [];
  const docLengths: number[] = [];
  const docFreq = new Map<string, number>();
  const totalDocs = input.docs.length;
  const maxSeq = input.docs.at(-1)?.seq ?? 1;
  const markerTerms = extractMarkerTerms(input.query);
  const querySemantic = buildSemanticVector(input.query, input.queryTokens);
  const querySemanticNorm = vectorNorm(querySemantic);

  for (const doc of input.docs) {
    const terms = tokenize(doc.content);
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    docTerms.push(tf);
    docLengths.push(terms.length || 1);
    const semanticVector = buildSemanticVector(doc.content, terms);
    docSemanticVectors.push(semanticVector);
    docSemanticNorms.push(vectorNorm(semanticVector));

    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
    }
  }

  const avgdl = docLengths.reduce((sum, item) => sum + item, 0) / totalDocs;
  const scoredRaw = input.docs.map((doc, index) => {
    const tf = docTerms[index] ?? new Map<string, number>();
    const dl = docLengths[index] ?? 1;
    let bm25Score = 0;

    for (const term of input.queryTokens) {
      const termTf = tf.get(term) ?? 0;
      if (termTf === 0) {
        continue;
      }

      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const bm25 =
        (termTf * (BM25_K1 + 1)) /
        (termTf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / Math.max(1, avgdl))));
      bm25Score += idf * bm25;
    }

    const lowerContent = doc.content.toLowerCase();
    let markerBoost = 0;
    for (const marker of markerTerms) {
      if (lowerContent.includes(marker)) {
        markerBoost += MARKER_BOOST_PER_HIT;
      }
    }

    const semanticScore = cosineSimilarity(
      querySemantic,
      querySemanticNorm,
      docSemanticVectors[index] ?? new Map<string, number>(),
      docSemanticNorms[index] ?? 0
    );

    return {
      message: doc,
      bm25Score: bm25Score + Math.min(markerBoost, MARKER_BOOST_MAX),
      semanticScore
    };
  });

  const maxBm25 = scoredRaw.reduce((max, item) => Math.max(max, item.bm25Score), 0);

  const scored: ScoredDoc[] = scoredRaw.map((item) => {
    const lexicalScore = maxBm25 > 0 ? item.bm25Score / maxBm25 : 0;
    const semanticScore = item.semanticScore;

    let hybrid =
      lexicalScore * HYBRID_LEXICAL_WEIGHT +
      semanticScore * HYBRID_SEMANTIC_WEIGHT;

    if (lexicalScore === 0 && semanticScore < SEMANTIC_RECALL_MIN) {
      hybrid = 0;
    }

    hybrid *= roleWeight(item.message.role);
    hybrid *= 1 + 0.12 * (item.message.seq / Math.max(1, maxSeq));

    return {
      message: item.message,
      score: hybrid,
      lexicalScore,
      semanticScore
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.seq - a.message.seq);
}

function roleWeight(role: MessageRole): number {
  if (role === "user") return 1.15;
  if (role === "assistant") return 1.0;
  return 0.85;
}

function tokenize(text: string): string[] {
  const rawSegments = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const tokens: string[] = [];

  for (const segment of rawSegments) {
    if (!segment) {
      continue;
    }

    if (containsCjk(segment)) {
      const chars = [...segment].filter((char) => containsCjk(char));
      for (const char of chars) {
        if (!STOPWORDS.has(char)) {
          tokens.push(char);
        }
      }
      for (let i = 0; i < chars.length - 1; i += 1) {
        const bigram = `${chars[i]}${chars[i + 1]}`;
        if (!STOPWORDS.has(bigram)) {
          tokens.push(bigram);
        }
      }
      if (chars.length > 0 && chars.length <= 8) {
        const whole = chars.join("");
        if (!STOPWORDS.has(whole)) {
          tokens.push(whole);
        }
      }
      continue;
    }

    if (segment.length < 2) {
      continue;
    }
    if (!STOPWORDS.has(segment)) {
      tokens.push(segment);
    }
  }

  return tokens;
}

function buildSemanticVector(text: string, baseTokens: string[]): Map<string, number> {
  const vector = new Map<string, number>();
  const normalizedText = normalizeForSemantic(text);
  const ngrams = buildCharNgrams(normalizedText, CHAR_NGRAM_SIZE);

  for (const gram of ngrams) {
    vector.set(`g:${gram}`, (vector.get(`g:${gram}`) ?? 0) + 1);
  }

  for (const token of baseTokens) {
    vector.set(`t:${token}`, (vector.get(`t:${token}`) ?? 0) + 1);
  }

  return vector;
}

function vectorNorm(vector: Map<string, number>): number {
  let sum = 0;
  for (const value of vector.values()) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(
  left: Map<string, number>,
  leftNorm: number,
  right: Map<string, number>,
  rightNorm: number
): number {
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  let dot = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [key, value] of small.entries()) {
    dot += value * (large.get(key) ?? 0);
  }

  return dot / (leftNorm * rightNorm);
}

function normalizeForSemantic(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildCharNgrams(text: string, size: number): string[] {
  if (size <= 1 || text.length < size) {
    return text ? [text] : [];
  }

  const grams: string[] = [];
  for (let index = 0; index <= text.length - size; index += 1) {
    grams.push(text.slice(index, index + size));
  }
  return grams;
}

function extractMarkerTerms(query: string): string[] {
  const segments = query.toLowerCase().match(/[a-z0-9_-]{4,}/g) ?? [];
  return segments.filter((segment) => /\d|-|_/.test(segment) || segment.length >= 7);
}

function containsCjk(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text);
}
