/**
 * The agents' kaomoji: a pure catalogue of emotes and the rules that pick one.
 *
 * Every emote is a tiny animation: the open face, the same face blinking (same
 * width, so nothing shifts), and an optional action frame (a table flip, a
 * sparkle, a bow). Each agent has its own personality set for every emotion,
 * and a shared pool of emotions is open to all of them:
 *
 * - DEV, the hacker: shades, flexing, coffee, and table flips on failure
 * - DESIGN, the artist: sparkles, flowers, hearts and little flourishes
 * - RESEARCH, the bookworm: note-taking, pointing, shrugging, deal-with-it glasses
 * - QA, the inspector: side-eyes and squints, then a flex and a victory dance
 *
 * Nothing here reads a clock or a random source: the caller passes a `variant`
 * drawn once per expression, so the same variant always picks the same face.
 * Every face fits a slot cell and avoids combining marks, right-to-left
 * scripts and emoji-presentation glyphs (enforced by tests).
 */
import type { SlotId, SlotState } from "./mascot-art.ts";

export const EMOTIONS = [
  "happy",
  "proud",
  "love",
  "excited",
  "focused",
  "curious",
  "thinking",
  "nervous",
  "confused",
  "sleepy",
  "sad",
  "angry",
  "waiting",
  "surprised",
  "grateful",
] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** One emote: the open face, the same face blinking, and an optional action frame. */
export interface Emote {
  open: string;
  blink: string;
  action?: string;
}

const e = (open: string, blink: string, action?: string): Emote => (action ? { open, blink, action } : { open, blink });

