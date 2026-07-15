// battle.html と index.html で共通して使う処理をまとめたもの。
// 各ページの<script>より前に読み込む(ビルドツールを使わない構成のため素朴に<script src>で共有)。

// server.js の effectiveLastChar と同じ内容(表示専用のクライアント側コピー)。
// 「ー」で終わる単語は、伸ばしている直前の文字がそのまま次の頭文字になる
// (例: 「バイナリー」は直前の「り」で継続する)。
// 拗音(小さい文字)は単独で単語の先頭になれないため、大文字に変換する
// (例: 「マリアージュ」は末尾の「ゅ」ではなく「ゆ」で継続する)。
const SMALL_KANA_MAP = {
  ぁ: "あ", ぃ: "い", ぅ: "う", ぇ: "え", ぉ: "お",
  ゃ: "や", ゅ: "ゆ", ょ: "よ", っ: "つ", ゎ: "わ",
};

function effectiveLastChar(word) {
  if (!word) return "";
  let last = word.slice(-1);
  if (last === "ー" && word.length >= 2) {
    // 「ー」の直前が拗音(例:「ブラジャー」の「ゃ」)の場合もあるため、
    // 直前の文字を取り出した後であらためて大文字化の判定にかける
    last = word[word.length - 2];
  }
  return SMALL_KANA_MAP[last] ?? last;
}

function showOverlay(id) {
  document.querySelector(`#${id}`).classList.remove("hidden");
}

function hideOverlay(id) {
  document.querySelector(`#${id}`).classList.add("hidden");
}

async function apiPostJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { ok: response.status === 200, data };
}

let failureFlashTimeout = null;

// 「同じワード」「んワード」など目立たせたい失敗を画面中央に大きく表示する(対戦・練習共通の演出)
function showFailureFlash(text) {
  const el = document.querySelector("#failureFlash");
  clearTimeout(failureFlashTimeout);
  el.classList.remove("hidden", "flash-anim");
  document.querySelector("#failureFlashText").textContent = text;
  void el.offsetWidth; // reflow させてアニメーションを最初から再生する
  el.classList.add("flash-anim");
  failureFlashTimeout = setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("flash-anim");
  }, 1100);
}

// お題から現在までの単語チェーンを直近3語の矢印つなぎで表示する(対戦・練習共通)。
// 更新のたびにスライドインさせて、単語が入れ替わったことがわかるようにする。
function renderWordChain(words) {
  const el = document.querySelector("#wordChainDisplay");
  el.textContent = words.filter(Boolean).slice(-3).join(" → ");
  el.classList.remove("slide-in");
  void el.offsetWidth; // reflow させてアニメーションを最初から再生する
  el.classList.add("slide-in");
}
