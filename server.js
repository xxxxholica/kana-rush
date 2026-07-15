import { serveDir } from "jsr:@std/http/file-server";
import { generateBotTurn, pickRandomSeed } from "./wordBank.js";

// 初期語の候補(「ん」で終わらない、ひらがなのみ、2文字以上)
const initialWordPool = [
  "しりとり", "りんご", "ごりら", "らくだ", "うさぎ",
  "ねこ", "いぬ", "さかな", "とけい",
];

function pickRandomInitialWord() {
  const index = Math.floor(Math.random() * initialWordPool.length);
  return initialWordPool[index];
}

// 練習モードの単語履歴をブラウザ(Cookieのセッションid)ごとに保持する。
// 同一デバイスでも別ブラウザ/シークレットウィンドウなら別セッションとして分離される
// (同一ブラウザの複数タブは同じCookieを共有するため、その間では引き続き履歴を共有する)。
// エントリは lastAccess を持ち、一定時間操作がなければ自動的に破棄する(メモリが増え続けないように)。
// Mapは挿入順を保持するため、アクセス時に delete→set で末尾に移動させれば
// 「先頭 = 最も長くアクセスされていないセッション」というLRU順を保てる。
const practiceSessions = new Map();
const SESSION_COOKIE_NAME = "sid";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6時間操作がなければセッションを破棄する
const SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000; // 30分おきに期限切れセッションを掃除する
// Cookie無し連打によるMapの無制限肥大化(メモリ枯渇)を防ぐための総数上限。
// 超過時は最も古いセッションから破棄する
const MAX_PRACTICE_SESSIONS = 5000;