/** Emotions every agent can draw on. */
export const SHARED_EMOTES: Record<Emotion, readonly Emote[]> = {
  happy: [e("(^▽^)", "(-▽-)"), e("(＾ω＾)", "(－ω－)"), e("ヽ(•‿•)ノ", "ヽ(-‿-)ノ"), e("(*^‿^*)", "(*-‿-*)"), e("(◕‿◕)", "(-‿-)")],
  proud: [e("(￣^￣)ゞ", "(－^－)ゞ"), e("(´▽`)b", "(-▽-)b"), e("( ￣ー￣)", "( －ー－)"), e("(•ᴗ•)ง", "(-ᴗ-)ง")],
  love: [e("(♡‿♡)", "(-‿-)", "(♡‿♡)♡"), e("(っ˘з(˘⌣˘ )", "(っ-з(-⌣- )"), e("(´ε｀ )♡", "(-ε－ )♡"), e("(◍•ᴗ•◍)♡", "(◍-ᴗ-◍)♡")],
  excited: [e("\\(^o^)/", "\\(-o-)/"), e("ヽ(^▽^)ノ", "ヽ(-▽-)ノ"), e("(ﾉ◕ヮ◕)ﾉ", "(ﾉ-ヮ-)ﾉ", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧"), e("o(≧▽≦)o", "o(-▽-)o")],
  focused: [e("(•_•)", "(-_-)"), e("(ง •_•)ง", "(ง -_-)ง"), e("(｀・ω・´)", "(｀－ω－´)"), e("( ._.)φ", "( -_-)φ")],
  curious: [e("(・・ )?", "(－－ )?"), e("(⊙_⊙)?", "(-_-)?"), e("(◔_◔)", "(-_-)"), e("(ﾟ∀ﾟ)?", "(-∀-)?")],
  thinking: [e("(￣～￣;)", "(－～－;)"), e("( ˘_˘ )", "( -_- )"), e("(・・;)ゞ", "(－－;)ゞ"), e("(¬‿¬ )", "(-‿- )")],
  nervous: [e("(；・∀・)", "(；－∀－)"), e("(⊙﹏⊙)", "(-﹏-)"), e("(●´⌓`●)", "(●-⌓-●)"), e("(°□°;)", "(-□-;)")],
  confused: [e("(・_・ヾ", "(－_－ヾ"), e("(⊙_☉)", "(-_-)"), e("(゜-゜)", "(－-－)"), e("(・・?)", "(－－?)")],
  sleepy: [e("(-_-) zzZ", "(-.-) zzZ"), e("(￣o￣) zzZZ", "(－o－) zzZZ"), e("(∪｡∪)｡zz", "(-｡-)｡zz"), e("( ˘ω˘ )ｽﾔｧ", "( -ω- )ｽﾔｧ")],
  sad: [e("(ಥ_ಥ)", "(-_-)"), e("(╥﹏╥)", "(-﹏-)"), e("(´;ω;`)", "(-;ω;-)"), e("(〒﹏〒)", "(－﹏－)"), e("(T_T)", "(-_-)")],
  angry: [e("(╬ಠ益ಠ)", "(╬-益-)"), e("(ノಠ益ಠ)ノ", "(ノ-益-)ノ", "(ノಠ益ಠ)ノ彡┻━┻"), e("ヽ(`Д´)ﾉ", "ヽ(-Д-)ﾉ"), e("(¬_¬\")", "(-_-\")")],
  waiting: [e("(´･_･`)", "(´-_-`)"), e("( ˘･_･˘)", "( ˘-_-˘)"), e("(っ´ω`c)", "(っ-ω-c)"), e("(・_・)…", "(－_－)…")],
  surprised: [e("(°o°)", "(-o-)"), e("Σ(°△°|||)", "Σ(-△-|||)"), e("(ﾟДﾟ)", "(-Д-)"), e("w(°ｏ°)w", "w(-ｏ-)w")],
  grateful: [e("(人´∀`)", "(人-∀-)"), e("(◍•ᴗ•◍)", "(◍-ᴗ-◍)"), e("m(_ _)m", "m(- -)m"), e("(ᵔᴥᵔ)", "(-ᴥ-)"), e("(*´∀`*)", "(*-∀-*)")],
};

/** DEV, the hacker: shades, flexes, coffee and code brackets; flips tables when things break. */
const DEV: Record<Emotion, readonly Emote[]> = {
  happy: [e("(⌐■_■)", "(⌐-_-)"), e("(^_^)b", "(-_-)b"), e("</>(^▽^)", "</>(-▽-)"), e("( •_•)c[_]", "( -_-)c[_]")],
  proud: [e("(⌐■_■)b", "(⌐-_-)b"), e("ᕦ(ò_óˇ)ᕤ", "ᕦ(-_-ˇ)ᕤ"), e("( •_•)>⌐■-■", "( -_-)>⌐■-■", "(⌐■_■)"), e("b(￣▽￣)d", "b(－▽－)d")],
  love: [e("(♡_♡)</>", "(-_-)</>"), e("(´∀`)♡{ }", "(-∀-)♡{ }"), e("(˘▽˘)c[_]", "(-▽-)c[_]"), e("(◍•_•◍)♡", "(◍-_-◍)♡")],
  excited: [e("ᕦ(ò_ó)ᕤ", "ᕦ(-_-)ᕤ"), e("(ﾉ≧∀≦)ﾉ", "(ﾉ-∀-)ﾉ", "(ﾉ≧∀≦)ﾉ</>"), e("\\(•_•)/", "\\(-_-)/"), e("(⌐■▽■)", "(⌐-▽-)")],
  focused: [e("(•_•)>_", "(-_-)>_"), e("[•_•]$_", "[-_-]$_"), e("(ง'-')ง", "(ง- -)ง"), e("(⌐■_■)>_", "(⌐-_-)>_")],
  curious: [e("(•_•)?</>", "(-_-)?</>"), e("(・_・)ﾉ{ }", "(－_－)ﾉ{ }"), e("(°_°)>_", "(-_-)>_"), e("( ⊙_⊙)</>", "( -_-)</>")],
  thinking: [e("(￣_￣)c[_]", "(－_－)c[_]"), e("( •_•)…{ }", "( -_-)…{ }"), e("(¬_¬)>_", "(-_-)>_"), e("(°～°)</>", "(-～-)</>")],
  nervous: [e("(°_°;)>_", "(-_-;)>_"), e("(・_・;)$_", "(－_－;)$_"), e("(⊙_⊙;)", "(-_-;)"), e("(ﾟ_ﾟ;)c[_]", "(-_-;)c[_]")],
  confused: [e("(・_・)?{ }", "(－_－)?{ }"), e("(°_°)?>_", "(-_-)?>_"), e("(⊙_☉)</>", "(-_-)</>"), e("(゜_゜)$?", "(－_－)$?")],
  sleepy: [e("(-_-)c[_] z", "(-.-)c[_] z"), e("(￣o￣)>_ zz", "(－o－)>_ zz"), e("(∪_∪)</> z", "(-_-)</> z"), e("( ˘_˘ )$_ z", "( -_- )$_ z")],
  sad: [e("(╥_╥)>_", "(-_-)>_"), e("(T_T)</>", "(-_-)</>"), e("(ಥ_ಥ)c[_]", "(-_-)c[_]"), e("(´;_;`)$_", "(-;_;-)$_")],
  angry: [e("(╯°□°)╯", "(╯-□-)╯", "(╯°□°)╯︵ ┻━┻"), e("(ノಠ益ಠ)ノ", "(ノ-益-)ノ", "(ノಠ益ಠ)ノ彡┻━┻"), e("(╬ò_ó)>_", "(╬-_-)>_"), e("┻━┻ ︵ (°□°)", "┻━┻ ︵ (-□-)")],
  waiting: [e("(•_•)c[_]", "(-_-)c[_]"), e("(´･_･`)>_", "(´-_-`)>_"), e("( ˘_˘)</>…", "( -_-)</>…"), e("(・_・)$_…", "(－_－)$_…")],
  surprised: [e("(°□°)>_", "(-□-)>_"), e("Σ(°_°)</>", "Σ(-_-)</>"), e("(ﾟДﾟ)$_", "(-Д-)$_"), e("(⊙_⊙)!{ }", "(-_-)!{ }")],
  grateful: [e("(⌐■_■)b", "(⌐-_-)b"), e("m(_ _)m</>", "m(- -)m</>"), e("(^_^)c[_]", "(-_-)c[_]"), e("(人•_•)", "(人-_-)")],
};

/** DESIGN, the artist: sparkles, flowers, hearts and a little flourish on most things. */
const DESIGN: Record<Emotion, readonly Emote[]> = {
  happy: [e("✧(◕‿◕✿)", "✧(-‿-✿)"), e("(✿^‿^)", "(✿-‿-)"), e("(◕ᴗ◕✿)", "(-ᴗ-✿)"), e("❀(^▽^)❀", "❀(-▽-)❀")],
  proud: [e("(✿◠‿◠)", "(✿-‿-)"), e("✧(˘▽˘)✧", "✧(-▽-)✧"), e("(￣▽￣)✿", "(－▽－)✿"), e("(◕‿◕)b✧", "(-‿-)b✧")],
  love: [e("(♡‿♡)✿", "(-‿-)✿"), e("(っ˘з˘)♡✧", "(っ-з-)♡✧"), e("(◍♡‿♡◍)", "(◍-‿-◍)"), e("✿(´ε｀)♡", "✿(-ε－)♡")],
  excited: [e("(ﾉ◕ヮ◕)ﾉ", "(ﾉ-ヮ-)ﾉ", "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧"), e("✧*(^▽^)*✧", "✧*(-▽-)*✧"), e("☆(≧▽≦)☆", "☆(-▽-)☆"), e("♪(^∇^)♪", "♪(-∇-)♪")],
  focused: [e("(•‿•)~✎", "(-‿-)~✎"), e("( ˘_˘)~✿", "( -_-)~✿"), e("(◕_◕)✎", "(-_-)✎"), e("(・ω・)~♪", "(－ω－)~♪")],
  curious: [e("(◕_◕)?✧", "(-_-)?✧"), e("(・・ )✿?", "(－－ )✿?"), e("(°‿°)?", "(-‿-)?"), e("✧(◔_◔)", "✧(-_-)")],
  thinking: [e("( ˘‿˘)~✎", "( -‿-)~✎"), e("(￣～￣)✿", "(－～－)✿"), e("(◕～◕)…", "(-～-)…"), e("(・・)~♪", "(－－)~♪")],
  nervous: [e("(◕﹏◕✿)", "(-﹏-✿)"), e("(°‿°;)✎", "(-‿-;)✎"), e("(・_・;)✿", "(－_－;)✿"), e("(⊙‿⊙;)", "(-‿-;)")],
  confused: [e("(◕_◕)?~", "(-_-)?~"), e("(・・?)✿", "(－－?)✿"), e("(゜‿゜)?", "(－‿－)?"), e("(°_°)✎?", "(-_-)✎?")],
  sleepy: [e("(-‿-)✿ zz", "(-.-)✿ zz"), e("( ˘ω˘ )✿z", "( -ω- )✿z"), e("(∪‿∪)♪ z", "(-‿-)♪ z"), e("(￣‿￣)zzZ", "(－‿－)zzZ")],
  sad: [e("(╥﹏╥)✿", "(-﹏-)✿"), e("(ಥ‿ಥ)", "(-‿-)"), e("(´;ω;`)✎", "(-;ω;-)✎"), e("(◕︵◕)", "(-︵-)")],
  angry: [e("(╬◣_◢)", "(╬-_-)"), e("(ﾉ｀Д´)ﾉ✎", "(ﾉ－Д-)ﾉ✎"), e("(¬_¬)✿", "(-_-)✿"), e("(ಠ‿ಠ)✎", "(-‿-)✎")],
  waiting: [e("(っ´ω`c)✿", "(っ-ω-c)✿"), e("( ˘‿˘)~♪", "( -‿-)~♪"), e("(・‿・)…✿", "(－‿－)…✿"), e("(´･‿･`)", "(´-‿-`)")],
  surprised: [e("(°o°)✿", "(-o-)✿"), e("✧(⊙‿⊙)✧", "✧(-‿-)✧"), e("(ﾟ∀ﾟ)!✎", "(-∀-)!✎"), e("Σ(◕o◕)", "Σ(-o-)")],
  grateful: [e("(人◕‿◕)", "(人-‿-)"), e("(◍•ᴗ•◍)✿", "(◍-ᴗ-◍)✿"), e("✿m(_ _)m", "✿m(- -)m"), e("(*´▽`*)✧", "(*-▽-*)✧")],
};

/** RESEARCH, the bookworm: takes notes, points at things, shrugs at the unknown. */
const RESEARCH: Record<Emotion, readonly Emote[]> = {
  happy: [e("φ(^▽^)", "φ(-▽-)"), e("(^_^)[ ]", "(-_-)[ ]"), e("(•‿•)φ", "(-‿-)φ"), e("( ˘▽˘)ﾉ", "( -▽-)ﾉ")],
  proud: [e("( •_•)>⌐■-■", "( -_-)>⌐■-■", "(⌐■_■)"), e("(￣^￣)φ", "(－^－)φ"), e("(•ᴗ•)b[ ]", "(-ᴗ-)b[ ]"), e("( ￣ー￣)φ", "( －ー－)φ")],
  love: [e("(♡_♡)[ ]", "(-_-)[ ]"), e("φ(´∀`)♡", "φ(-∀-)♡"), e("(◍•_•◍)φ", "(◍-_-◍)φ"), e("(˘ε˘)♡[ ]", "(-ε-)♡[ ]")],
  excited: [e("(σ・・)σ!", "(σ－－)σ!"), e("φ(≧▽≦)", "φ(-▽-)"), e("\\(°o°)/", "\\(-o-)/"), e("(ﾉ°▽°)ﾉ[ ]", "(ﾉ-▽-)ﾉ[ ]")],
  focused: [e("φ(．．)", "φ(－－)", "φ(．．;)"), e("( ._.)φ__", "( -_-)φ__"), e("(・_・)[ ]", "(－_－)[ ]"), e("( •_•)φ", "( -_-)φ")],
  curious: [e("(σ・・)σ", "(σ－－)σ"), e("(・・ )?[ ]", "(－－ )?[ ]"), e("(⊙_⊙)φ?", "(-_-)φ?"), e("(°_°)…?", "(-_-)…?")],
  thinking: [e("φ(￣～￣)", "φ(－～－)"), e("( ˘_˘ )φ", "( -_- )φ"), e("(・・;)[ ]", "(－－;)[ ]"), e("(¬_¬)φ…", "(-_-)φ…")],
  nervous: [e("φ(°_°;)", "φ(-_-;)"), e("(・_・;)[?]", "(－_－;)[?]"), e("(⊙﹏⊙)φ", "(-﹏-)φ"), e("(°□°;)[ ]", "(-□-;)[ ]")],
  confused: [e("¯\\_(ツ)_/¯", "¯\\_(ー)_/¯"), e("(・_・ヾ[?]", "(－_－ヾ[?]"), e("(⊙_☉)φ", "(-_-)φ"), e("(゜-゜)?[ ]", "(－-－)?[ ]")],
  sleepy: [e("(-_-)[ ] zz", "(-.-)[ ] zz"), e("φ(￣o￣) z", "φ(－o－) z"), e("(∪_∪)φ zz", "(-_-)φ zz"), e("( ˘ω˘ )[ ]z", "( -ω- )[ ]z")],
  sad: [e("(ಥ_ಥ)φ", "(-_-)φ"), e("(╥_╥)[ ]", "(-_-)[ ]"), e("(´;ω;`)φ", "(-;ω;-)φ"), e("(T_T)[?]", "(-_-)[?]")],
  angry: [e("(ಠ_ಠ)φ", "(-_-)φ"), e("(╬ಠ_ಠ)[ ]", "(╬-_-)[ ]"), e("ヽ(`Д´)ﾉφ", "ヽ(-Д-)ﾉφ"), e("(¬_¬\")[ ]", "(-_-\")[ ]")],
  waiting: [e("(´･_･`)φ", "(´-_-`)φ"), e("( ˘･_･˘)[ ]", "( ˘-_-˘)[ ]"), e("φ(・_・)…", "φ(－_－)…"), e("(っ´ω`c)φ", "(っ-ω-c)φ")],
  surprised: [e("Σ(°o°)φ", "Σ(-o-)φ"), e("(ﾟДﾟ)[!]", "(-Д-)[!]"), e("(⊙_⊙)!φ", "(-_-)!φ"), e("w(°ｏ°)w[ ]", "w(-ｏ-)w[ ]")],
  grateful: [e("(人´∀`)φ", "(人-∀-)φ"), e("m(_ _)m[ ]", "m(- -)m[ ]"), e("(ᵔᴥᵔ)φ", "(-ᴥ-)φ"), e("(◍•ᴗ•◍)[ ]", "(◍-ᴗ-◍)[ ]")],
};

/** QA, the inspector: side-eyes and squints at everything, then flexes and dances on a pass. */
const QA: Record<Emotion, readonly Emote[]> = {
  happy: [e("(•‿•)✓", "(-‿-)✓"), e("( ^_^)[✓]", "( -_-)[✓]"), e("(ᵔ.ᵔ)✓", "(-.-)✓"), e("(＾_＾)✓", "(－_－)✓")],
  proud: [e("ᕙ( • ‿ • )ᕗ", "ᕙ( - ‿ - )ᕗ"), e("ᕦ(•_•)ᕤ✓", "ᕦ(-_-)ᕤ✓"), e("(￣^￣)✓", "(－^－)✓"), e("( •_•)b✓", "( -_-)b✓")],
  love: [e("(♡_♡)✓", "(-_-)✓"), e("(´∀`)♡[✓]", "(-∀-)♡[✓]"), e("(◍•_•◍)✓", "(◍-_-◍)✓"), e("(˘ε˘)♡✓", "(-ε-)♡✓")],
  excited: [e("ᕕ( ᐛ )ᕗ", "ᕕ( - )ᕗ"), e("\\(•_•)/✓", "\\(-_-)/✓"), e("(ﾉ≧▽≦)ﾉ✓", "(ﾉ-▽-)ﾉ✓"), e("ᕙ(⇀‸↼)ᕗ", "ᕙ(-‸-)ᕗ")],
  focused: [e("(ಠ_ಠ)", "(−_−)"), e("(¬_¬)", "(-_-)"), e("(눈_눈)", "(－_－)"), e("(•_•)⊙", "(-_-)⊙")],
  curious: [e("(ಠ_ಠ)?", "(−_−)?"), e("(¬_¬)?[ ]", "(-_-)?[ ]"), e("(⊙_⊙)⊙", "(-_-)⊙"), e("(・_・)?✓", "(－_－)?✓")],
  thinking: [e("(¬‿¬)[ ]", "(-‿-)[ ]"), e("(ಠ～ಠ)", "(−～−)"), e("(￣_￣)[?]", "(－_－)[?]"), e("( ˘_˘ )✓?", "( -_- )✓?")],
  nervous: [e("(ಠ_ಠ;)", "(−_−;)"), e("(°_°;)[ ]", "(-_-;)[ ]"), e("(⊙﹏⊙)✓?", "(-﹏-)✓?"), e("(・_・;)✗?", "(－_－;)✗?")],
  confused: [e("(ಠ_ಠ)?!", "(−_−)?!"), e("(・_・ヾ[?]", "(－_－ヾ[?]"), e("(⊙_☉)✗", "(-_-)✗"), e("(゜-゜)[✗]", "(－-－)[✗]")],
  sleepy: [e("(-_-)[ ] zz", "(-.-)[ ] zz"), e("(￣o￣)✓ zz", "(－o－)✓ zz"), e("(∪_∪)⊙ z", "(-_-)⊙ z"), e("( ˘ω˘ )✓z", "( -ω- )✓z")],
  sad: [e("(ಥ_ಥ)✗", "(-_-)✗"), e("(╥﹏╥)[✗]", "(-﹏-)[✗]"), e("(´;ω;`)✗", "(-;ω;-)✗"), e("(T_T)✗", "(-_-)✗")],
  angry: [e("(ಠ益ಠ)", "(−益−)"), e("(╬ಠ_ಠ)✗", "(╬−_−)✗"), e("(ノಠ益ಠ)ノ", "(ノ−益−)ノ", "(ノಠ益ಠ)ノ[✗]"), e("(¬_¬\")✗", "(-_-\")✗")],
  waiting: [e("(¬_¬)…", "(-_-)…"), e("(´･_･`)[ ]", "(´-_-`)[ ]"), e("(ಠ_ಠ)…", "(−_−)…"), e("( ˘_˘)✓…", "( -_-)✓…")],
  surprised: [e("(ಠ_ಠ)!", "(−_−)!"), e("Σ(°_°)✗", "Σ(-_-)✗"), e("(⊙_⊙)[!]", "(-_-)[!]"), e("(ﾟДﾟ)✓!", "(-Д-)✓!")],
  grateful: [e("(人•_•)✓", "(人-_-)✓"), e("m(_ _)m✓", "m(- -)m✓"), e("(ᵔ.ᵔ)b", "(-.-)b"), e("(◍•ᴗ•◍)✓", "(◍-ᴗ-◍)✓")],
};

/** Personality sets per agent column. */
export const PERSONALITY_EMOTES: Record<SlotId, Record<Emotion, readonly Emote[]>> = {
  dev: DEV,
  design: DESIGN,
  research: RESEARCH,
  qa: QA,
};

/** Frames per emote: open, blink, then the action (or the open face again), held one step each. */
export const EMOTE_STEPS = 4;

/** The four frames an emote steps through: open, blink, action, action. */
export function emoteFrames(emote: Emote): readonly string[] {
  const finish = emote.action ?? emote.open;
  return [emote.open, emote.blink, finish, finish];
}

/** What a slot is going through, as far as its face is concerned. */
export interface Situation {
  status: SlotState;
  /** Live one-word activity while working (reading, editing, running, thinking, ...). */
  activity?: string;
  flag?: "waiting" | "quiet" | "retry";
  /** The run was asked to wrap up early. */
  wrappedUp?: boolean;
  /** A file was just handed to this agent. */
  handover?: boolean;
}

const ACTIVITY_EMOTIONS: Record<string, readonly Emotion[]> = {
  reading: ["curious", "focused"],
  searching: ["curious", "thinking"],
  editing: ["focused", "excited", "proud"],
  running: ["nervous", "focused"],
  thinking: ["thinking", "curious"],
  writing: ["focused", "proud"],
  researching: ["curious", "thinking"],
};

/** The emotions that fit a situation, most fitting first. */
export function emotionsFor(situation: Situation): readonly Emotion[] {
  switch (situation.status) {
    case "idle":
      return ["sleepy", "waiting", "happy"];
    case "done":
      return situation.wrappedUp ? ["nervous", "proud"] : ["happy", "proud", "love", "excited"];
    case "failed":
      return ["sad", "angry", "confused", "surprised"];
    default:
      break;
  }
  if (situation.flag === "waiting") return ["waiting"];
  if (situation.flag === "quiet") return ["confused", "sleepy"];
  if (situation.flag === "retry") return ["nervous", "sad"];
  if (situation.handover) return ["grateful", "happy"];
  if (situation.wrappedUp) return ["nervous", "surprised"];
  return ACTIVITY_EMOTIONS[situation.activity ?? ""] ?? ["focused", "excited", "happy"];
}

/** Share of picks drawn from the agent's own personality set (out of 10). */
const PERSONALITY_SHARE = 6;

function positive(variant: number): number {
  return Number.isFinite(variant) ? Math.abs(Math.floor(variant)) : 0;
}

/**
 * The emote for one expression: the emotion from the situation, then a face
 * from the agent's personality (about 60%) or the shared pool, all chosen by
 * the expression's `variant`.
 */
export function pickEmote(slot: SlotId, situation: Situation, variant: number): Emote {
  const seed = positive(variant);
  const emotions = emotionsFor(situation);
  const emotion = emotions[seed % emotions.length]!;
  const own = (Math.floor(seed / 7) % 10) < PERSONALITY_SHARE;
  const pool = own ? PERSONALITY_EMOTES[slot][emotion] : SHARED_EMOTES[emotion];
  return pool[Math.floor(seed / 71) % pool.length]!;
}

/** The frames of the emote a slot plays for this expression. */
export function slotEmote(slot: SlotId, situation: Situation, variant: number): readonly string[] {
  return emoteFrames(pickEmote(slot, situation, variant));
}
