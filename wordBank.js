// バトルモード用の単語バンク(しりとりで繋がりやすい一般名詞)
// 条件: ひらがなのみ・2文字以上・「ん」で終わらない
export const wordBank = [
  "あさひ", "いか", "いす", "いぬ", "いろ", "うさぎ", "うた", "うみ",
  "えき", "えんぴつ", "おかし", "おに", "おんがく", "かい", "かさ", "かめ",
  "きつね", "きのこ", "くじら", "くつ", "くも", "けいと", "こおり", "ごりら",
  "さかな", "さくら", "さる", "しか", "しろ", "すいか", "すし", "すずめ",
  "そら", "たいこ", "たこ", "たぬき", "ちきゅう", "ちず", "つき", "つくえ",
  "てがみ", "てんき", "とけい", "とら", "なす", "なみ", "にく", "にじ",
  "ねこ", "のり", "はさみ", "はし", "はな", "ひかり", "ひこうき", "ひも",
  "びわ", "ふえ", "ふね", "へび", "ほし", "まくら", "まど", "みず",
  "むし", "めがね", "もも", "もり", "やま", "ゆき", "ようふく", "らくだ",
  "りす", "りんご", "るす", "れいぞうこ", "ろうそく", "わに", "じゃがいも",
  "だんご", "どんぐり", "あひる", "いちご", "うぐいす", "かえる", "くわがた",
  "けむし", "こうもり", "すいとう", "とうもろこし", "にわとり", "はちみつ",
  "ふくろう", "へいわ", "ほうき", "まめ", "みつばち", "むぎ", "めだか",
  "やぎ", "ゆびわ", "よる", "らっぱ", "ろば", "わたあめ",
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// exclude に含まれない単語からランダムに1つ選ぶ(ラウンドの起点用)
export function pickRandomSeed(exclude = []) {
  const excludeSet = new Set(exclude);
  const candidates = wordBank.filter((word) => !excludeSet.has(word));
  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

// previousWord の末尾に繋がり、かつ exclude に含まれない単語を1つ選ぶ
export function pickChainWord(previousWord, exclude = []) {
  const excludeSet = new Set(exclude);
  const lastChar = previousWord.slice(-1);
  const candidates = wordBank.filter((word) =>
    !excludeSet.has(word) && word.slice(0, 1) === lastChar
  );
  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

// CPUの1ターン分(15秒相当)をまとめて生成する
export function generateBotTurn(previousWord, exclude = []) {
  const excludeSet = new Set(exclude);
  const words = [];
  let current = previousWord;
  const wordCount = 2 + Math.floor(Math.random() * 4); // 2〜5語

  for (let i = 0; i < wordCount; i++) {
    const next = pickChainWord(current, excludeSet);
    if (!next) break;
    words.push(next);
    excludeSet.add(next);
    current = next;
  }

  const totalLength = words.reduce((sum, word) => sum + word.length, 0);
  return { words, totalLength };
}