function getSessionIdFromCookie(req) {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`),
  );
  return match ? match[1] : null;
}

function buildSessionCookie(sessionId) {
  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

// 上限に達している場合、最も古い(最終アクセスが最も昔の)セッションから破棄する
function evictOldestSessionsIfFull() {
  while (practiceSessions.size >= MAX_PRACTICE_SESSIONS) {
    const oldestKey = practiceSessions.keys().next().value;
    practiceSessions.delete(oldestKey);
  }
}

// セッションを(新規作成/上書きどちらも)Mapの末尾(最新)に登録する。
// 新規作成時のみ上限チェックを行う(上書きは既存の枠を使い回すだけなので不要)
function putSession(sessionId, history) {
  if (practiceSessions.has(sessionId)) {
    practiceSessions.delete(sessionId);
  } else {
    evictOldestSessionsIfFull();
  }
  const session = { history, lastAccess: Date.now() };
  practiceSessions.set(sessionId, session);
  return session;
}

function createSession(sessionId) {
  return putSession(sessionId, [pickRandomInitialWord()]);
}

// Cookieのセッションidを解決する(未発行・不明な場合は新規発行するが、履歴はまだ作らない)
function resolveSessionId(req) {
  const existing = getSessionIdFromCookie(req);
  if (existing && practiceSessions.has(existing)) {
    const session = practiceSessions.get(existing);
    session.lastAccess = Date.now();
    // アクセスされたセッションをMapの末尾に移動し、LRU順を維持する
    practiceSessions.delete(existing);
    practiceSessions.set(existing, session);
    return { sessionId: existing, isNew: false };
  }
  return { sessionId: crypto.randomUUID(), isNew: true };
}

// リクエストからセッションの単語履歴を取得する。存在しなければ新規セッションを作成する
function getOrCreateSession(req) {
  const { sessionId, isNew } = resolveSessionId(req);
  const session = isNew ? createSession(sessionId) : practiceSessions.get(sessionId);
  return { sessionId, isNew, history: session.history };
}

// 一定時間操作のないセッションを破棄する(サーバーを動かし続けてもメモリが増え続けないようにするため)
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of practiceSessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      practiceSessions.delete(sessionId);
    }
  }
}

setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL_MS);

// ひらがな・カタカナ(ー含む)のみで構成されているか判定
function isKanaOnly(word) {
  return /^[ぁ-んァ-ヶー]+$/.test(word);
}

// カタカナをひらがなに変換する(入力の正規化・Jisho照合の両方で使用)
function toHiragana(str) {
  return str.replace(
    /[\u30a1-\u30f6]/g,
    (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

// \u62d7\u97f3(\u5c0f\u3055\u3044\u6587\u5b57)\u306f\u5358\u72ec\u3067\u5358\u8a9e\u306e\u5148\u982d\u306b\u306a\u308c\u306a\u3044\u305f\u3081\u3001\u5927\u6587\u5b57\u306b\u5909\u63db\u3057\u3066\u7d99\u7d9a\u5224\u5b9a\u3059\u308b
// (\u4f8b: \u300c\u30de\u30ea\u30a2\u30fc\u30b8\u30e5\u300d\u306f\u672b\u5c3e\u306e\u300c\u3085\u300d\u3067\u306f\u306a\u304f\u300c\u3086\u300d\u3067\u7d99\u7d9a\u3059\u308b\u3002\u300c\u3086\u304d\u300d\u7b49\u304c\u7d9a\u3051\u3089\u308c\u308b)
const SMALL_KANA_MAP = {
  \u3041: "\u3042", \u3043: "\u3044", \u3045: "\u3046", \u3047: "\u3048", \u3049: "\u304a",
  \u3083: "\u3084", \u3085: "\u3086", \u3087: "\u3088", \u3063: "\u3064", \u308e: "\u308f",
};

// \u3057\u308a\u3068\u308a\u306e\u63a5\u7d9a\u5224\u5b9a\u306b\u4f7f\u3046\u300c\u5b9f\u8cea\u7684\u306a\u672b\u5c3e\u306e\u6587\u5b57\u300d\u3092\u6c42\u3081\u308b\u3002
// \u300c\u30fc\u300d\u3067\u7d42\u308f\u308b\u5834\u5408\u306f\u3001\u4f38\u3070\u3057\u3066\u3044\u308b\u76f4\u524d\u306e\u6587\u5b57\u3092\u305d\u306e\u307e\u307e\u7d99\u7d9a\u306e\u57fa\u6e96\u306b\u3059\u308b
// (\u4f8b: \u300c\u30d0\u30a4\u30ca\u30ea\u30fc\u300d\u306f\u76f4\u524d\u306e\u300c\u308a\u300d\u3067\u7d99\u7d9a\u3059\u308b\u3002\u300c\u30ea\u30a2\u30eb\u300d\u7b49\u304c\u7d9a\u3051\u3089\u308c\u308b)
function effectiveLastChar(word) {
  let last = word.slice(-1);
  if (last === "\u30fc" && word.length >= 2) {
    // \u300c\u30fc\u300d\u306e\u76f4\u524d\u304c\u62d7\u97f3(\u4f8b:\u300c\u30d6\u30e9\u30b8\u30e3\u30fc\u300d\u306e\u300c\u3083\u300d)\u306e\u5834\u5408\u3082\u3042\u308b\u305f\u3081\u3001
    // \u76f4\u524d\u306e\u6587\u5b57\u3092\u53d6\u308a\u51fa\u3057\u305f\u5f8c\u3067\u3042\u3089\u305f\u3081\u3066\u5927\u6587\u5b57\u5316\u306e\u5224\u5b9a\u306b\u304b\u3051\u308b
    last = word[word.length - 2];
  }
  return SMALL_KANA_MAP[last] ?? last;
}

// Jisho.org の公式APIを使って実在する単語か確認する
async function isRealWord(word) {
  const url =
    `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      // APIエラー時は判定をスキップして許可する(フェイルセーフ)
      return true;
    }
    const json = await response.json();
    return json.data.some((entry) =>
      entry.japanese.some((j) => j.reading && toHiragana(j.reading) === word)
    );
  } catch {
    // ネットワークエラー時も判定をスキップして許可する
    return true;
  }
}

