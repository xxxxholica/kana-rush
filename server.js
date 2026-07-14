import { serveDir } from "jsr:@std/http/file-server";

// 初期語の候補(「ん」で終わらない、ひらがなのみ、2文字以上)
const initialWordPool = [
  "しりとり", "りんご", "ごりら", "らくだ", "うさぎ",
  "ねこ", "いぬ", "さかな", "とけい",
];

function pickRandomInitialWord() {
  const index = Math.floor(Math.random() * initialWordPool.length);
  return initialWordPool[index];
}

// 単語の履歴を保持(末尾が現在の直前語)
let wordHistories = [pickRandomInitialWord()];

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

// Jisho.org の公式APIを使って実在する単語か確認する
async function isRealWord(word) {
  const url =
    `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`;
  try {
    const response = await fetch(url);
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

function makeErrorResponse(errorMessage, errorCode, extra = {}) {
  return new Response(
    JSON.stringify({ errorMessage, errorCode, ...extra }),
    {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    },
  );
}

function makeSuccessResponse() {
  return new Response(
    JSON.stringify({
      word: wordHistories[wordHistories.length - 1],
      wordHistories,
    }),
    { headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

Deno.serve(async (_req) => {
  const pathname = new URL(_req.url).pathname;

  // GET /shiritori: 直前の単語と履歴を返す
  if (_req.method === "GET" && pathname === "/shiritori") {
    return makeSuccessResponse();
  }

  // POST /shiritori: 次の単語を受け取って判定・更新する
  if (_req.method === "POST" && pathname === "/shiritori") {
    const requestJson = await _req.json();
    const rawNextWord = requestJson["nextWord"];
    const previousWord = wordHistories[wordHistories.length - 1];

    // 空文字チェック
    if (!rawNextWord) {
      return makeErrorResponse("単語を入力してください", "10007");
    }

    // 1文字の単語はしりとりとして不適切
    if (rawNextWord.length < 2) {
      return makeErrorResponse("1文字の単語は使用できません", "10006");
    }

    // ひらがな・カタカナ以外の文字が含まれる場合はエラー
    if (!isKanaOnly(rawNextWord)) {
      return makeErrorResponse(
        "ひらがな・カタカナのみで入力してください",
        "10004",
      );
    }

    // カタカナ入力をひらがなに正規化してから以降の処理を行う
    const nextWord = toHiragana(rawNextWord);

    // previousWordの末尾とnextWordの先頭が同一か確認
    if (previousWord.slice(-1) !== nextWord.slice(0, 1)) {
      return makeErrorResponse("前の単語に続いていません", "10001");
    }

    // 実在する単語か確認(外部API連携)
    const wordExists = await isRealWord(nextWord);
    if (!wordExists) {
      return makeErrorResponse("実在しない単語の可能性があります", "10005");
    }

    // 過去に使用した単語かチェック
    if (wordHistories.includes(nextWord)) {
      wordHistories.push(nextWord);
      return makeErrorResponse(
        "過去に使用した単語です。ゲーム終了です",
        "10002",
        { wordHistories },
      );
    }

    // 末尾が「ん」で終わる場合
    if (nextWord.slice(-1) === "ん") {
      wordHistories.push(nextWord);
      return makeErrorResponse(
        "「ん」で終わりました。ゲーム終了です",
        "10003",
        { wordHistories },
      );
    }

    // 正常な単語なら履歴に追加
    wordHistories.push(nextWord);
    return makeSuccessResponse();
  }

  // POST /reset: 履歴を初期化する(初期語はランダムに選び直す)
  if (_req.method === "POST" && pathname === "/reset") {
    wordHistories = [pickRandomInitialWord()];
    return makeSuccessResponse();
  }

  // ./public以下のファイルを公開
  return serveDir(_req, {
    fsRoot: "./public/",
    urlRoot: "",
    enableCors: true,
  });
});