// Jisho.org で表記(漢字混じり等)から読み(ひらがな)を引く。Macの自動変換で
// 漢字入力になった場合でも遊べるようにするための変換。
async function lookupReading(rawWord) {
  const url =
    `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(rawWord)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { ok: false, networkError: true };
    const json = await response.json();
    for (const entry of json.data) {
      for (const j of entry.japanese) {
        if (j.word === rawWord && j.reading) {
          return { ok: true, reading: toHiragana(j.reading) };
        }
      }
    }
    return { ok: false, networkError: false };
  } catch {
    return { ok: false, networkError: true };
  }
}

// 入力(ひらがな・カタカナ・漢字混じり)を判定し、ひらがなの単語に正規化する。
// かな入力ならそのまま実在チェック、漢字混じりならJishoで読みを引いて変換する。
async function resolveWord(rawWord) {
  if (isKanaOnly(rawWord)) {
    if (rawWord.length < 2) {
      return { ok: false, errorMessage: "1文字の単語は使用できません", errorCode: "10006" };
    }
    const word = toHiragana(rawWord);
    if (!(await isRealWord(word))) {
      return {
        ok: false,
        errorMessage: "実在しない単語の可能性があります",
        errorCode: "10005",
      };
    }
    return { ok: true, word };
  }

  const looked = await lookupReading(rawWord);
  if (!looked.ok) {
    if (looked.networkError) {
      return {
        ok: false,
        errorMessage: "読み方を確認できませんでした。ひらがな・カタカナで入力してください",
        errorCode: "10010",
      };
    }
    return {
      ok: false,
      errorMessage: "実在しない単語の可能性があります",
      errorCode: "10005",
    };
  }
  if (looked.reading.length < 2) {
    return { ok: false, errorMessage: "1文字の単語は使用できません", errorCode: "10006" };
  }
  return { ok: true, word: looked.reading };
}

function makeErrorResponse(errorMessage, errorCode, extra = {}, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(
    JSON.stringify({ errorMessage, errorCode, ...extra }),
    { status: 400, headers },
  );
}

function makeSuccessResponse(history, setCookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return new Response(
    JSON.stringify({
      word: history[history.length - 1],
      wordHistories: history,
    }),
    { headers },
  );
}

function makeJsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// バトルモード用: 単語1つの妥当性を判定する(グローバル履歴は使わずステートレスに判定)
async function validateBattleWord(previousWord, rawWord, exclude) {
  if (!rawWord) {
    return { ok: false, errorMessage: "単語を入力してください", errorCode: "10007" };
  }

  const resolved = await resolveWord(rawWord);
  if (!resolved.ok) return resolved;
  const word = resolved.word;

  if (effectiveLastChar(previousWord) !== word.slice(0, 1)) {
    return { ok: false, errorMessage: "前の単語に続いていません", errorCode: "10001" };
  }
  if (exclude.includes(word)) {
    return {
      ok: false,
      errorMessage: "この対戦で既に使われた単語です",
      errorCode: "10008",
    };
  }

  // 「ん」で終わる単語は正当な一手として受理するが、以降続けられないため
  // 呼び出し側(バトルモード)でそのターンを即座に終了させる
  return { ok: true, word, length: word.length, endsInN: word.slice(-1) === "ん" };
}

// IPごとの簡易レート制限(固定ウィンドウ方式)。
// nginxの背後で動く前提のため、実クライアントIPは X-Real-IP ヘッダーから取得する
// (直接インターネットに公開する場合は info.remoteAddr にフォールバックする)。
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60; // 1IPあたり1分間に60リクエストまで
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const rateLimitBuckets = new Map();

function getClientIp(req, info) {
  return req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    info?.remoteAddr?.hostname ??
    "unknown";
}

// 今回のリクエストがレート制限を超えているか判定し、そのIPのカウンタを更新する
function isRateLimited(ip) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(ip, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

// ウィンドウが過ぎたIPのカウンタを掃除する(IPごとにエントリが残り続けないように)
function cleanupExpiredRateLimitBuckets() {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(ip);
    }
  }
}

setInterval(cleanupExpiredRateLimitBuckets, RATE_LIMIT_CLEANUP_INTERVAL_MS);

Deno.serve(async (_req, _info) => {
  const pathname = new URL(_req.url).pathname;

  // 静的ファイル配信もAPIも一律でレート制限の対象にする
  const clientIp = getClientIp(_req, _info);
  if (isRateLimited(clientIp)) {
    return new Response(
      JSON.stringify({ errorMessage: "リクエストが多すぎます。しばらく待ってから再度お試しください", errorCode: "10011" }),
      { status: 429, headers: { "Content-Type": "application/json; charset=utf-8" } },
    );
  }

  // GET /shiritori: 直前の単語と履歴を返す(ブラウザごとにCookieのセッションで分離)
  if (_req.method === "GET" && pathname === "/shiritori") {
    const { history, isNew, sessionId } = getOrCreateSession(_req);
    const setCookie = isNew ? buildSessionCookie(sessionId) : undefined;
    return makeSuccessResponse(history, setCookie);
  }

  // POST /shiritori: 次の単語を受け取って判定・更新する
  if (_req.method === "POST" && pathname === "/shiritori") {
    const requestJson = await _req.json();
    const rawNextWord = requestJson["nextWord"];
    const { history, isNew, sessionId } = getOrCreateSession(_req);
    const setCookie = isNew ? buildSessionCookie(sessionId) : undefined;
    const previousWord = history[history.length - 1];

    // 空文字チェック
    if (!rawNextWord) {
      return makeErrorResponse("単語を入力してください", "10007", {}, setCookie);
    }

    // ひらがな・カタカナはそのまま、漢字混じりはJishoで読みを引いてひらがなに正規化する
    const resolved = await resolveWord(rawNextWord);
    if (!resolved.ok) {
      return makeErrorResponse(resolved.errorMessage, resolved.errorCode, {}, setCookie);
    }
    const nextWord = resolved.word;

    // previousWordの末尾とnextWordの先頭が同一か確認(「ー」で終わる場合は直前の母音で継続する)
    if (effectiveLastChar(previousWord) !== nextWord.slice(0, 1)) {
      return makeErrorResponse("前の単語に続いていません", "10001", {}, setCookie);
    }

    // 過去に使用した単語かチェック
    if (history.includes(nextWord)) {
      history.push(nextWord);
      return makeErrorResponse(
        "過去に使用した単語です。ゲーム終了です",
        "10002",
        { wordHistories: history },
        setCookie,
      );
    }

    // 末尾が「ん」で終わる場合
    if (nextWord.slice(-1) === "ん") {
      history.push(nextWord);
      return makeErrorResponse(
        "「ん」で終わりました。ゲーム終了です",
        "10003",
        { wordHistories: history },
        setCookie,
      );
    }

    // 正常な単語なら履歴に追加
    history.push(nextWord);
    return makeSuccessResponse(history, setCookie);
  }

  // POST /reset: 履歴を初期化する(初期語はランダムに選び直す)
  if (_req.method === "POST" && pathname === "/reset") {
    const { sessionId, isNew } = resolveSessionId(_req);
    const session = putSession(sessionId, [pickRandomInitialWord()]);
    const setCookie = isNew ? buildSessionCookie(sessionId) : undefined;
    return makeSuccessResponse(session.history, setCookie);
  }

  // GET /battle/random-word: ラウンドの起点となる単語をランダムに返す(バトルモード用、ステートレス)
  if (_req.method === "GET" && pathname === "/battle/random-word") {
    const exclude = (new URL(_req.url).searchParams.get("exclude") ?? "")
      .split(",")
      .filter(Boolean);
    const word = pickRandomSeed(exclude);
    if (!word) {
      return makeErrorResponse("選べる単語がありません", "10009");
    }
    return makeJsonResponse({ word });
  }

  // POST /battle/validate-word: バトルモードの単語1つを判定する(グローバル履歴には影響しない)
  if (_req.method === "POST" && pathname === "/battle/validate-word") {
    const requestJson = await _req.json();
    const previousWord = requestJson["previousWord"];
    const rawWord = requestJson["word"];
    const exclude = requestJson["exclude"] ?? [];

    const result = await validateBattleWord(previousWord, rawWord, exclude);
    if (!result.ok) {
      return makeErrorResponse(result.errorMessage, result.errorCode);
    }
    return makeJsonResponse({
      word: result.word,
      length: result.length,
      endsInN: result.endsInN,
    });
  }

  // GET /battle/bot-turn: CPUの1ターン分(複数語のチェーン)をまとめて生成する
  if (_req.method === "GET" && pathname === "/battle/bot-turn") {
    const searchParams = new URL(_req.url).searchParams;
    const previousWord = searchParams.get("previousWord") ?? "";
    const exclude = (searchParams.get("exclude") ?? "")
      .split(",")
      .filter(Boolean);
    const result = generateBotTurn(previousWord, exclude);
    return makeJsonResponse(result);
  }

  // ./public以下のファイルを公開(同一オリジンからのみアクセスする前提のためCORSは有効化しない)
  return serveDir(_req, {
    fsRoot: "./public/",
    urlRoot: "",
  });
});