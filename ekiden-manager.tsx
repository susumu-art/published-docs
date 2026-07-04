import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/* ============================================================
   大学陸上駅伝 監督シミュレーション「たすき繋」
   - 週単位ターン制 (1月1週 〜 12月最終週)
   - 三冠: 出雲路(10月) / 全日本(11月) / 箱根山(12月)
   - レース: JR運行情報風・区間トラック縦スクロール
   ============================================================ */

const C = {
  bg: "#0d1117", panel: "#161b22", panel2: "#1c232d", line: "#2a3340",
  txt: "#e6edf3", sub: "#a0acbc", dim: "#7c8695",
  gold: "#d8b22e", blue: "#2c6fbf", green: "#3fb950", red: "#e5534b",
  amber: "#e8a838", cyan: "#39a0a8", purple: "#a371f7",
};
const mono = "'IBM Plex Mono','SFMono-Regular',Menlo,monospace";
const serif = "'Hiragino Mincho ProN','Yu Mincho',serif";

/* ---------- 名前生成 ---------- */
const SEI = ["佐藤","鈴木","高橋","田中","渡辺","伊藤","山本","中村","小林","加藤","吉田","山田","佐々木","松本","井上","木村","林","清水","山口","池田","橋本","阿部","石川","前田","藤田","後藤","岡田","長谷川","村上","近藤","石井","遠藤","青木","坂本","斎藤","福田","太田","西村","藤井","岡本","三浦","藤原","岡","松田","中川","中野","原田","小川","竹内","金子","和田","中山","石田","上田","森","柴田","原","酒井","工藤","横山","宮崎","宮本","内田","高木","谷口","安藤","島田","千葉","熊谷","谷","関","平野","大野","菅原","久保","松井","大塚","白石","岩崎","河野","上原","杉山","野口","菊地","新井","渡部","荒木","野村","大久保","小野","田村","竹下","川口","菅","本田","秋山","川崎","西田","東","平田"];
const MEI = ["翔太","大輝","拓海","健太","悠斗","陽介","駿","蓮","颯","海斗","空","樹","葵","湊","直樹","隼人","和真","結人","蒼空","奏","碧","壮","凌","俊介","快","走","聖","遥","快斗","響","陸","誠","拓也","雄太","亮","健斗","翼","大地","康介","祐輔","龍之介","和也","純平","裕也","真","隆志","哲平","俊輔","拓真","賢","慶太","海人","祐太","駿介","海翔","昂","遼","凌駕","太一","琉","新","蒼","碧人","柊","煌","奎人","琢磨","樹生","陽斗","暁","煌斗","透","誠人","新太","佑","風斗","岳","怜","祐","旬","昴","暁人","侑","奏汰","廉","慶","煌生","結希","澄","壱","光太","旺","海星","凜","勘太郎","侑真","煌大","隆","虎太郎","湊大","空輝"];
const rnd = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rnd(a, b + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtTime = (sec) => {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
};
const pace = (sec5000) => { // per km
  const p = sec5000 / 5;
  return `${Math.floor(p/60)}'${String(Math.round(p%60)).padStart(2,"0")}"`;
};

let _uid = 1;
let _gid = 1;
// 班参照ヘルパー: group が "all" / {gid} / (旧)配列 / null に対して統一的に扱う
function isGroupRef(g){ return g && typeof g === "object" && !Array.isArray(g) && g.gid != null; }
function resolveGroup(group, trainingGroups){
  // 返り値: {kind:"all"} | {kind:"group", g:{gid,name,ids}} | {kind:"none"}
  if (group === "all") return {kind:"all"};
  if (isGroupRef(group)) {
    const g = trainingGroups.find(x=>x.gid===group.gid);
    return g ? {kind:"group", g} : {kind:"none"};
  }
  if (Array.isArray(group)) {
    // 旧形式(配列スナップショット): idsで暫定マッチ
    const g = trainingGroups.find(x=>JSON.stringify(x.ids)===JSON.stringify(group));
    return g ? {kind:"group", g} : {kind:"none"};
  }
  return {kind:"none"};
}
function groupIdsOf(group, trainingGroups){
  const r = resolveGroup(group, trainingGroups);
  if (r.kind === "group") return r.g.ids;
  if (Array.isArray(group)) return group; // 旧: フォールバック
  return [];
}
// 選手が所属する班のインデックス(なければ -1)
function memberOfGroup(runnerId, trainingGroups){
  return trainingGroups.findIndex(g=>g.ids.includes(runnerId));
}
// 班練習の集中度ボーナス(能力上昇・疲労の両方に掛かる)
const GROUP_BONUS = 1.1;
// 選手が今週どのメニューを受けるか (advanceWeekの実適用ロジックのミラー)
// 1人あたり最大2メニュー: 班所属→班+全体1つ目 / 未所属→全体2つ
// 返り値: [{menu:MENUS[x], via:"group"|"all", groupName?}]
function runnerAssignments(runnerId, trainings, trainingGroups){
  const applied = [];
  const groupHit = trainings.find(t => groupIdsOf(t.group, trainingGroups).includes(runnerId));
  const allSlots = trainings.filter(t => t.group==="all");
  if (groupHit) {
    const rg = resolveGroup(groupHit.group, trainingGroups);
    applied.push({menu: MENUS[groupHit.menu], via:"group",
      groupName: rg.kind==="group"? rg.g.name : "―"});
    allSlots.slice(0,1).forEach(t => applied.push({menu: MENUS[t.menu], via:"all"}));
  } else {
    allSlots.slice(0,2).forEach(t => applied.push({menu: MENUS[t.menu], via:"all"}));
  }
  return applied;
}
function makeRunner(grade, strengthBias=0) {
  const pot = clamp(ri(55, 92) + strengthBias, 45, 97);
  const base = clamp(pot - ri(8, 24), 40, 95);
  const speed = clamp(base + ri(-8, 8), 38, 96);
  const stamina = clamp(base + ri(-8, 8), 38, 96);
  // best5000: 強いほど速い。13:30(810s)〜15:40(940s)
  const best5000 = Math.round(940 - ((speed + stamina) / 2 - 40) * 2.4 + ri(-6, 6));
  const best10000 = Math.round(best5000 * 2.07 + ri(-8, 8));
  return {
    id: _uid++, name: pick(SEI) + pick(MEI), grade,
    speed, stamina,
    spirit: clamp(base + ri(-10, 12), 35, 97),
    uphill: clamp(base + ri(-16, 16), 30, 97),
    recovery: clamp(ri(45, 90), 40, 95),
    potential: pot,
    best5000: clamp(best5000,790,1100), best10000: clamp(best10000,1620,2300),
    condition: ri(58, 82), fatigue: ri(8, 26), injury: 0,
    growth: 0,
  };
}
function makeRoster() {
  // 自校は中堅校スタート(全14校中おおよそ6〜9位相当)。
  // 初年度は部員15名の薄い選手層(1年5・2年4・3年3・4年3)。
  // 毎年5〜7名の新入生で卒業分を上回り、数年で24名前後の厚い部へ成長する。
  const r = [];
  const grades = [];
  [[1,5],[2,4],[3,3],[4,3]].forEach(([g,n])=>{ for (let i=0;i<n;i++) grades.push(g); });
  grades.forEach((g,i)=>{
    // エース格(i=0)で+5前後、末端(i=14)で-6前後の強さ勾配。
    const bias = 5 - i*0.8;
    r.push(makeRunner(g, bias));
  });
  return r.sort((a,b)=>a.best5000-b.best5000);
}

/* ---------- 高校生(リクルート対象) ---------- */
const PREF_TEAM = ["top","mid","any"];
const PREF_STYLE = ["sprint","stamina","mountain","balance"];
const PREF_STYLE_LABEL = {sprint:"スピード強化",stamina:"スタミナ重視",mountain:"山岳特化",balance:"オールラウンド"};
const PREF_TEAM_LABEL = {top:"強豪校志望",mid:"中堅校志望",any:"こだわらない"};

function makeProspect() {
  const pot = ri(48, 99);
  const base = clamp(pot - ri(10, 28), 38, 92);
  const speed = clamp(base + ri(-8, 8), 38, 95);
  const stamina = clamp(base + ri(-8, 8), 38, 95);
  const uphill = clamp(base + ri(-18, 18), 30, 95);
  const spirit = clamp(base + ri(-12, 12), 35, 97);
  const best5000 = Math.round(960 - ((speed+stamina)/2-40)*2.2 + ri(-8,8));
  return {
    id: _uid++, name: pick(SEI) + pick(MEI),
    school: pick(["県立北高","学院附属","東洋陸協高","西武学園","海央大附","南陽工高","明徳学園","信濃中央","東海陸高","白嶺高"]),
    pot, speed, stamina, uphill, spirit,
    best5000: clamp(best5000, 820, 1000),
    prefTeam: pick(PREF_TEAM), prefStyle: pick(PREF_STYLE),
    fame: clamp(Math.round((pot-50)*1.3 + ri(-8,8)), 0, 100),
  };
}
function makeProspects(n=15) {
  return Array.from({length:n}, ()=>makeProspect()).sort((a,b)=>b.pot-a.pot);
}
function teamStrength(pool) {
  const top = pool.slice().sort((a,b)=>(b.speed+b.stamina) - (a.speed+a.stamina)).slice(0,8);
  return Math.round(top.reduce((a,r)=>a+(r.speed+r.stamina)/2,0)/Math.max(1,top.length));
}
// 大学側スコア = scoutEffort(0-100) × 大学魅力(strength&style)
function prospectAffinity(prospect, schoolStrength, schoolStyles) {
  let s = 0;
  if (prospect.prefTeam==="top") s += schoolStrength>=82 ? 25 : schoolStrength>=72? 8 : -10;
  else if (prospect.prefTeam==="mid") s += (schoolStrength>=70 && schoolStrength<=86)? 18 : 0;
  else s += 8;
  if (schoolStyles && schoolStyles.includes(prospect.prefStyle)) s += 18;
  return s;
}

/* ---------- 大会定義 ---------- */
// 距離(km)。種別: flat / up / down / long
const RACES = {
  izumo: {
    key:"izumo", name:"出雲路駅伝", short:"出雲", week:26, color:C.cyan, // 10月2週
    legs:[
      {n:1,dist:8.0,type:"flat"},{n:2,dist:5.8,type:"flat"},{n:3,dist:8.5,type:"flat"},
      {n:4,dist:6.2,type:"flat"},{n:5,dist:6.4,type:"flat"},{n:6,dist:10.2,type:"long"},
    ],
    // stations[i] = 第i+1区のスタート地点。最後の要素はフィニッシュ。
    stations:["出雲大社正門前","島根ワイナリー前","平田中ノ島","鳶巣","島根県立大学前","浜山公園北口","出雲ドーム前"],
  },
  alljapan: {
    key:"alljapan", name:"全日本大学駅伝", short:"全日本", week:29, color:C.gold, // 11月1週
    legs:[
      {n:1,dist:9.5,type:"flat"},{n:2,dist:11.1,type:"long"},{n:3,dist:11.9,type:"long"},
      {n:4,dist:11.8,type:"long"},{n:5,dist:12.4,type:"long"},{n:6,dist:12.8,type:"long"},
      {n:7,dist:17.6,type:"long"},{n:8,dist:19.7,type:"long"},
    ],
    stations:["熱田神宮西門前","筏川橋","高松海岸","霞ヶ浦","石薬師","江戸橋","徳和","宮川","伊勢神宮内宮宇治橋前"],
  },
  hakone: {
    key:"hakone", name:"箱根山駅伝", short:"箱根", week:37, color:C.blue, // 1月1週
    field:11,
    legs:[
      {n:1,dist:21.3,type:"long"},{n:2,dist:23.1,type:"long"},{n:3,dist:21.4,type:"down"},
      {n:4,dist:20.9,type:"flat"},{n:5,dist:20.8,type:"up"},
      {n:6,dist:20.8,type:"down"},
      {n:7,dist:21.3,type:"flat"},{n:8,dist:21.4,type:"flat"},
      {n:9,dist:23.1,type:"long"},{n:10,dist:23.0,type:"long"},
    ],
    stations:["大手町","鶴見","戸塚","平塚","小田原","芦ノ湖","小田原","平塚","戸塚","鶴見","大手町"],
    // 往路ゴール地点(5区終了)のインデックス
    outboundGoalAt:5,
  },
};
// 箱根予選会: 10月3週 (現実準拠)
const YOSEN = { name:"箱根山駅伝 予選会", short:"予選", week:27, color:"#db61a2",
  dist:21.0975, countTop:10, qualifySlots:0 /* 動的に決定 */ };

/* ---------- 個人レース(任意エントリー) ----------
   選手を選んで出場すると、結果として持ちタイム更新・能力微上昇・疲労が反映される。
   出走しなければ何も起きない。練習では持ちタイムは更新されない。 */
const MEETS = {
  kiroku_spring: { key:"kiroku_spring", name:"学内記録会(春)", short:"春記録会",
    week:8, dist:5000, kind:"track5k", color:"#5b6675",
    desc:"自校内の5000m記録会。気軽に出走でき、5000mPB更新の機会。",
    fatigue:10, capacity:99, // 何人でも
    gainSpeed:0.25, gainStamina:0.15, spiritGain:0.05 },
  kanto_intercol: { key:"kanto_intercol", name:"関東インカレ", short:"関東IC",
    week:6, dist:10000, kind:"track10k", color:"#39a0a8",
    desc:"関東地区の大学対抗戦。10000mで競う格式高い大会。上位校の選手と走る経験値。",
    fatigue:22, capacity:6,
    gainSpeed:0.5, gainStamina:0.45, spiritGain:0.5 },
  kiroku_summer: { key:"kiroku_summer", name:"学内記録会(夏)", short:"夏記録会",
    week:15, dist:5000, kind:"track5k", color:"#5b6675",
    desc:"夏合宿前の調整記録会。",
    fatigue:10, capacity:99,
    gainSpeed:0.25, gainStamina:0.15, spiritGain:0.05 },
  nihon_intercol: { key:"nihon_intercol", name:"日本インカレ", short:"日本IC",
    week:22, dist:10000, kind:"track10k", color:"#e8a838",
    desc:"全国大学対抗。10000m。代表クラスが集う。経験値も大きい。",
    fatigue:24, capacity:5,
    gainSpeed:0.45, gainStamina:0.55, spiritGain:0.7 },
  ageo_half: { key:"ageo_half", name:"上尾ハーフ", short:"上尾",
    week:30, dist:21097.5, kind:"half", color:"#3fb950",
    desc:"ハーフマラソンの公認記録会。スタミナ系の指標が更新される。",
    fatigue:30, capacity:14,
    gainSpeed:0.1, gainStamina:0.7, spiritGain:0.2 },
  hachioji_long: { key:"hachioji_long", name:"八王子ロング", short:"八王子",
    week:32, dist:30000, kind:"long30k", color:"#a371f7",
    desc:"30km/10000m併催の長距離記録会。10000mPB更新と長距離耐性向上の機会。",
    fatigue:32, capacity:10,
    gainSpeed:0.15, gainStamina:0.65, spiritGain:0.25 },
};

/* ---------- ライバル校 ----------
   プレイヤーと同じ選手データ構造(持ちタイム+適性)を持たせ、
   なぜ速い/遅いかを可視化できるようにする。 */
const RIVAL_NAMES = ["青嶺大","駿河台大","東陽大学","早苗田大","明央大","中庸大","法念大","國學大","帝都体大","神流川大","拓進大","山梨学陸大","城西工大","専修館大"];

// strength(60-94)を中心に、ばらつきのある選手を1人生成
function makeRivalRunner(strength) {
  const base = clamp(strength + ri(-10, 8), 38, 97);
  const speed = clamp(base + ri(-7, 9), 38, 98);
  const stamina = clamp(base + ri(-7, 9), 38, 98);
  const best5000 = Math.round(940 - ((speed + stamina) / 2 - 40) * 2.4 + ri(-6, 6));
  const best10000 = Math.round(best5000 * 2.07 + ri(-8, 8));
  return {
    id: _uid++, name: pick(SEI) + pick(MEI),
    speed, stamina,
    spirit: clamp(base + ri(-9, 12), 35, 98),
    uphill: clamp(base + ri(-16, 18), 30, 98),
    recovery: clamp(ri(45, 90), 40, 95),
    best5000: clamp(best5000, 790, 1100),
    best10000: clamp(best10000, 1620, 2300),
    condition: ri(60, 85), fatigue: ri(6, 22), injury: 0,
  };
}

function makeRival(name, tier) {
  // tier: 0最強〜3。エースから末端まで強さ勾配を持つ部員24名。
  // 上位選手の値は維持しつつ、深さ(箱根用の20km走者層)を確保。
  const top = [90, 83, 76, 69][tier] + ri(-2, 2);
  const squad = [];
  for (let i = 0; i < 24; i++) {
    // エース(0)から徐々に弱く。傾斜を緩めにして層を厚く。
    const s = clamp(top - i * ri(1, 2) + ri(-3, 3), 50, 96);
    squad.push(makeRivalRunner(s));
  }
  squad.sort((a, b) => a.best5000 - b.best5000);
  // チーム総合力(上位8名平均)
  const strength = Math.round(squad.slice(0, 8).reduce((a, r) => a + (r.speed + r.stamina) / 2, 0) / 8);
  return { name, key: "rival_" + name, tier, squad, strength };
}

/* ---------- 練習メニュー ---------- */
const MENUS = {
  lsd:   {key:"lsd", label:"距離走 LSD", color:C.cyan,  desc:"スタミナ重視・疲労大",
          eff:r=>({stamina:0.55, fatigue:7, inj:0.4})},
  intvl: {key:"intvl",label:"インターバル", color:C.red, desc:"スピード強化・故障注意",
          eff:r=>({speed:0.6, fatigue:8, inj:1.4})},
  pace:  {key:"pace", label:"ペース走", color:C.amber, desc:"バランス型",
          eff:r=>({stamina:0.32, speed:0.32, fatigue:5, inj:0.6})},
  hill:  {key:"hill", label:"山練習", color:C.purple,desc:"上り適性・疲労大",
          eff:r=>({uphill:0.7, stamina:0.2, fatigue:7, inj:0.9})},
  jog:   {key:"jog",  label:"ジョグ", color:C.green, desc:"軽微全体・疲労小",
          eff:r=>({stamina:0.12, speed:0.1, spirit:0.1, fatigue:2, inj:0.1})},
  rest:  {key:"rest", label:"休養", color:C.sub,   desc:"疲労回復・故障回復",
          eff:r=>({fatigue:-16, cond:8, inj:-1})},
};

/* ---------- 週カレンダー ---------- */
function weekLabel(w) {
  // 48週 = 4月1週から翌3月4週まで
  const monthIdx = Math.floor((w-1)/4); // 0=4月, 1=5月, ..., 9=1月, 10=2月, 11=3月
  const month = ((monthIdx + 3) % 12) + 1;
  const wk = ((w-1)%4)+1;
  return `${month}月${wk}週`;
}
function weekEvent(w) {
  if (w===RACES.izumo.week) return {type:"race", race:"izumo"};
  if (w===RACES.alljapan.week) return {type:"race", race:"alljapan"};
  if (w===YOSEN.week) return {type:"yosen"};
  if (w===RACES.hakone.week) return {type:"race", race:"hakone"};
  if (w===13) return {type:"scout"}; // 7月1週: 高校生スカウト開始
  // 個人レース(任意エントリー)
  const m = Object.values(MEETS).find(x=>x.week===w);
  if (m) return {type:"meet", meet:m.key};
  if (w>=17 && w<=20) return {type:"camp", label:"夏合宿"}; // 8月
  if (w===38) return {type:"retire", label:"4年生引退"};       // 箱根の翌週(1月2週)
  return null;
}

/* ============================================================
   レースシミュレーション
   ============================================================ */
const TYPE_LABEL = {flat:"平坦", up:"山登り", down:"山下り", long:"ロング"};
function legAptitude(runner, type) {
  // 区間適性は±5%程度の補正にとどめる(±25%だと駅伝タイムが現実離れする)。
  // 1.0が標準、>1.0で得意、<1.0で不得意。
  switch(type){
    case "up":   return 0.94 + (runner.uphill/100) * 0.10;          // 0.94-1.04
    case "down": return 0.97 + ((runner.speed+runner.uphill)/200) * 0.08; // 0.97-1.05
    case "long": return 0.96 + (runner.stamina/100) * 0.09;          // 0.96-1.05
    default:     return 0.97 + ((runner.speed+runner.stamina)/200) * 0.08; // 0.97-1.05
  }
}
// 区間距離をその選手が走る基準秒数
function baseLegSeconds(runner, dist, type) {
  if (!runner || runner.best10000 == null) return 9999;
  // 10000mペースを基準にkm当たり秒
  let perKm = runner.best10000 / 10;
  // 距離が長いほど落ちる(現実: 21kmなら10000より約8%遅い, 30km級なら12%遅い)
  if (dist > 10) {
    const over = dist - 10;
    perKm *= 1 + over * 0.008;            // 21km: +8.8%, 23km: +10.4%, 山区(20.8): +8.6%
  }
  // 区間適性(±5%程度): 得意なら速く、不得意なら遅く
  perKm /= legAptitude(runner, type);
  // 調子(±3%程度)
  perKm *= (1.03 - runner.condition/1700); // 調子100で1.03-0.0588=0.971
  // 疲労(疲れると遅い): fatigue=100で+8%
  perKm *= (1.0 + runner.fatigue/1250);
  return perKm * dist;
}

// あるチームの選手プールから、各区間に最適な選手を貪欲割当して
// [{leg, runner, time, type, dist}] を返す。区間重複なし。
// 稼働選手が足りない場合は故障者(タイム割増)で必ず全区間を埋める。
function buildLineup(pool, legs) {
  // 稼働者優先、足りなければ故障者も使える順に並べる
  const healthy = pool.filter(r => r.injury === 0);
  const injured = pool.filter(r => r.injury > 0);
  const avail = [...healthy, ...injured].slice(); // 不足時のフォールバック込み
  const assign = new Array(legs.length).fill(null);
  // 長い/重要な区間(山含む)から先に最適者を取る
  const order = legs.map((l,i)=>i).sort((a,b)=>{
    const wa = legs[a].dist + (legs[a].type==="up"?6:0);
    const wb = legs[b].dist + (legs[b].type==="up"?6:0);
    return wb-wa;
  });
  order.forEach(i=>{
    const l = legs[i];
    let best=null, bs=Infinity, bestT=Infinity;
    avail.forEach(r=>{
      let t = baseLegSeconds(r, l.dist, l.type);
      if (r.injury > 0) t *= 1.18; // 故障者は割増(出さざるを得ない非常時)
      if (t<bs){bs=t;best=r;bestT=t;}
    });
    if(best){ assign[i]={leg:l.n,runner:best,time:bestT,type:l.type,dist:l.dist};
      avail.splice(avail.indexOf(best),1); }
  });
  return assign;
}
// チームの想定総合タイム(オーダー最適化後)
function projectedTeamTime(pool, legs) {
  const lu = buildLineup(pool, legs);
  return lu.reduce((a,x)=> a + (x? x.time : 99999), 0);
}

/* ---------- 個人レース結果計算 ---------- */
// 走者が distance(m) を走ったときの想定タイム(秒)。
// 5000/10000は持ちタイムを起点に調子・疲労・spiritでブレ。ハーフ/30kは持ちタイムから推定。
function meetTime(runner, meet) {
  const dm = meet.dist;
  let perKm;
  if (dm === 5000) perKm = runner.best5000/5;
  else if (dm === 10000) perKm = runner.best10000/10;
  else if (dm === 21097.5) perKm = (runner.best10000/10) * 1.085;          // ハーフは10000より約8.5%遅
  else if (dm === 30000) perKm = (runner.best10000/10) * 1.13;             // 30kmは13%遅
  else perKm = runner.best10000/10;
  // 当日変数: 調子・疲労・spirit + 乱数(やや控えめに)
  const condFx = 1.02 - runner.condition/2000;           // 調子100で1.02-0.05=0.97 (3%速)
  const fatFx  = 1.0 + runner.fatigue/900;                // 疲労100で+11%遅
  // ばらつき: spiritで安定(±約1〜3%)
  const variance = 1.0 + (Math.random()-0.5) * (0.05 - runner.spirit/3500);
  return Math.round(perKm * (dm/1000) * condFx * fatFx * variance);
}
// 出走報酬: 持ちタイム更新 + 能力微上昇 + 疲労
function applyMeetResult(runner, meet, timeSec) {
  // 持ちタイムの保存範囲(秒)。実在の日本人大学生のトップタイム水準に合わせる。
  const PB5 = [790, 1100];     // 5000m: 13:10 〜 18:20
  const PB10 = [1620, 2300];   // 10000m: 27:00 〜 38:20
  // 1レースでのPB更新幅は最大3%まで(現実的な飛躍に揃え、無限に速くなるのを防ぐ)
  // 例: 28:00(1680s)→27:10(1630s)程度の30〜50秒の短縮は学生10000mでよくある。
  const PB_DROP_CAP = 0.97;
  const nr = {...runner};
  if (meet.dist === 5000 && timeSec < nr.best5000) {
    const limited = Math.max(timeSec, Math.round(nr.best5000 * PB_DROP_CAP));
    nr.best5000 = clamp(limited, PB5[0], PB5[1]);
    // 10000も相関で少し更新
    const proj10k = Math.round(nr.best5000 * 2.07);
    if (proj10k < nr.best10000) nr.best10000 = clamp(Math.max(proj10k, Math.round(nr.best10000*PB_DROP_CAP)), PB10[0], PB10[1]);
    nr._newPB = "5000m";
  }
  if (meet.dist === 10000 && timeSec < nr.best10000) {
    const limited = Math.max(timeSec, Math.round(nr.best10000 * PB_DROP_CAP));
    nr.best10000 = clamp(limited, PB10[0], PB10[1]);
    nr._newPB = "10000m";
  }
  if (meet.dist === 21097.5) {
    const proj10k = Math.round(timeSec * (10000/21097.5) / 1.04);
    if (proj10k < nr.best10000) {
      const limited = Math.max(proj10k, Math.round(nr.best10000 * PB_DROP_CAP));
      nr.best10000 = clamp(limited, PB10[0], PB10[1]); nr._newPB="10000m(ハーフ換算)";
    }
  }
  if (meet.dist === 30000) {
    const proj10k = Math.round(timeSec * (10000/30000) / 1.06);
    if (proj10k < nr.best10000) {
      const limited = Math.max(proj10k, Math.round(nr.best10000 * PB_DROP_CAP));
      nr.best10000 = clamp(limited, PB10[0], PB10[1]); nr._newPB="10000m(30km換算)";
    }
  }
  // 能力上昇(伸びしろ係数つき・控えめに)
  const gf = (nr.potential - (nr.speed+nr.stamina+nr.spirit+nr.uphill)/4)/100 * 1.0 + 0.15;
  nr.speed   = clamp(nr.speed   + (meet.gainSpeed||0)  *gf, 0, 99);
  nr.stamina = clamp(nr.stamina + (meet.gainStamina||0)*gf, 0, 99);
  nr.spirit  = clamp(nr.spirit  + (meet.spiritGain||0) *gf, 0, 99);
  nr.fatigue = clamp(nr.fatigue + meet.fatigue, 0, 100);
  return {runner: nr, time: timeSec};
}

/* ---------- 区間戦略(自校のみ・中継所で指示) ---------- */
const STRATEGIES = {
  attack:  {key:"attack", label:"突っ込む", color:"#e5534b",
    desc:"序盤から攻める。好走すれば大きく出るが、つぶれる危険も。",
    mean:-0.012, risk:0.022},   // 平均タイム短縮だが分散大
  balance: {key:"balance",label:"自分のペース", color:"#3fb950",
    desc:"実力どおり。手堅くまとめる。",
    mean:0.0, risk:0.008},
  hold:    {key:"hold",   label:"抑えて入る", color:"#39a0a8",
    desc:"前半抑え、後半勝負。失速は防げるが上振れも小さい。",
    mean:0.004, risk:0.006},
  position:{key:"position",label:"位置取り重視", color:"#e8a838",
    desc:"前後の学校に食らいつく。集団でうまく運べば好走。",
    mean:-0.004, risk:0.012},
};
// 当日の調子(区間ごとに引く隠し変数)
function rollDayForm() {
  // -1(絶不調)〜+1(会心)。中央寄り。
  const r = (Math.random()+Math.random()+Math.random())/3*2-1;
  return r;
}
// その区間の実走タイムを算出(自校は戦略・当日変数込み)
function resolveLegTime(base, spirit, strategyKey, dayForm) {
  const st = STRATEGIES[strategyKey] || STRATEGIES.balance;
  // 当日変数: dayForm が良いほど速い(最大±3%)。spirit高いと悪い日でも崩れにくい。
  const formEffect = -dayForm * 0.03 * (0.7 + (100-spirit)/100*0.5);
  // 戦略の平均効果 + リスク(分散)
  const mean = st.mean;
  const noise = (Math.random()-0.5) * 2 * st.risk;
  // attack/positionは当日不調と噛み合うと「つぶれ」: 下振れ増幅
  let blow = 0;
  if ((strategyKey==="attack"||strategyKey==="position") && dayForm < -0.35) {
    blow = (-dayForm-0.35) * 0.05; // 大きく失速
  }
  const factor = 1 + mean + noise + formEffect + blow;
  return { time: base * Math.max(0.93, factor), dayForm, blow:blow>0 };
}

/* ---------- ペースプロファイル(区間内5km毎の配分) ----------
   確定済み区間タイムを5kmスプリットへ非一様配分する。合計は不変なので
   順位・記録には影響せず、演出(位置の揺れ・つぶれ地点)のみを生む。 */
function buildPaceProfile(dist, total, blow) {
  const marks = [];
  for (let k=5; k<dist-0.01; k+=5) marks.push(k);
  marks.push(dist);
  const segs = marks.map((km,i)=>({from: i===0?0:marks[i-1], to: km}));
  // 距離比の基本配分に±3%のゆらぎ
  let weights = segs.map(s => (s.to-s.from)/dist * (1 + (Math.random()-0.5)*0.06));
  let blowAtKm = null;
  if (blow && segs.length>1) {
    // 後半のどこかで失速: そこ以降の重みを増やす(=遅くなる)
    const half = Math.max(1, Math.floor(segs.length/2));
    const bi = half + Math.floor(Math.random()*(segs.length-half));
    weights = weights.map((w,i)=> i>=bi ? w*1.28 : w*0.96);
    blowAtKm = segs[bi].from;
  }
  const wsum = weights.reduce((a,b)=>a+b,0);
  let acc = 0;
  const checks = segs.map((s,i)=>{ acc += total*weights[i]/wsum; return {km:s.to, t:acc}; });
  return { checks, blowAtKm };
}
// プロファイルに基づく「経過秒→区間内km」変換(区分線形)。profile無しなら等速。
function distAtProfile(profile, elapsed, dist, total) {
  if (elapsed<=0) return 0;
  if (!profile) return dist * Math.min(1, elapsed/total);
  let prevT=0, prevKm=0;
  for (const c of profile.checks) {
    if (elapsed <= c.t) {
      return prevKm + (c.km-prevKm) * (elapsed-prevT)/Math.max(1e-9, c.t-prevT);
    }
    prevT=c.t; prevKm=c.km;
  }
  return dist;
}
// プロファイルに基づく「区間内km→経過秒」変換(distAtProfileの逆関数)
function timeAtDistProfile(profile, d, dist, total) {
  if (d<=0) return 0;
  if (d>=dist) return total;
  if (!profile) return total * d/dist;
  let prevT=0, prevKm=0;
  for (const c of profile.checks) {
    if (d <= c.km) {
      return prevT + (c.t-prevT) * (d-prevKm)/Math.max(1e-9, c.km-prevKm);
    }
    prevT=c.t; prevKm=c.km;
  }
  return total;
}
// 指定anim時点の各校位置・自校とのタイム差・ライブ順位(RoadViewと実況が共用)
// タイム差は「その校の襷が自校の現在地点に到達する時刻 − 現在時刻」(TV中継の◯秒差と同じ定義)。
// 区間開始時点(anim=0)では中継所での通過タイム差そのものになる。
function computeRoadPositions(teams, legTimes, legProfiles, li, anim, myIdx, legDist) {
  const cumStart = (ti)=>{ let s=0; for(let k=0;k<li;k++){const v=legTimes[ti][k]; if(v!=null)s+=v;} return s; };
  const starts = teams.map((_,ti)=>cumStart(ti));
  const myLegT = legTimes[myIdx][li] ?? 1;
  const T = starts[myIdx] + anim * myLegT;
  const myPos = distAtProfile(legProfiles?.[myIdx]?.[li], T - starts[myIdx], legDist, myLegT);
  // タイム差: 正=後方、負=前方
  const gaps = teams.map((t,ti)=>{
    if (ti===myIdx) return 0;
    const lt = legTimes[ti][li];
    // 未解決(ブリーフィング中)は中継所通過タイム差をそのまま表示
    if (lt==null) return starts[ti] - starts[myIdx];
    const reach = starts[ti] + timeAtDistProfile(legProfiles?.[ti]?.[li], myPos, legDist, lt);
    return reach - T;
  });
  // 実際の区間内位置(進捗バー・完走🏁判定用)
  const pos = teams.map((t,ti)=>{
    const lt = legTimes[ti][li];
    if (lt==null) return 0;
    return distAtProfile(legProfiles?.[ti]?.[li], T - starts[ti], legDist, lt);
  });
  const liveRank = 1 + teams.filter((t,ti)=> ti!==myIdx &&
    (gaps[ti] < -1e-9 || (Math.abs(gaps[ti])<=1e-9 && starts[ti]<starts[myIdx]))).length;
  return { starts, T, pos, gaps, myPos, mySecPerKm: myLegT/legDist, liveRank, myLegT };
}
/* 箱根の名所実況(legインデックス0基準 → {km, text}) */
const HAKONE_SPOTS = {
  0:[{km:15, text:"六郷橋を渡る。多摩川を越えれば神奈川"}],
  1:[{km:14, text:"権太坂に差し掛かる。花の2区、正念場"}],
  2:[{km:6,  text:"遊行寺の坂を駆け下りる"},{km:14, text:"湘南の海岸線、正面に富士"}],
  3:[{km:15, text:"酒匂川を渡る。山はもう目前"}],
  4:[{km:7,  text:"函嶺洞門を通過、ここから本格的な登り"},{km:16, text:"国道最高点(874m)。芦ノ湖へ下るのみ"}],
  5:[{km:4,  text:"最高点を越え、一気の山下りへ"},{km:17, text:"小田原の街並みが見えてきた"}],
  6:[{km:9,  text:"二宮の定点を通過"}],
  7:[{km:9,  text:"茅ヶ崎海岸、追い風に乗れるか"}],
  8:[{km:14, text:"権太坂を下る。横浜の街へ"}],
  9:[{km:20, text:"馬場先門を曲がれば大手町はもうすぐ"}],
};
/* 出雲の名所実況 */
const IZUMO_SPOTS = {
  0:[{km:5, text:"神戸川を渡り、出雲平野を駆ける"}],
  2:[{km:5, text:"斐伊川の土手を北上する"}],
  5:[{km:6, text:"浜山公園へ。ゴールの出雲ドームが見えてきた"}],
};
/* 全日本の名所実況 */
const ALLJAPAN_SPOTS = {
  1:[{km:6,  text:"木曽三川を越え、三重県へ"}],
  3:[{km:6,  text:"鈴鹿山脈を遠くに望む"}],
  6:[{km:10, text:"松阪の市街地を駆け抜ける"}],
  7:[{km:12, text:"宮川を渡れば伊勢はもうすぐ"},{km:18, text:"神宮の森が見えた。宇治橋まであと少し"}],
};
const RACE_SPOTS = { hakone: HAKONE_SPOTS, izumo: IZUMO_SPOTS, alljapan: ALLJAPAN_SPOTS };

/* ============================================================
   メインコンポーネント
   ============================================================ */
export default function App() {
  const [screen, setScreen] = useState("title"); // title, hub, squad, train, lineup, race, result, season
  const [teamName, setTeamName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [year, setYear] = useState(1);
  const [week, setWeek] = useState(1);
  const [roster, setRoster] = useState(() => makeRoster());
  const [rivals, setRivals] = useState(() => {
    const names = [...RIVAL_NAMES].sort(()=>Math.random()-0.5);
    // 強1・準強2・中5・下位5 のような勾配で13校(自校と合わせ14校規模)
    const tiers = [0,0,1,1,1,2,2,2,2,3,3,3,3];
    return tiers.map((t,i)=>makeRival(names[i%names.length]+(i>=names.length?"二":""), t))
                .sort((a,b)=>b.strength-a.strength);
  });
  // 練習編成: 各エントリは {menu:string, group:"all"|number[]} を最大3枠まで。
  // groupは "all"(全体) または {gid:"..."} (班参照)。
  // 旧形式(配列スナップショット)は起動時のマイグレーションで {gid} に置換される。
  const [trainings, setTrainings] = useState([
    {menu:"pace", group:"all"},
    {menu:"jog",  group:"all"},
  ]);
  // 保存済みグループ(山班・スピード班など)。gid で安定参照される。
  const [trainingGroups, setTrainingGroups] = useState([]); // [{gid, name, ids:[]}]
  const [titles, setTitles] = useState({izumo:0,alljapan:0,hakone:0}); // 優勝回数
  const [pendingRace, setPendingRace] = useState(null); // raceKey ("izumo"|"alljapan"|"hakone")
  const [lineup, setLineup] = useState({}); // raceKey -> [runnerId per leg]
  const [log, setLog] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  // 高校生スカウト
  const [prospects, setProspects] = useState([]);
  const [scoutEfforts, setScoutEfforts] = useState({});
  const [scoutBudget, setScoutBudget] = useState(0);
  const [scoutResolved, setScoutResolved] = useState(false);
  const [recruited, setRecruited] = useState([]);
  const [scoutResult, setScoutResult] = useState(null);

  // 今季すでに実施したレース/予選を記録(週を過ぎたら締切・二重出走防止)
  const [doneRaces, setDoneRaces] = useState({}); // raceKey -> true
  const [doneYosen, setDoneYosen] = useState(false);
  const [doneMeets, setDoneMeets] = useState({}); // meetKey -> true
  const [lastMeetResult, setLastMeetResult] = useState(null); // 直近の個人レース結果(表示用)
  const [pendingMeet, setPendingMeet] = useState(null); // 出場予定のmeetKey

  // 記録室: 距離別歴代記録 + 駅伝大会アーカイブ
  // distanceRecords[dist] = [{name, grade(0=OB), gradYear, s,a,b(主要3能力値), time, year}] 歴代蓄積
  const [distanceRecords, setDistanceRecords] = useState({5000:[], 10000:[], half:[]});
  // raceArchive[raceKey] = [{year, table:[{rank,name,time,isMe,key}], legStandings:[{leg, rows:[{rank,name,time}]}],
  //                          myLegs:[{leg, runner, grade, time}]}]
  const [raceArchive, setRaceArchive] = useState({izumo:[], alljapan:[], hakone:[]});
  // 前年の区間配置: raceKey -> {year, ids:[区間ごとの走者id]}。同一区間連続担当ボーナスの判定用。
  const [legHistory, setLegHistory] = useState({});
  // schoolLegBests[raceKey][legIndex] = {name, grade, gradeYearLabel, time, year} 自校の区間ベスト(歴代)
  const [schoolLegBests, setSchoolLegBests] = useState({izumo:{}, alljapan:{}, hakone:{}});
  // 箱根シード(前年箱根10位以内の学校key集合)。初年度は実力上位をシード扱い、自校はボーダー外スタート。
  const [hakoneSeeds, setHakoneSeeds] = useState({seeds:[], meSeeded:false});
  const [hakoneEntrants, setHakoneEntrants] = useState(null); // 今年箱根を走る学校配列(予選後に確定)
  const [yosenResult, setYosenResult] = useState(null);

  const addLog = (s) => setLog(l => [{w:week,y:year,s},...l].slice(0,60));

  // 初年度のシード初期化: 実力上位10校をシード、自校はボーダー外(予選会から)。
  useEffect(()=>{
    if (hakoneSeeds.seeds.length===0 && rivals.length>0) {
      const ranked = [...rivals].sort((a,b)=>b.strength-a.strength);
      setHakoneSeeds({ seeds: ranked.slice(0,10).map(r=>r.key) });
    }
  },[]);

  // 旧形式(配列スナップショット)の班参照を {gid} に一度だけマイグレート
  useEffect(()=>{
    // 班に gid を付与
    let needsGroupUpdate = false;
    const migratedGroups = trainingGroups.map(g => {
      if (g.gid) return g;
      needsGroupUpdate = true;
      return {...g, gid:`g${_gid++}`};
    });
    if (needsGroupUpdate) setTrainingGroups(migratedGroups);

    // 練習枠の group が配列なら idsで班マッチして {gid} に変換
    let needsTrainingsUpdate = false;
    const migratedTrainings = trainings.map(t => {
      if (Array.isArray(t.group)) {
        const g = migratedGroups.find(gr => JSON.stringify(gr.ids) === JSON.stringify(t.group));
        if (g) {
          needsTrainingsUpdate = true;
          return {...t, group:{gid: g.gid}};
        } else {
          // 対応する班が見つからない → 全体にフォールバック
          needsTrainingsUpdate = true;
          return {...t, group:"all"};
        }
      }
      return t;
    });
    if (needsTrainingsUpdate) setTrainings(migratedTrainings);
  },[]);

  // ゲーム開始時の能力スナップショット(月次レポートの比較基準)
  useEffect(()=>{
    if (!statsSnapshot && roster.length>0) {
      const snap = {};
      roster.forEach(r => { snap[r.id] = {speed:r.speed, stamina:r.stamina, spirit:r.spirit, uphill:r.uphill,
        best5000:r.best5000, best10000:r.best10000}; });
      setStatsSnapshot(snap);
    }
  },[]);

  // ゲーム開始直後(4月1週)に新年度レポートを表示
  useEffect(()=>{
    if (confirmed && week===1 && !monthlyDelivered[`${year}-1`] && roster.length>0) {
      // 少し遅延して生成(statsSnapshotの初期化が先に走るように)
      const t = setTimeout(()=>generateMonthlyReport(1), 100);
      return ()=>clearTimeout(t);
    }
  },[confirmed, week, year, roster.length]);

  // 1月2週(週38)に到達したら自動的に4年生引退を実行
  // レース結果画面→本部の遷移などadvanceWeekを経由しない経路にも対応
  const [retireFiredYear, setRetireFiredYear] = useState(null);
  useEffect(()=>{
    if (week===38 && retireFiredYear!==year && roster.some(r=>r.grade>=4)) {
      retireSeniors();
      setShowRetirePopup(true);
      setRetireFiredYear(year);
    }
  },[week, year, roster.length]);

  // スカウト週に到達したらプロスペクト一覧と年間予算を生成(年に1回)
  useEffect(()=>{
    if (week>=13 && prospects.length===0 && !scoutResolved) {
      setProspects(makeProspects(15));
      setScoutEfforts({});
      setScoutBudget(100); // 年間100ポイント(=10名×平均10pt 程度の余力)
    }
  },[week, prospects.length, scoutResolved]);

  // 9月3週(週23)にスカウト結果を発表(ポップアップ)。未解決なら自動解決。
  const [showScoutPopup, setShowScoutPopup] = useState(false);
  const [retireInfo, setRetireInfo] = useState(null);          // {year, names:[]} 引退モーダル用
  const [showRetirePopup, setShowRetirePopup] = useState(false);
  // ゲーム開始時のチュートリアルモーダル (1年目の初回のみ)
  const [tutorialShown, setTutorialShown] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  // 本部の初回ヒント (本部に初めて入った時のみ表示、ユーザーが×で閉じたら二度と出ない)
  const [hubHintDismissed, setHubHintDismissed] = useState(false);
  // 月次レポート: { [year-month]: {grew:[], events:[]} } 表示済み記録
  const [monthlyDelivered, setMonthlyDelivered] = useState({});
  const [monthlyReport, setMonthlyReport] = useState(null);    // 表示中のレポート
  // 月跨ぎの能力比較用に「先月初の能力スナップショット」
  const [statsSnapshot, setStatsSnapshot] = useState(null);    // {[runnerId]: {speed, stamina, spirit, uphill, best5000, best10000}}
  const [scoutAnnounced, setScoutAnnounced] = useState(false); // 今季発表済(再表示防止)
  useEffect(()=>{
    if (week===23 && prospects.length>0 && !scoutAnnounced) {
      if (!scoutResolved) resolveScouting();
      setShowScoutPopup(true);
      setScoutAnnounced(true);
    }
  },[week, prospects.length, scoutResolved, scoutAnnounced]);

  /* ---------- 週送り ---------- */
  const advanceWeek = useCallback(() => {
    // 練習適用
    setRoster(prev => prev.map(r => {
      let nr = {...r};
      if (nr.injury > 0) {
        nr.injury = Math.max(0, nr.injury - 1);
        nr.fatigue = clamp(nr.fatigue - 6, 0, 100);
        nr.condition = clamp(nr.condition - 1, 0, 100);
        return nr;
      }
      const ev = weekEvent(week);
      let injChance = 0;
      // 練習適用: 1人あたり最大2メニュー。
      //   班所属 → 班メニュー(集中度×1.1) + 全体枠の1つ目
      //   未所属 → 全体枠を上から2つ
      const groupHit = trainings.find(t => {
        const ids = groupIdsOf(t.group, trainingGroups);
        return ids.length>0 && ids.includes(nr.id);
      });
      const applied = [];
      const allSlots = trainings.filter(t => t.group==="all");
      if (groupHit) {
        applied.push({mk: groupHit.menu, mult: GROUP_BONUS});
        allSlots.slice(0,1).forEach(t => applied.push({mk: t.menu, mult: 1.0}));
      } else {
        allSlots.slice(0,2).forEach(t => applied.push({mk: t.menu, mult: 1.0}));
      }

      // 回復値ファクター: recovery=40で疲労+30%, recovery=95で疲労-30%。
      // 低回復選手はすぐ疲れ、高回復選手は疲れにくい。
      const recF = 1.3 - (nr.recovery-40)/55 * 0.6;

      applied.forEach(({mk, mult}) => {
        const e = MENUS[mk].eff(nr);
        const gf = (nr.potential - effLevel(nr))/100 * 1.0 + 0.15;
        if (e.stamina) nr.stamina = clamp(nr.stamina + e.stamina*gf*mult, 0, 99);
        if (e.speed)   nr.speed   = clamp(nr.speed + e.speed*gf*mult, 0, 99);
        if (e.uphill)  nr.uphill  = clamp(nr.uphill + e.uphill*gf*mult, 0, 99);
        if (e.spirit)  nr.spirit  = clamp(nr.spirit + e.spirit*gf*mult, 0, 99);
        if (e.fatigue) {
          // 正の疲労(練習負荷)は回復値で軽減、休養(負の値)は回復値で増幅
          const scaled = e.fatigue > 0 ? e.fatigue * recF * mult : e.fatigue * (2 - recF);
          nr.fatigue = clamp(nr.fatigue + scaled, 0, 100);
        }
        if (e.cond)    nr.condition = clamp(nr.condition + e.cond, 0, 100);
        if (e.inj)     injChance += e.inj*mult;
      });
      // 毎週の自然な疲労回復(回復値に比例: recovery=40で-0.5, 95で-2.5)
      const naturalRecovery = 0.5 + (nr.recovery-40)/55 * 2.0;
      nr.fatigue = clamp(nr.fatigue - naturalRecovery, 0, 100);
      // 合宿ボーナス(回復値に応じて疲労蓄積も変動)
      if (ev && ev.type==="camp") { nr.stamina=clamp(nr.stamina+0.9,0,99); nr.fatigue=clamp(nr.fatigue+4*recF,0,100); injChance+=0.5; }
      // 調子の自然変動
      nr.condition = clamp(nr.condition + ri(-4,5) - (nr.fatigue>70?4:0), 20, 100);
      // (旧: ここに best5000/10000 を 795-980 / 1640-2030 にclampする処理があったが、
      //  練習でPBが動かなくなった現仕様ではレースで得た速いPBを潰してしまうため削除)
      // 故障判定
      const fatMul = 1 + Math.max(0,nr.fatigue-55)/55;
      if (Math.random()*100 < injChance*fatMul*1.1) {
        nr.injury = ri(2,5);
        nr._justInjured = true;
      } else nr._justInjured = false;
      return nr;
    }));

    const ev = weekEvent(week);
    // 今週に未実施の出走義務があれば、週を進めずに知らせる
    if (ev && ev.type==="race" && !doneRaces[ev.race]) {
      if (ev.race==="hakone") {
        const meSeeded = hakoneSeeds.seeds.includes("me");
        const eligible = meSeeded || (yosenResult && yosenResult.meQualified);
        if (eligible) { addLog("※ 箱根本戦に未出走です。先にレースを行ってください"); return; }
        // 出場資格なしなら素通り(本戦欠場)を許可
      } else {
        addLog(`※ ${RACES[ev.race].name}に未出走です。先にレースを行ってください`); return;
      }
    }
    if (ev && ev.type==="yosen" && !doneYosen) {
      const meSeeded = hakoneSeeds.seeds.includes("me");
      if (!meSeeded) { addLog("※ 箱根予選会に未出走です。先に予選会を行ってください"); return; }
      // シード校は予選不要なので素通り可
    }

    // 故障ログ
    setTimeout(()=>{
      setRoster(cur => {
        cur.forEach(r => { if (r._justInjured) addLog(`⚠ ${r.name} が練習中に故障 (${r.injury}週離脱)`); });
        return cur;
      });
    },0);

    if (week >= 48) {
      // 年度切替: 3月最終週 → 4月1週、進級・新入生入部
      rolloverSeason();
    } else {
      const nextW = week+1;
      // 月次レポート(毎月第1週): 月初は前月の振り返り+今月の予定
      const nextMonthIdx = Math.floor((nextW-1)/4);
      const curMonthIdx = Math.floor((week-1)/4);
      if (nextMonthIdx !== curMonthIdx) {
        // 月跨ぎ: 月次レポート生成
        generateMonthlyReport(nextW);
      }
      // 4年生引退は useEffect(week===38) で発火するためここでは何もしない
      setWeek(nextW);
    }
  }, [week, trainings, trainingGroups, year, doneRaces, doneYosen, doneMeets, hakoneSeeds, yosenResult, roster, statsSnapshot, monthlyDelivered]);

  const effLevel = (r) => Math.round((r.speed+r.stamina+r.spirit+r.uphill)/4);

  // ハーフでの個人想定タイム(予選会用)。type=flat扱い。
  const halfTime = (r) => baseLegSeconds(r, YOSEN.dist, "flat");

  // 予選会を実行 → 結果テーブルと通過校を返し、stateに反映。
  function resolveYosen() {
    const seeds = hakoneSeeds.seeds;        // シード校keyの配列(最大10)。"me"含む可能性あり。
    const meSeeded = seeds.includes("me");
    const field = RACES.hakone.field;        // 箱根本戦の出走校総数(11)
    const slots = field - seeds.length;      // 予選通過枠

    const nonSeedRivals = rivals.filter(r=>!seeds.includes(r.key));

    const teamYosen = (pool, name, key, isMe=false) => {
      const times = pool.filter(r=>r.injury===0).map(halfTime).sort((a,b)=>a-b);
      const top = times.slice(0, YOSEN.countTop);
      const sum = top.reduce((a,b)=>a+b, 0) + (top.length<YOSEN.countTop? (YOSEN.countTop-top.length)*9000 : 0);
      return { name, key, isMe, sum, counted: top.length };
    };

    const entries = [];
    if (!meSeeded) entries.push(teamYosen(roster, teamName, "me", true));
    nonSeedRivals.forEach(rv => entries.push(teamYosen(rv.squad, rv.name, rv.key)));
    entries.sort((a,b)=>a.sum-b.sum);
    const qualifiedKeys = entries.slice(0, slots).map(e=>e.key);
    const meQualified = meSeeded || qualifiedKeys.includes("me");

    // 箱根本戦の出走ライバル(自校以外)
    const racingKeys = [...seeds, ...qualifiedKeys].filter(k=>k!=="me");
    const entrantRivals = rivals.filter(r=>racingKeys.includes(r.key));

    const result = {
      entries: entries.map((e,i)=>({...e, rank:i+1, qualified: qualifiedKeys.includes(e.key)})),
      slots, seedCount: seeds.length, meSeeded, meQualified, entrantRivals,
    };
    setYosenResult(result);
    setDoneYosen(true);
    setHakoneEntrants(entrantRivals);
    addLog(meQualified
      ? (meSeeded? "シード校のため予選免除 — 箱根本戦へ" : "予選会突破 — 箱根本戦へ")
      : "予選会敗退 — 今年の箱根本戦出場ならず");
    return result;
  }

  function ensureHakoneEntrants() {
    if (hakoneEntrants) return hakoneEntrants;
    return resolveYosen().entrantRivals;
  }

  // --- 高校生スカウト: マッチング解決 ---
  // 各プロスペクトについて、競合大学(自校+ライバル)のスカウト圧×親和性で確率重み付け選択。
  // 自校が選ばれたプロスペクトを recruited に追加。シーズン終了処理時に新入生として入学。
  function resolveScouting() {
    if (scoutResolved || prospects.length===0) return {recruited:[], detail:[]};
    const myStrength = teamStrength(roster);
    // プレイヤーの直近練習傾向からスタイルを推定
    const myStyles = new Set();
    trainings.forEach(t => {
      if (t.menu==="intvl") myStyles.add("sprint");
      if (t.menu==="lsd")   myStyles.add("stamina");
      if (t.menu==="hill")  myStyles.add("mountain");
      if (t.menu==="pace")  myStyles.add("balance");
    });
    const myStylesArr = [...myStyles];

    // ライバルのスカウト圧をシミュ(各校のstrengthに応じて狙う対象に重みを撒く)
    const rivalBids = prospects.map(()=>({}));
    rivals.forEach(rv => {
      // 強豪ほど多くポイントを持つ
      const budget = 40 + (rv.strength-65)*2.2;
      // 強豪は上位pot狙い、中堅は中位狙い
      const focus = prospects.slice().sort((a,b)=>{
        if (rv.strength>=82) return b.pot-a.pot;        // 強豪は上から
        if (rv.strength>=72) return Math.abs(75-b.pot)-Math.abs(75-a.pot); // 中堅は中位
        return Math.abs(60-b.pot)-Math.abs(60-a.pot);    // 下位はそれ以下
      });
      let remaining = budget;
      focus.slice(0,8).forEach((p,i) => {
        const give = Math.min(remaining, 6 + (8-i));
        const idx = prospects.findIndex(x=>x.id===p.id);
        rivalBids[idx][rv.key] = (rivalBids[idx][rv.key]||0) + give;
        remaining -= give;
      });
    });

    const recruitedNow = [];
    const detail = prospects.map((p, idx) => {
      const myEffort = scoutEfforts[p.id]||0;
      const myAff = prospectAffinity(p, myStrength, myStylesArr);
      const meScore = myEffort * (1 + myAff/50);
      // ライバル各校のスコア
      const others = Object.entries(rivalBids[idx]).map(([k,v])=>{
        const rv = rivals.find(r=>r.key===k);
        const aff = prospectAffinity(p, rv.strength, []);
        return { key:k, name:rv.name, score: v * (1 + aff/50) };
      });
      const noInterest = Math.max(0, 35 - myEffort - others.reduce((a,o)=>a+o.score,0)/3); // どこも興味なし=他校進学
      const candidates = [
        {key:"me", name:"自校", score: meScore, isMe:true},
        ...others,
        {key:"none", name:"他大学/未進学", score: noInterest, isOther:true},
      ];
      // softmax風選択
      const total = candidates.reduce((a,c)=>a+Math.max(0.01,c.score),0);
      const r = Math.random()*total;
      let acc=0, chosen=candidates[candidates.length-1];
      for (const c of candidates){ acc += Math.max(0.01,c.score); if (r<=acc){chosen=c; break;} }
      if (chosen.isMe) recruitedNow.push(p);
      return { prospect:p, myEffort, myScore:Math.round(meScore), chosen };
    });

    setRecruited(recruitedNow);
    setScoutResolved(true);
    setScoutResult({detail, recruitedCount:recruitedNow.length});
    addLog(`スカウト確定: ${recruitedNow.length}名が来春入学予定`);
    return {recruited:recruitedNow, detail};
  }

  // 月次レポート: 先月の伸び・今月の予定
  function generateMonthlyReport(forWeek) {
    const monthIdx = Math.floor((forWeek-1)/4);
    const monthLabel = ((monthIdx + 3) % 12) + 1;
    const key = `${year}-${forWeek}`;
    if (monthlyDelivered[key]) return;
    // 先月の伸び: snapshot との差分(主要能力値合算)
    let grew = [];
    if (statsSnapshot) {
      grew = roster.map(r => {
        const s = statsSnapshot[r.id];
        if (!s) return null;
        const dSpd = r.speed - s.speed, dSta = r.stamina - s.stamina,
              dSpr = r.spirit - s.spirit, dUph = r.uphill - s.uphill;
        const total = dSpd+dSta+dSpr+dUph;
        return total>0.6 ? {
          name:r.name, grade:r.grade, total: +total.toFixed(1),
          dSpd:+dSpd.toFixed(1), dSta:+dSta.toFixed(1), dSpr:+dSpr.toFixed(1), dUph:+dUph.toFixed(1)
        } : null;
      }).filter(Boolean).sort((a,b)=>b.total-a.total).slice(0,5);
    }
    // 今月の予定: 今月内のweek (monthIdx*4+1 .. +4) のイベントを列挙
    const upcoming = [];
    for (let w=monthIdx*4+1; w<=monthIdx*4+4 && w<=48; w++){
      const ev = weekEvent(w);
      if (!ev) continue;
      let label = "";
      if (ev.type==="race") label = `${RACES[ev.race].name} (${weekLabel(w)})`;
      else if (ev.type==="yosen") label = `箱根予選会 (${weekLabel(w)})`;
      else if (ev.type==="scout") label = `高校生スカウト開始 (${weekLabel(w)})`;
      else if (ev.type==="meet") label = `${MEETS[ev.meet].name} (${weekLabel(w)})`;
      else if (ev.type==="camp") {
        if (w===17) label = `夏合宿スタート (${weekLabel(w)})`;
      } else if (ev.type==="retire") label = `4年生引退 (${weekLabel(w)})`;
      if (label) upcoming.push(label);
    }
    // 故障中の選手
    const injured = roster.filter(r=>r.injury>0).map(r=>`${r.name} (あと${r.injury}週)`);
    // 警告: 疲労蓄積上位
    const tired = roster.filter(r=>r.fatigue>60).sort((a,b)=>b.fatigue-a.fatigue).slice(0,3)
      .map(r=>`${r.name} (疲労${Math.round(r.fatigue)})`);

    setMonthlyReport({ month: monthLabel, year, grew, upcoming, injured, tired });
    setMonthlyDelivered(prev=>({...prev, [key]:true}));
    // 新スナップショット保存(今月の終わりに比較するため)
    const snap = {};
    roster.forEach(r => { snap[r.id] = {speed:r.speed, stamina:r.stamina, spirit:r.spirit, uphill:r.uphill,
      best5000:r.best5000, best10000:r.best10000}; });
    setStatsSnapshot(snap);
  }

  // 1月2週(週38): 4年生引退。記録室でOB化、ロスターから除去、保存オーダーから該当IDを除去。
  function retireSeniors() {
    const seniors = roster.filter(r=>r.grade>=4);
    if (seniors.length===0) return;
    const seniorNames = new Set(seniors.map(r=>r.name));
    const seniorIds = new Set(seniors.map(r=>r.id));
    setDistanceRecords(prev => {
      const mark = (list)=>list.map(e=> seniorNames.has(e.name) && e.grade!==0 ? {...e, grade:0, gradYear:year} : e);
      return {5000:mark(prev[5000]), 10000:mark(prev[10000]), half:mark(prev.half)};
    });
    setRoster(prev => prev.filter(r=>!seniorIds.has(r.id)));
    setLineup(prev => {
      const next = {};
      for (const k of Object.keys(prev)) {
        next[k] = prev[k].map(id => seniorIds.has(id) ? null : id);
      }
      return next;
    });
    setRetireInfo({ year, names: seniors.map(r=>r.name) });
    addLog(`4年生${seniors.length}名が引退`);
  }

  // 3月最終週 → 4月1週切替: 生存選手の進級、新入生(スカウト+一般)入部、ライバル更新、各種state初期化
  function rolloverSeason() {
    // 未解決ならここで自動解決
    let toAdd = recruited;
    if (!scoutResolved && prospects.length>0) {
      const r = resolveScouting();
      toAdd = r.recruited;
    }
    setRoster(prev => {
      // この時点で4年生は既に引退済み(週38で除去)。残りは1-3年生のみ。
      let kept = prev.map(r => ({...r, grade:r.grade+1, fatigue:clamp(r.fatigue-30,0,100), condition:ri(55,75)}));
      toAdd.forEach(p => {
        kept.push({
          id: _uid++, name:p.name, grade:1,
          speed:p.speed, stamina:p.stamina, spirit:p.spirit, uphill:p.uphill,
          recovery: ri(45,90), potential: p.pot,
          best5000: clamp(p.best5000-ri(4,12), 790, 1100),
          best10000: clamp(Math.round((p.best5000-8)*2.07), 1620, 2300),
          condition: ri(58,82), fatigue: ri(8,22), injury: 0, growth: 0,
        });
      });
      // 一般入学
      const general = Math.max(0, ri(5,7) - toAdd.length);
      for (let i=0;i<general;i++) kept.push(makeRunner(1, -6));
      return kept.sort((a,b)=>a.best5000-b.best5000);
    });
    setRivals(prev => prev.map(rv => {
      const squad = rv.squad.map(r=>{
        const d5 = ri(-6,6);
        return {...r, best5000:clamp(r.best5000+d5,790,1100),
                best10000:clamp(r.best10000+d5*2,1620,2300),
                speed:clamp(r.speed+ri(-2,2),38,98), stamina:clamp(r.stamina+ri(-2,2),38,98),
                condition:ri(58,82), fatigue:ri(6,22), injury:0};
      });
      const strength = Math.round(squad.slice(0,8).reduce((a,r)=>a+(r.speed+r.stamina)/2,0)/8);
      return {...rv, squad, strength};
    }));
    setHakoneEntrants(null);
    setYosenResult(null);
    setDoneRaces({});
    setDoneYosen(false);
    setDoneMeets({});
    setLastMeetResult(null);
    setProspects([]); setScoutEfforts({}); setScoutBudget(0);
    setScoutResolved(false); setRecruited([]); setScoutResult(null);
    setShowScoutPopup(false);
    setScoutAnnounced(false);
    setMonthlyDelivered({});
    setYear(y=>y+1); setWeek(1);
    addLog(`── ${year}年目シーズン終了。新年度へ ──`);
    setScreen("season");
  }
  // 互換性のため旧名も残す
  const endSeason = rolloverSeason;

  /* ---------- レース実行 ---------- */
  function startRace(raceKey) {
    const race = RACES[raceKey];
    const lu = lineup[raceKey];
    if (!lu || lu.filter(Boolean).length < race.legs.length || new Set(lu.filter(Boolean)).size < race.legs.length) {
      alert("全区間に異なる選手を配置してください");
      return;
    }
    setScreen("race");
  }

  // 個人レース(meet)出走処理: 選手IDリスト → タイム計算 → 持ちタイム更新・能力上昇・疲労反映
  function runMeet(meetKey, entrantIds) {
    const meet = MEETS[meetKey];
    if (!meet) return;
    const results = [];
    const recordRows = []; // 距離別記録に積むデータ
    setRoster(prev => prev.map(r => {
      if (!entrantIds.includes(r.id)) return r;
      const t = meetTime(r, meet);
      const res = applyMeetResult(r, meet, t);
      results.push({ runnerId:r.id, name:r.name, beforePB:{best5000:r.best5000,best10000:r.best10000},
        time:res.time, newPB: res.runner._newPB, after:{best5000:res.runner.best5000, best10000:res.runner.best10000} });
      // 距離キー: track5k→5000, track10k/long30k→10000, half→half
      const distKey = meet.kind==="track5k"?5000 : meet.kind==="half"?"half" : 10000;
      // 記録室に記録するタイム = applyMeetResult適用後のPB値(現役ランキングのbest値と一致)。
      // これにより「結果画面のタイム」「現役PB」「歴代記録」が齟齬なく同一の数字になる。
      let recordedTime;
      if (distKey === 5000) recordedTime = res.runner.best5000;
      else if (distKey === 10000) recordedTime = res.runner.best10000;
      else /* half */ recordedTime = t; // ハーフは実走タイムを直接記録(別ランキング)
      recordRows.push({ name:r.name, grade:r.grade,
        abilities:[Math.round(res.runner.speed),Math.round(res.runner.stamina),Math.round(res.runner.spirit)],
        time: recordedTime, distKey });
      const nr = {...res.runner}; delete nr._newPB;
      return nr;
    }));
    // 距離別歴代記録へ反映(現役・OB問わず蓄積)
    setDistanceRecords(prev => {
      const next = {5000:prev[5000].slice(), 10000:prev[10000].slice(), half:prev.half.slice()};
      recordRows.forEach(row=>{
        const key = row.distKey;
        next[key] = upsertRecord(next[key], {
          name:row.name, grade:row.grade, gradYear:null,
          abilities:row.abilities, time:row.time, year,
        });
      });
      return next;
    });
    setDoneMeets(prev => ({...prev, [meetKey]:true}));
    results.sort((a,b)=>a.time-b.time);
    setLastMeetResult({meetKey, meet, results});
    addLog(`${meet.short}出走: ${results.length}名 (PB更新 ${results.filter(r=>r.newPB).length}名)`);
    setScreen("meetResult");
  }

  function onRaceComplete(result) {
    setLastResult(result);
    setDoneRaces(prev => ({...prev, [result.raceKey]: true}));
    // タイトル更新
    if (result.myRank === 1) {
      setTitles(t => ({...t, [result.raceKey]: t[result.raceKey]+1}));
      addLog(`🏆 ${RACES[result.raceKey].name} 優勝！`);
    } else {
      addLog(`${RACES[result.raceKey].name} ${result.myRank}位 / ${result.total}校`);
    }
    // 箱根なら翌年シードを確定(総合10位以内)
    if (result.raceKey === "hakone" && result.table) {
      const top10 = result.table.slice(0,10);
      setHakoneSeeds({ seeds: top10.map(r=> r.isMe? "me" : r.key) });
      addLog(`箱根${result.myRank}位 — 翌年${result.myRank<=10?"シード権獲得":"はシード外(予選会)"}`);
    }
    // 使った選手に疲労
    setRoster(prev => prev.map(r => {
      if (result.usedIds.includes(r.id)) return {...r, fatigue:clamp(r.fatigue+34,0,100), condition:clamp(r.condition-8,0,100)};
      return r;
    }));
    // 区間配置の履歴を保存(翌年の同一区間ボーナス判定用)
    setLegHistory(prev => ({...prev, [result.raceKey]: {year, ids: result.usedIds.slice()}}));
    // 記録室: 大会アーカイブに追加
    setRaceArchive(prev => {
      const next = {...prev};
      next[result.raceKey] = [...(prev[result.raceKey]||[]), {
        year,
        myRank: result.myRank, total: result.total,
        myTime: result.myTime,
        table: result.table,
        legStandings: result.legStandings || [],
        myLegs: result.myLegs || [],
      }];
      return next;
    });
    // 記録室: 自校の区間ベスト(歴代)更新
    if (result.myLegs) {
      setSchoolLegBests(prev => {
        const cur = {...(prev[result.raceKey]||{})};
        result.myLegs.forEach((ml,li)=>{
          if (ml.time==null) return;
          const ex = cur[li];
          if (!ex || ml.time < ex.time) {
            cur[li] = { name:ml.name, grade:ml.grade, time:ml.time, year };
          }
        });
        return {...prev, [result.raceKey]: cur};
      });
    }
    setPendingRace(null);
    setScreen("result");
  }

  /* ============================================================ */
  /* レンダリング                                                 */
  /* ============================================================ */
  if (screen === "title") return <Title teamName={teamName} setTeamName={setTeamName}
    onStart={()=>{ if(teamName.trim()){
      setConfirmed(true);
      setScreen("hub");
      // 1年目の最初にだけチュートリアルを開く
      if (!tutorialShown) { setShowTutorial(true); setTutorialShown(true); }
    } }} />;

  // このレースに出走するライバル校(自校以外)を決める。レンダー中はsetStateしない。
  const entrantsForRace = (raceKey) => {
    if (raceKey === "hakone") {
      // 通常はクリック時にensureHakoneEntrantsで確定済み。未確定なら素の計算のみ(state変更なし)。
      if (hakoneEntrants) return hakoneEntrants;
      const seeds = hakoneSeeds.seeds;
      const racingKeys = seeds.filter(k=>k!=="me");
      const seeded = rivals.filter(r=>racingKeys.includes(r.key));
      const fill = rivals.filter(r=>!racingKeys.includes(r.key))
        .sort((a,b)=>b.strength-a.strength).slice(0, Math.max(0, RACES.hakone.field-1-seeded.length));
      return [...seeded, ...fill];
    }
    const n = 7;
    return [...rivals].sort((a,b)=>b.strength-a.strength).slice(0, n);
  };

  if (screen === "race" && pendingRace) {
    const lh = legHistory[pendingRace];
    return <RaceView raceKey={pendingRace} race={RACES[pendingRace]}
      lineup={lineup[pendingRace]} roster={roster} teamName={teamName}
      entrants={entrantsForRace(pendingRace)}
      prevLegIds={lh && lh.year === year-1 ? lh.ids : null}
      onDone={onRaceComplete} />;
  }

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.txt,fontFamily:mono}}>
      <TopBar teamName={teamName} year={year} week={week} titles={titles} />
      {screen==="hub" && <Hub week={week} year={year} trainings={trainings} setTrainings={setTrainings}
        trainingGroups={trainingGroups} setTrainingGroups={setTrainingGroups}
        advanceWeek={advanceWeek} pendingRace={pendingRace} setScreen={setScreen}
        roster={roster} log={log} setPendingRace={setPendingRace} startRace={startRace}
        lineup={lineup} hakoneSeeds={hakoneSeeds} yosenResult={yosenResult}
        doneRaces={doneRaces} doneYosen={doneYosen} doneMeets={doneMeets}
        prospects={prospects} scoutResolved={scoutResolved} recruited={recruited}
        setPendingMeet={setPendingMeet} lastMeetResult={lastMeetResult}
        hubHintDismissed={hubHintDismissed} setHubHintDismissed={setHubHintDismissed}
        onRunYosen={()=>{ resolveYosen(); setScreen("yosen"); }}
        hakoneEntrants={hakoneEntrants} ensureHakoneEntrants={ensureHakoneEntrants} />}
      {screen==="squad" && <Squad roster={roster} effLevel={effLevel}
        trainings={trainings} trainingGroups={trainingGroups} setTrainingGroups={setTrainingGroups}
        setScreen={setScreen} />}
      {screen==="lineup" && pendingRace && <Lineup raceKey={pendingRace} race={RACES[pendingRace]}
        roster={roster} lineup={lineup} setLineup={setLineup}
        entrants={entrantsForRace(pendingRace)} teamName={teamName}
        onBack={()=>setScreen("hub")} onStart={()=>startRace(pendingRace)} />}
      {screen==="meetEntry" && pendingMeet && <MeetEntryScreen meet={MEETS[pendingMeet]} roster={roster}
        onBack={()=>{setPendingMeet(null);setScreen("hub");}}
        onConfirm={(ids)=>{ runMeet(pendingMeet, ids); setPendingMeet(null); }}
        onSkip={()=>{ setDoneMeets(prev=>({...prev,[pendingMeet]:true})); setPendingMeet(null); setScreen("hub"); }}/>}
      {screen==="meetResult" && lastMeetResult && <MeetResultScreen result={lastMeetResult}
        onContinue={()=>setScreen("hub")}/>}
      {screen==="scout" && <ScoutScreen prospects={prospects} scoutEfforts={scoutEfforts}
        setScoutEfforts={setScoutEfforts} scoutBudget={scoutBudget} scoutResolved={scoutResolved}
        scoutResult={scoutResult} myStrength={teamStrength(roster)}
        onResolve={()=>{ resolveScouting(); }} onBack={()=>setScreen("hub")}/>}
      {screen==="yosen" && yosenResult && <YosenScreen result={yosenResult} teamName={teamName}
        onContinue={()=>setScreen("hub")} />}
      {screen==="result" && lastResult && <Result result={lastResult}
        onContinue={()=>{ setScreen("hub"); if(week>=48){endSeason();} else setWeek(w=>w+1); }} />}
      {screen==="training" && <TrainingRoom trainings={trainings} setTrainings={setTrainings}
        trainingGroups={trainingGroups} setTrainingGroups={setTrainingGroups}
        roster={roster} onBack={()=>setScreen("hub")} />}
      {screen==="records" && <RecordsRoom roster={roster} distanceRecords={distanceRecords}
        raceArchive={raceArchive} schoolLegBests={schoolLegBests} year={year}
        onBack={()=>setScreen("hub")} />}
      {screen==="season" && <SeasonScreen year={year} titles={titles} roster={roster}
        onContinue={()=>setScreen("hub")} />}
      <BottomNav screen={screen} setScreen={setScreen} pendingRace={pendingRace} />
      {showScoutPopup && scoutResult && (
        <ScoutPopup result={scoutResult} onClose={()=>setShowScoutPopup(false)}
          onSeeAll={()=>{ setShowScoutPopup(false); setScreen("scout"); }}/>
      )}
      {monthlyReport && (
        <MonthlyReportPopup report={monthlyReport} onClose={()=>setMonthlyReport(null)}/>
      )}
      {showRetirePopup && retireInfo && (
        <RetirePopup info={retireInfo} onClose={()=>setShowRetirePopup(false)}/>
      )}
      {showTutorial && (
        <TutorialPopup teamName={teamName} onClose={()=>setShowTutorial(false)}/>
      )}
    </div>
  );
}

/* ---------- effLevel 外部用 ---------- */
function effLevel(r){return Math.round((r.speed+r.stamina+r.spirit+r.uphill)/4);}

/* ============================================================
   タイトル画面
   ============================================================ */
function Title({teamName,setTeamName,onStart}) {
  return (
    <div style={{minHeight:"100vh",background:`radial-gradient(120% 80% at 50% 0%, #14203a 0%, ${C.bg} 60%)`,
      color:C.txt,fontFamily:mono,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"32px 22px"}}>
      <div style={{fontFamily:serif,fontSize:13,letterSpacing:6,color:C.gold,marginBottom:10}}>大学陸上 駅伝監督</div>
      <div style={{fontFamily:serif,fontSize:52,fontWeight:700,letterSpacing:4,lineHeight:1,
        background:`linear-gradient(180deg,#fff,${C.gold})`,WebkitBackgroundClip:"text",
        WebkitTextFillColor:"transparent",marginBottom:6}}>襷 繋</div>
      <div style={{fontSize:11,color:C.sub,letterSpacing:2,marginBottom:34}}>TASUKI — 三冠への道</div>

      <div style={{display:"flex",gap:8,marginBottom:30}}>
        {[["出雲",C.cyan],["全日本",C.gold],["箱根",C.blue]].map(([t,c])=>(
          <div key={t} style={{border:`1px solid ${c}`,color:c,borderRadius:6,
            padding:"6px 12px",fontSize:11,letterSpacing:1}}>{t}</div>
        ))}
      </div>

      <div style={{width:"100%",maxWidth:340}}>
        <label style={{fontSize:10,color:C.sub,letterSpacing:1}}>監督就任する大学名</label>
        <input value={teamName} onChange={e=>setTeamName(e.target.value)}
          placeholder="例：襷大学"
          onKeyDown={e=>{if(e.key==="Enter")onStart();}}
          style={{width:"100%",marginTop:7,marginBottom:18,background:C.panel,
          border:`1px solid ${C.line}`,borderRadius:8,padding:"13px 14px",
          color:C.txt,fontFamily:serif,fontSize:18,outline:"none",boxSizing:"border-box"}} />
        <button onClick={onStart} disabled={!teamName.trim()}
          style={{width:"100%",padding:"14px",borderRadius:8,border:"none",
          background: teamName.trim()? `linear-gradient(90deg,${C.gold},${C.amber})`:"#2a2f37",
          color: teamName.trim()? "#111":"#666",fontFamily:mono,fontWeight:700,
          fontSize:14,letterSpacing:2,cursor:teamName.trim()?"pointer":"default"}}>
          就 任 す る
        </button>
      </div>
      <div style={{marginTop:40,fontSize:10,color:C.dim,textAlign:"center",lineHeight:1.7}}>
        1月1週から12月最終週まで週単位で進行。<br/>練習を組み、選手を育て、三大駅伝の三冠を狙う。
      </div>
    </div>
  );
}

/* ============================================================
   トップバー
   ============================================================ */
function TopBar({teamName,year,week,titles}) {
  return (
    <div style={{position:"sticky",top:0,zIndex:20,background:C.panel,
      borderBottom:`1px solid ${C.line}`,padding:"10px 14px",display:"flex",
      alignItems:"center",justifyContent:"space-between"}}>
      <div>
        <div style={{fontFamily:serif,fontSize:18,fontWeight:700,lineHeight:1.15}}>{teamName}</div>
        <div style={{marginTop:5,display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontSize:12,color:C.gold,fontWeight:700,fontFamily:mono,
            background:C.panel2,padding:"2px 7px",borderRadius:4,border:`1px solid ${C.gold}55`}}>
            {year}年目</span>
          <span style={{fontSize:13,color:C.txt,fontWeight:700,fontFamily:mono,letterSpacing:0.5}}>
            {weekLabel(week)}</span>
        </div>
      </div>
      <div style={{display:"flex",gap:6}}>
        {[["出雲",titles.izumo,C.cyan],["全",titles.alljapan,C.gold],["箱",titles.hakone,C.blue]].map(([t,v,c])=>(
          <div key={t} style={{textAlign:"center",minWidth:34,background:C.panel2,
            border:`1px solid ${v>0?c:C.line}`,borderRadius:5,padding:"3px 4px"}}>
            <div style={{fontSize:10,color:C.sub}}>{t}</div>
            <div style={{fontSize:13,fontWeight:700,color:v>0?c:C.dim}}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   ハブ(週の進行)
   ============================================================ */
function Hub({week,year,trainings,setTrainings,trainingGroups,setTrainingGroups,advanceWeek,pendingRace,setScreen,roster,log,setPendingRace,startRace,lineup,hakoneSeeds,yosenResult,doneRaces,doneYosen,doneMeets,prospects,scoutResolved,recruited,setPendingMeet,lastMeetResult,hubHintDismissed,setHubHintDismissed,onRunYosen,hakoneEntrants,ensureHakoneEntrants}) {
  const ev = weekEvent(week);
  const meSeeded = hakoneSeeds?.seeds?.includes("me");
  const hakoneEligible = meSeeded || (yosenResult && yosenResult.meQualified);
  const healthy = roster.filter(r=>r.injury===0).length;
  const injured = roster.length - healthy;

  return (
    <div style={{padding:"14px 14px 90px"}}>
      {/* 初回ヒント (未閉じ時のみ表示、×で永続的に非表示化) */}
      {!hubHintDismissed && (
        <div style={{padding:"11px 13px",background:C.panel,border:`1px solid ${C.gold}55`,
          borderRadius:9,marginBottom:12,position:"relative"}}>
          <button onClick={()=>setHubHintDismissed(true)}
            style={{position:"absolute",top:6,right:8,background:"none",border:"none",
            color:C.dim,fontSize:16,cursor:"pointer",lineHeight:1}}>×</button>
          <div style={{fontSize:11,color:C.gold,fontWeight:700,marginBottom:5}}>💡 本部の使い方</div>
          <div style={{fontSize:10.5,color:C.sub,lineHeight:1.6}}>
            <b style={{color:C.txt}}>今週のイベント</b>(大会・記録会)を確認し、<b style={{color:C.txt}}>練習編成</b>を見直したら<b style={{color:C.green}}>次の週へ進む</b>で時間が動きます。<br/>
            月初には<b style={{color:C.cyan}}>主務からの月次レポート</b>、大会前には<b style={{color:C.amber}}>エントリー画面</b>が自動で開きます。<br/>
            画面下部の<b style={{color:C.gold}}>編成室</b>で班や練習の詳細を、<b style={{color:C.gold}}>記録室</b>で歴代記録を確認できます。</div>
        </div>
      )}
      {/* 年間カレンダー (現在週を強調表示) */}
      <YearCalendar week={week}/>
      {/* 今週のイベント */}
      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:14,marginBottom:14}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:1,marginBottom:6}}>{weekLabel(week)} の予定</div>
        {ev && ev.type==="yosen" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:YOSEN.color}}>▶ {YOSEN.name}</div>
            {meSeeded ? (
              <>
                <div style={{fontSize:11,color:C.green,marginTop:6}}>● 自校は前年シード校 — 予選は免除されます</div>
                <div style={{fontSize:10,color:C.sub,marginTop:4}}>箱根本戦にそのまま出場できます。</div>
              </>
            ) : (
              <>
                <div style={{fontSize:10,color:C.sub,marginTop:4}}>
                  前年箱根10位以内に入れなかったため、予選会から。各校上位{YOSEN.countTop}名のハーフ合計で競い、上位校のみ本戦へ。</div>
                {!yosenResult && <button onClick={onRunYosen} style={btn(YOSEN.color)}>予選会に出場する →</button>}
                {yosenResult && <div style={{marginTop:10,fontSize:13,fontWeight:700,
                  color:yosenResult.meQualified?C.green:C.red}}>
                  {yosenResult.meQualified? "✓ 予選通過 — 本戦へ":"✗ 予選敗退 — 本戦出場ならず"}
                  <button onClick={()=>setScreen("yosen")} style={{...btn(C.panel2),color:YOSEN.color,border:`1px solid ${YOSEN.color}`}}>予選結果を見る</button>
                </div>}
              </>
            )}
          </div>
        ) : ev && ev.type==="race" && ev.race==="hakone" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.blue}}>▶ {RACES.hakone.name}</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>{RACES.hakone.legs.length}区間 ・ 全{RACES.hakone.legs.reduce((a,l)=>a+l.dist,0).toFixed(1)}km ・ {RACES.hakone.field}校</div>
            {doneRaces.hakone ? (
              <div style={{marginTop:10,fontSize:13,fontWeight:700,color:C.green}}>✓ 本戦は実施済み
                <button onClick={()=>setScreen("result")} style={{...btn(C.panel2),color:C.blue,border:`1px solid ${C.blue}`}}>結果を見る</button></div>
            ) : hakoneEligible ? (
              <button onClick={()=>{ensureHakoneEntrants(); setPendingRace("hakone"); setScreen("lineup");}}
                style={btn(C.blue)}>{meSeeded?"シード校として出場 ":""}区間オーダーを組む →</button>
            ) : (
              <div style={{marginTop:10,fontSize:12,color:C.red}}>
                予選を通過していないため、今年の本戦には出場できません。来週へ進んでください。</div>
            )}
          </div>
        ) : ev && ev.type==="race" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:RACES[ev.race].color}}>
              ▶ {RACES[ev.race].name}</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>{RACES[ev.race].legs.length}区間 ・ 全{RACES[ev.race].legs.reduce((a,l)=>a+l.dist,0).toFixed(1)}km</div>
            {doneRaces[ev.race] ? (
              <div style={{marginTop:10,fontSize:13,fontWeight:700,color:C.green}}>✓ 実施済み
                <button onClick={()=>setScreen("result")} style={{...btn(C.panel2),color:RACES[ev.race].color,border:`1px solid ${RACES[ev.race].color}`}}>結果を見る</button></div>
            ) : (
              <button onClick={()=>{setPendingRace(ev.race);setScreen("lineup");}}
                style={btn(RACES[ev.race].color)}>区間オーダーを組む →</button>
            )}
          </div>
        ) : ev && ev.type==="scout" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.purple}}>▶ 高校生スカウト開始</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>
              来年度入学候補の高校3年生15名がリストアップされました。年末までに各候補へポイントを配分し、競合校との競争に勝てば来春1年生として迎えられます。</div>
            <button onClick={()=>setScreen("scout")} style={btn(C.purple)}>スカウト名簿を開く →</button>
          </div>
        ) : ev && ev.type==="meet" ? (() => {
          const meet = MEETS[ev.meet];
          const done = doneMeets[ev.meet];
          return (
            <div>
              <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:meet.color}}>▶ {meet.name}</div>
              <div style={{fontSize:10,color:C.sub,marginTop:4}}>{meet.dist>=1000?meet.dist/1000:meet.dist}{meet.dist>=1000?"km":"m"} ・ 任意エントリー</div>
              <div style={{fontSize:10.5,color:C.dim,marginTop:4,lineHeight:1.4}}>{meet.desc}</div>
              {done ? (
                <div style={{marginTop:10,fontSize:13,fontWeight:700,color:C.green}}>✓ 出場済 / 不参加
                  {lastMeetResult && lastMeetResult.meetKey===ev.meet && (
                    <button onClick={()=>setScreen("meetResult")} style={{...btn(C.panel2),color:meet.color,border:`1px solid ${meet.color}`}}>結果を見る</button>
                  )}
                </div>
              ) : (
                <button onClick={()=>{setPendingMeet(ev.meet); setScreen("meetEntry");}}
                  style={btn(meet.color)}>エントリー画面を開く →</button>
              )}
            </div>
          );
        })()
        : ev && ev.type==="camp" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:C.amber}}>● 夏合宿</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>スタミナが伸びやすいが疲労・故障に注意。</div>
          </div>
        ) : ev && ev.type==="retire" ? (
          <div>
            <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:C.gold}}>● 4年生引退</div>
            <div style={{fontSize:10,color:C.sub,marginTop:4}}>箱根を終えた4年生がチームを離れます。</div>
          </div>
        ) : (
          <div style={{fontFamily:serif,fontSize:18,color:C.txt}}>通常週 — 練習に集中</div>
        )}
        <div style={{display:"flex",gap:14,marginTop:10,fontSize:10,color:C.sub,flexWrap:"wrap"}}>
          <span>在籍 {roster.length}名</span>
          <span style={{color:C.green}}>稼働 {healthy}</span>
          {injured>0 && <span style={{color:C.red}}>故障 {injured}</span>}
          <span style={{color: meSeeded?C.blue:C.sub}}>箱根: {meSeeded?"シード校":"予選会から"}</span>
          {prospects.length>0 && <span style={{color:C.purple}}>スカウト: {scoutResolved?`確定${recruited.length}名`:`進行中`}</span>}
        </div>
      </div>

      {/* スカウト常設パネル(候補が出てから) */}
      {prospects.length>0 && (
        <button onClick={()=>setScreen("scout")} style={{width:"100%",marginBottom:14,padding:"11px 14px",
          background:C.panel,border:`1px solid ${C.purple}66`,borderRadius:9,color:C.txt,
          textAlign:"left",cursor:"pointer",display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:18,color:C.purple}}>🎓</div>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700}}>高校生スカウト</div>
            <div style={{fontSize:10,color:C.sub,marginTop:2}}>
              {scoutResolved? `今春入学予定 ${recruited.length}名 確定済`
                            : `候補${prospects.length}名 — 年末までに配分を決める`}</div>
          </div>
          <div style={{fontSize:14,color:C.purple}}>›</div>
        </button>
      )}

      {/* 練習編成 サマリー (詳細は編成室へ) */}
      <button onClick={()=>setScreen("training")}
        style={{width:"100%",background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,
        padding:"12px 14px",marginBottom:14,cursor:"pointer",textAlign:"left",
        display:"flex",alignItems:"center",gap:12}}>
        <div style={{fontSize:20}}>🧭</div>
        <div style={{flex:1}}>
          <div style={{fontSize:11,color:C.txt,fontWeight:700,letterSpacing:1}}>今週の練習編成</div>
          <div style={{fontSize:10,color:C.sub,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
            {trainings.map((t,i)=>{
              const m = MENUS[t.menu];
              const rg = resolveGroup(t.group, trainingGroups);
              const gname = rg.kind==="all" ? "全体" :
                            rg.kind==="group" ? rg.g.name : "―";
              return (
                <span key={i} style={{display:"inline-flex",alignItems:"center",gap:3}}>
                  <span style={{width:6,height:6,borderRadius:2,background:m.color,display:"inline-block"}}/>
                  <span>{m.label} <span style={{color:C.dim}}>({gname})</span></span>
                </span>
              );
            })}
            {trainings.length===0 && <span style={{color:C.red}}>未設定</span>}
          </div>
          <div style={{fontSize:10,color:C.dim,marginTop:3,display:"flex",gap:8,flexWrap:"wrap"}}>
            {trainingGroups.map(g=>(
              <span key={g.gid}><span style={{color:C.cyan}}>●</span> {g.name}{g.ids.length}名</span>
            ))}
            {(()=>{
              const inG = new Set();
              trainingGroups.forEach(g=>g.ids.forEach(id=>inG.add(id)));
              const freeN = roster.filter(r=>!inG.has(r.id) && r.injury===0).length;
              return <span style={{color:C.dim}}>未所属 {freeN}名</span>;
            })()}
          </div>
        </div>
        <div style={{fontSize:14,color:C.sub}}>›</div>
      </button>

      {/* 週送りボタン */}
      <button onClick={advanceWeek}
        style={{width:"100%",padding:"15px",borderRadius:10,border:"none",
        background:`linear-gradient(90deg,${C.green},#2f9c43)`,color:"#06210d",
        fontFamily:mono,fontWeight:700,fontSize:15,letterSpacing:2,cursor:"pointer",marginBottom:14}}>
        {week>=48 ? "▷ シーズンを終える（進級・卒業）" : `▷ 次の週へ進む（${weekLabel(week+1)}）`}
      </button>

      {/* ログ */}
      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:"10px 14px"}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:1,marginBottom:6}}>活動ログ</div>
        <div style={{maxHeight:150,overflowY:"auto"}}>
          {log.length===0 && <div style={{fontSize:10,color:C.dim}}>まだ記録はありません</div>}
          {log.map((l,i)=>(
            <div key={i} style={{fontSize:10,color:C.sub,padding:"3px 0",borderBottom:`1px solid #1a2029`,lineHeight:1.4}}>
              <span style={{color:C.dim,marginRight:6}}>{l.y}-{weekLabel(l.w)}</span>{l.s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
const btn = (color)=>({width:"100%",marginTop:10,padding:"11px",borderRadius:8,border:"none",
  background:color,color:"#0b0f14",fontFamily:mono,fontWeight:700,fontSize:13,
  letterSpacing:1,cursor:"pointer"});

function chipStyle(on, color) {
  return {padding:"4px 9px",fontSize:10,borderRadius:5,
    border:`1px solid ${on?color:C.line}`,background:on?color+"22":C.panel,
    color:on?color:C.sub,cursor:"pointer"};
}



/* ============================================================
   選手一覧
   ============================================================ */
function Squad({roster,effLevel,trainings,trainingGroups,setTrainingGroups,setScreen}) {
  const [sort,setSort] = useState("ovr");
  const [sel,setSel] = useState(null);
  const [chipOpen,setChipOpen] = useState(null); // 班選択チップを開いている runnerId
  const [newGroupName,setNewGroupName] = useState("");

  const sorted = useMemo(()=>{
    const a=[...roster];
    if(sort==="ovr") a.sort((x,y)=>effLevel(y)-effLevel(x));
    if(sort==="5000") a.sort((x,y)=>x.best5000-y.best5000);
    if(sort==="grade") a.sort((x,y)=>y.grade-x.grade || effLevel(y)-effLevel(x));
    if(sort==="fat") a.sort((x,y)=>y.fatigue-x.fatigue);
    return a;
  },[roster,sort,effLevel]);

  // 選手を班に移動(単一所属)
  const moveToGroup = (runnerId, targetIdx) => {
    setTrainingGroups(prev => {
      const next = prev.map(g => ({...g, ids: g.ids.filter(id=>id!==runnerId)}));
      if (targetIdx!=null && targetIdx>=0 && targetIdx<next.length) {
        next[targetIdx] = {...next[targetIdx], ids:[...next[targetIdx].ids, runnerId]};
      }
      return next;
    });
    setChipOpen(null);
  };
  const createGroupWith = (runnerId, name) => {
    const cleanName = (name||"").trim() || "新しい班";
    setTrainingGroups(prev => {
      const withoutMe = prev.map(g => ({...g, ids: g.ids.filter(id=>id!==runnerId)}));
      return [...withoutMe, { gid:`g${_gid++}`, name: cleanName, ids:[runnerId] }];
    });
    setChipOpen(null); setNewGroupName("");
  };

  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["ovr","総合"],["5000","5000m"],["grade","学年"],["fat","疲労"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSort(k)} style={{flex:1,padding:"7px",borderRadius:7,
            border:`1px solid ${sort===k?C.gold:C.line}`,background:sort===k?C.panel2:C.panel,
            color:sort===k?C.gold:C.sub,fontSize:11,fontFamily:mono,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {sorted.map(r=>{
          const currentGroupIdx = memberOfGroup(r.id, trainingGroups);
          const currentGroup = currentGroupIdx>=0? trainingGroups[currentGroupIdx] : null;
          const menus = runnerAssignments(r.id, trainings, trainingGroups);
          return (
            <div key={r.id}
              style={{background:C.panel,border:`1px solid ${r.injury>0?C.red+"66":C.line}`,
              borderRadius:9,padding:"10px 12px"}}>
              {/* 上段: 学年・名前・PB */}
              <div onClick={()=>setSel(sel===r.id?null:r.id)}
                style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:9}}>
                  <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
                    borderRadius:4,padding:"2px 5px",fontWeight:700}}>{r.grade}年</span>
                  <span style={{fontFamily:serif,fontSize:16,fontWeight:700}}>{r.name}</span>
                  {r.injury>0 && <span style={{fontSize:10,color:C.red}}>故障{r.injury}w</span>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.sub}}>5000m</div>
                  <div style={{fontSize:14,fontWeight:700,color:C.gold}}>{fmtTime(r.best5000)}</div>
                </div>
              </div>
              {/* 今週の練習バッジ + 班チップ */}
              <div style={{display:"flex",alignItems:"center",gap:5,marginTop:8,flexWrap:"wrap"}}>
                {r.injury>0 ? (
                  <span style={{fontSize:10,color:C.dim,fontStyle:"italic"}}>今週: 故障離脱中</span>
                ) : menus.length===0 ? (
                  <span style={{fontSize:10,color:C.dim}}>今週: 練習なし</span>
                ) : (
                  menus.map((a,i)=>(
                    <span key={i} style={{fontSize:10,padding:"2px 6px",borderRadius:4,
                      border:`1px solid ${a.menu.color}66`,color:a.menu.color,
                      background:a.menu.color+"11"}}>
                      <span style={{fontWeight:700}}>● {a.menu.label}</span>
                      {a.via==="group" && <span style={{color:C.dim,marginLeft:3}}>{a.groupName}×1.1</span>}
                    </span>
                  ))
                )}
                <button onClick={()=>setChipOpen(chipOpen===r.id?null:r.id)}
                  style={{marginLeft:"auto",background:C.panel2,border:`1px solid ${C.cyan}66`,
                  borderRadius:5,padding:"3px 7px",fontSize:10,color:C.cyan,cursor:"pointer"}}>
                  🎯 {currentGroup? currentGroup.name : "全体"} ▽</button>
              </div>
              {/* 班選択チップ展開 */}
              {chipOpen===r.id && (
                <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.line}`}}>
                  <div style={{fontSize:10,color:C.sub,marginBottom:5}}>所属する班を選択</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:6}}>
                    <button onClick={()=>moveToGroup(r.id, null)}
                      style={chipStyle(currentGroupIdx<0, C.sub)}>全体</button>
                    {trainingGroups.map((g,gi)=>(
                      <button key={g.gid} onClick={()=>moveToGroup(r.id, gi)}
                        style={chipStyle(currentGroupIdx===gi, C.cyan)}>
                        {g.name}({g.ids.length})</button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:5}}>
                    <input value={newGroupName} onChange={e=>setNewGroupName(e.target.value)}
                      placeholder="+新規班名"
                      style={{flex:1,background:C.panel2,border:`1px solid ${C.line}`,borderRadius:5,
                      padding:"5px 8px",color:C.txt,fontFamily:serif,fontSize:11,boxSizing:"border-box"}}/>
                    <button onClick={()=>{if(newGroupName.trim()){createGroupWith(r.id, newGroupName);}}}
                      disabled={!newGroupName.trim()}
                      style={{padding:"5px 10px",borderRadius:5,border:"none",
                      background:newGroupName.trim()?C.amber:"#2a2f37",
                      color:newGroupName.trim()?"#111":"#666",fontSize:10,fontWeight:700,
                      cursor:newGroupName.trim()?"pointer":"default"}}>作成</button>
                  </div>
                </div>
              )}
              {/* バー */}
              <div onClick={()=>setSel(sel===r.id?null:r.id)}
                style={{display:"flex",gap:5,marginTop:9,cursor:"pointer"}}>
                {[["SPD",r.speed,C.red],["STA",r.stamina,C.cyan],["勝負",r.spirit,C.amber],["山",r.uphill,C.purple]].map(([l,v,c])=>(
                  <div key={l} style={{flex:1}}>
                    <div style={{fontSize:10,color:C.dim,marginBottom:2}}>{l} {sel===r.id? v.toFixed(1) : Math.round(v)}</div>
                    <div style={{height:4,background:"#11161d",borderRadius:2}}>
                      <div style={{height:"100%",width:`${v}%`,background:c,borderRadius:2}}/>
                    </div>
                  </div>
                ))}
              </div>
              {sel===r.id && (
                <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.line}`,
                  display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:10}}>
                  <Stat label="10000m" v={fmtTime(r.best10000)} c={C.gold}/>
                  <Stat label="5000ペース" v={pace(r.best5000)+"/km"} c={C.sub}/>
                  <Stat label="回復力" v={Math.round(r.recovery)} c={C.green}/>
                  <Stat label="調子" v={Math.round(r.condition)} c={condColor(r.condition)}/>
                  <Stat label="疲労" v={Math.round(r.fatigue)} c={r.fatigue>65?C.red:C.sub}/>
                  <Stat label="潜在" v={"★".repeat(clamp(Math.round(r.potential/20),1,5))} c={C.purple}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* 編成室へのショートカット */}
      <button onClick={()=>setScreen("training")}
        style={{width:"100%",marginTop:14,padding:"11px",borderRadius:9,border:`1px solid ${C.line}`,
        background:C.panel,color:C.sub,fontFamily:mono,fontSize:12,cursor:"pointer"}}>
        🧭 編成室で練習を組む</button>
    </div>
  );
}
function Stat({label,v,c}){return(<div><div style={{fontSize:10,color:C.dim}}>{label}</div><div style={{fontSize:13,fontWeight:700,color:c||C.txt}}>{v}</div></div>);}
const gradeColor=(g)=>["#888",C.green,C.cyan,C.amber,C.red][g];
const condColor=(c)=>c>75?C.green:c>50?C.amber:C.red;

/* ---------- 記録室ユーティリティ ---------- */
// 能力値→ランク(S/A/B/C/D)。画像のように S90 等で表示。
function rankOf(v){
  if (v>=90) return {r:"S", c:"#ff5fa2"};   // ピンク
  if (v>=80) return {r:"A", c:"#ff5fa2"};   // ピンク(A also magenta in source)
  if (v>=70) return {r:"B", c:C.red};
  if (v>=60) return {r:"C", c:C.amber};
  return {r:"D", c:C.dim};
}
// 選手の主要3能力(speed/stamina/spirit)をランク表示用に
function topAbilities(r){
  return [r.speed, r.stamina, r.spirit].map(v=>({v:Math.round(v), ...rankOf(v)}));
}
// distanceRecordsへPBを蓄積(同名は速い方を残す)
function upsertRecord(list, entry){
  const i = list.findIndex(x=>x.name===entry.name);
  if (i<0) return [...list, entry].sort((a,b)=>a.time-b.time).slice(0,50);
  if (entry.time < list[i].time){ const next=list.slice(); next[i]=entry; return next.sort((a,b)=>a.time-b.time).slice(0,50); }
  return list;
}

/* ============================================================
   区間オーダー編成
   ============================================================ */
function Lineup({raceKey,race,roster,lineup,setLineup,entrants,teamName,onBack,onStart}) {
  const cur = lineup[raceKey] || new Array(race.legs.length).fill(null);
  const [picking,setPicking] = useState(null); // leg index
  const [tab,setTab] = useState("order");       // order | scout
  const [openSchool,setOpenSchool] = useState(null);
  const set = (legIdx, runnerId) => {
    const next = [...cur];
    // 重複排除
    const dup = next.indexOf(runnerId);
    if (dup>=0) next[dup]=null;
    next[legIdx]=runnerId;
    setLineup({...lineup,[raceKey]:next});
    setPicking(null);
  };
  const auto = () => {
    // 各区間タイプに合う選手を貪欲割当
    const avail = roster.filter(r=>r.injury===0).slice();
    const assign = new Array(race.legs.length).fill(null);
    // 区間を重要度(距離)順で
    const order = race.legs.map((l,i)=>i).sort((a,b)=>race.legs[b].dist-race.legs[a].dist);
    order.forEach(i=>{
      const l=race.legs[i];
      let best=null,bs=1e9;
      avail.forEach(r=>{
        const t=baseLegSeconds(r,l.dist,l.type);
        if(t<bs){bs=t;best=r;}
      });
      if(best){assign[i]=best.id; avail.splice(avail.indexOf(best),1);}
    });
    setLineup({...lineup,[raceKey]:assign});
  };
  const filled = cur.filter(Boolean).length;
  const used = new Set(cur.filter(Boolean));

  // 自校(現オーダー or 自動最適)と各対戦校の想定総合タイムを算出して順位表示
  const myProjTime = (() => {
    // 配置済みは実際の選手、未配置は最適補完で概算
    const assigned = cur.map((id,i)=> id? baseLegSeconds(roster.find(r=>r.id===id),race.legs[i].dist,race.legs[i].type):null);
    if (assigned.every(Boolean)) return assigned.reduce((a,b)=>a+b,0);
    return projectedTeamTime(roster, race.legs);
  })();
  const scout = useMemo(()=>{
    const rows = [{name:teamName, isMe:true, key:"me",
      total: projectedTeamTime(roster, race.legs),
      lineup: buildLineup(roster, race.legs)}];
    entrants.forEach((rv,idx)=>{
      rows.push({name:rv.name, isMe:false, key:rv.key, color:rivalColor(idx),
        strength:rv.strength,
        total: projectedTeamTime(rv.squad, race.legs),
        lineup: buildLineup(rv.squad, race.legs)});
    });
    rows.sort((a,b)=>a.total-b.total);
    return rows;
  },[entrants]);

  if (picking!==null) {
    const l = race.legs[picking];
    const avail = roster.filter(r=>r.injury===0)
      .map(r=>({r,t:baseLegSeconds(r,l.dist,l.type)}))
      .sort((a,b)=>a.t-b.t);
    return (
      <div style={{padding:"14px 14px 90px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <button onClick={()=>setPicking(null)} style={backBtn}>←</button>
          <div>
            <div style={{fontFamily:serif,fontSize:18,fontWeight:700}}>{picking+1}区 の選手選択</div>
            <div style={{fontSize:10,color:C.sub}}>{l.dist}km ・ {TYPE_LABEL[l.type]}（推定タイム順）</div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {avail.map(({r,t})=>{
            const isUsed = used.has(r.id) && cur[picking]!==r.id;
            return(
              <button key={r.id} onClick={()=>set(picking,r.id)}
                style={{textAlign:"left",background:cur[picking]===r.id?C.panel2:C.panel,
                border:`1px solid ${cur[picking]===r.id?race.color:isUsed?C.amber+"55":C.line}`,
                borderRadius:8,padding:"10px 12px",cursor:"pointer",opacity:isUsed?0.6:1}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),borderRadius:4,padding:"2px 5px",fontWeight:700}}>{r.grade}</span>
                    <span style={{fontFamily:serif,fontSize:15,fontWeight:700}}>{r.name}</span>
                    {isUsed && <span style={{fontSize:10,color:C.amber}}>他区間で起用中</span>}
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:14,fontWeight:700,color:race.color}}>{fmtTime(t)}</div>
                    <div style={{fontSize:10,color:C.dim}}>調子{Math.round(r.condition)}/疲労{Math.round(r.fatigue)}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div>
          <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:race.color}}>{race.name}</div>
          <div style={{fontSize:10,color:C.sub}}>{filled}/{race.legs.length} 区配置 ・ 全{scout.length}校</div>
        </div>
      </div>

      {/* タブ */}
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[["order","自校オーダー"],["scout","対戦校スカウト"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px",borderRadius:8,
            border:`1px solid ${tab===k?race.color:C.line}`,background:tab===k?C.panel2:C.panel,
            color:tab===k?race.color:C.sub,fontSize:12,fontFamily:mono,fontWeight:tab===k?700:400,
            cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {tab==="scout" ? (
        <ScoutPanel scout={scout} race={race} myProjTime={myProjTime} />
      ) : (<>
      <button onClick={auto} style={{...btn(C.panel2),color:C.gold,border:`1px solid ${C.gold}`,marginBottom:12,marginTop:0}}>⚡ おまかせ自動編成</button>

      <div style={{display:"flex",flexDirection:"column",gap:7}}>
        {race.legs.map((l,i)=>{
          const r = roster.find(x=>x.id===cur[i]);
          const t = r? baseLegSeconds(r,l.dist,l.type):null;
          return(
            <button key={i} onClick={()=>setPicking(i)}
              style={{textAlign:"left",display:"flex",alignItems:"center",gap:12,
              background:C.panel,border:`1px solid ${r?C.line:race.color+"77"}`,
              borderRadius:9,padding:"11px 13px",cursor:"pointer"}}>
              <div style={{textAlign:"center",minWidth:42}}>
                <div style={{fontSize:20,fontWeight:700,color:race.color,fontFamily:serif}}>{l.n}</div>
                <div style={{fontSize:10,color:C.dim}}>区 {TYPE_LABEL[l.type]}</div>
              </div>
              <div style={{width:1,height:34,background:C.line}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:C.sub}}>{l.dist}km</div>
                {r? (
                  <div style={{fontFamily:serif,fontSize:16,fontWeight:700,marginTop:2}}>{r.name}
                    <span style={{fontSize:10,color:C.dim,fontFamily:mono,marginLeft:6}}>{r.grade}年</span></div>
                ):(
                  <div style={{fontSize:13,color:race.color,marginTop:2}}>＋ 選手を配置</div>
                )}
              </div>
              {r && <div style={{textAlign:"right"}}>
                <div style={{fontSize:14,fontWeight:700,color:race.color}}>{fmtTime(t)}</div>
                <div style={{fontSize:10,color:C.dim}}>区間想定</div></div>}
            </button>
          );
        })}
      </div>

      <button onClick={onStart} disabled={filled<race.legs.length}
        style={{width:"100%",marginTop:16,padding:"15px",borderRadius:10,border:"none",
        background: filled>=race.legs.length? `linear-gradient(90deg,${race.color},${C.amber})`:"#2a2f37",
        color: filled>=race.legs.length?"#0b0f14":"#666",fontFamily:mono,fontWeight:700,
        fontSize:15,letterSpacing:2,cursor:filled>=race.legs.length?"pointer":"default"}}>
        🏁 号砲 — レース開始
      </button>
      </>)}
    </div>
  );
}

/* 対戦校スカウト: 各校の想定総合タイムと区間別の起用選手(持ちタイム・適性)を開示 */
function ScoutPanel({scout,race,myProjTime}) {
  const [open,setOpen] = useState(null);
  const best = scout[0].total;
  return (
    <div>
      <div style={{fontSize:10,color:C.dim,marginBottom:8,lineHeight:1.5}}>
        各校が最適オーダーを組んだ場合の想定総合タイム順。タップで区間別の起用選手・5000mPB・区間適性を確認できます。</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {scout.map((s,i)=>{
          const gap = s.total - best;
          const isOpen = open===s.key;
          return (
            <div key={s.key} style={{background:C.panel,
              border:`1px solid ${s.isMe?race.color:C.line}`,borderRadius:9,overflow:"hidden"}}>
              <button onClick={()=>setOpen(isOpen?null:s.key)}
                style={{width:"100%",textAlign:"left",display:"flex",alignItems:"center",
                justifyContent:"space-between",padding:"10px 13px",background:s.isMe?race.color+"18":"none",
                border:"none",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:15,fontWeight:700,minWidth:22,
                    color:i===0?C.gold:i<3?C.amber:C.sub}}>{i+1}</span>
                  <span style={{fontFamily:serif,fontSize:15,fontWeight:s.isMe?700:400,
                    color:s.isMe?race.color:C.txt}}>{s.name}</span>
                  {s.isMe && <span style={{fontSize:10,color:race.color}}>● 自校</span>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:14,fontWeight:700,color:i===0?C.gold:C.txt}}>{fmtTime(s.total)}</div>
                  <div style={{fontSize:10,color:gap===0?C.gold:C.dim}}>{gap===0?"トップ":"+"+fmtTime(gap)}</div>
                </div>
              </button>
              {isOpen && (
                <div style={{borderTop:`1px solid ${C.line}`,padding:"4px 0"}}>
                  {s.lineup.map((a,li)=>{
                    if(!a) return null;
                    const r=a.runner;
                    return (
                      <div key={li} style={{display:"flex",alignItems:"center",gap:8,
                        padding:"6px 13px",borderBottom:li<s.lineup.length-1?`1px solid #1a2029`:"none"}}>
                        <span style={{fontSize:12,fontWeight:700,color:race.color,minWidth:30,fontFamily:serif}}>{a.leg}区</span>
                        <span style={{fontSize:10,color:C.dim,minWidth:48}}>{a.dist}k {TYPE_LABEL[a.type]}</span>
                        <span style={{flex:1,fontFamily:serif,fontSize:13}}>{r.name}</span>
                        <span style={{fontSize:10,color:C.sub,minWidth:52,textAlign:"right"}}>5000 {fmtTime(r.best5000)}</span>
                        <span style={{fontSize:10,color:aptColor(a.type,r),minWidth:38,textAlign:"right"}}>
                          適性{Math.round((a.type==="up"?r.uphill:a.type==="long"?r.stamina:a.type==="down"?(r.speed+r.uphill)/2:(r.speed+r.stamina)/2))}</span>
                        <span style={{fontSize:11,fontWeight:700,color:C.amber,minWidth:42,textAlign:"right"}}>{fmtTime(a.time)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
function aptColor(type,r){
  const v = type==="up"?r.uphill:type==="long"?r.stamina:type==="down"?(r.speed+r.uphill)/2:(r.speed+r.stamina)/2;
  return v>78?C.green:v>62?C.amber:C.red;
}
const backBtn={background:C.panel,border:`1px solid ${C.line}`,borderRadius:8,
  width:38,height:38,color:C.txt,fontSize:18,cursor:"pointer"};

/* ============================================================
   レースビュー — JR運行情報風 区間トラック縦スクロール
   ============================================================ */
const RIVAL_COLORS=["#e5534b","#3fb950","#a371f7","#39a0a8","#e8a838","#db61a2","#58a6ff","#c69026"];
const rivalColor=(i)=>RIVAL_COLORS[i%RIVAL_COLORS.length];
const HAKONE_SEED_LINE = 10; // 箱根: 10位以内で翌年シード

/* ============================================================
   レースビュー — 中継所単位の駅伝シミュ
   ・各区間を順に解決し、中継所(たすき)ごとにモーダル
   ・自校は中継所で次区間の戦略を指示。当日変数あり。
   ・区間賞 / 繰り上げスタート / シードボーダー演出
   ============================================================ */
function RaceView({raceKey,race,lineup,roster,teamName,entrants,prevLegIds,onDone}) {
  const isHakone = raceKey==="hakone";
  const totalDist = race.legs.reduce((a,l)=>a+l.dist,0);
  // 繰り上げスタートの基準差(秒): 距離が長いほど大きめ。本戦規模で調整。
  const WAVE_GAP = isHakone ? 60*20 : 60*10; // 箱根20分 / その他10分 のトップ差で繰り上げ

  // --- チーム初期化(各区間の起用選手と素のbaseを用意) ---
  const teams = useMemo(()=>{
    const fallback = { name:"補欠", grade:0, best5000:920, best10000:1900,
      speed:60, stamina:60, uphill:55, spirit:55, condition:60, fatigue:30, injury:0 };
    const mk = (legRunners, meta) => ({ ...meta, legRunners });

    const my = mk(lineup.map((id,i)=>{
      const L = race.legs[i];
      const r = roster.find(x=>x.id===id) || fallback;
      // 昨年と同じ区間を担当 → コース経験ボーナス(-0.6%)
      const expBonus = !!(prevLegIds && prevLegIds[i] === id && id != null);
      return { leg:L.n, dist:L.dist, type:L.type, name:r.name, grade:r.grade||0,
        base: baseLegSeconds(r, L.dist, L.type) * (expBonus ? 0.994 : 1),
        spirit:r.spirit, expBonus,
        best5000:r.best5000, best10000:r.best10000, uphill:r.uphill };
    }), {key:"me", name:teamName, color:C.gold, isMe:true});

    const others = entrants.map((rv,idx)=>{
      const lu = buildLineup(rv.squad, race.legs);
      const legRunners = race.legs.map((L,i)=>{
        const a = lu[i];
        const r = (a&&a.runner) || rv.squad[i%Math.max(1,rv.squad.length)] || fallback;
        return { leg:L.n, dist:L.dist, type:L.type, name:r.name, grade:r.grade||0,
          base:(a&&a.time)?a.time:baseLegSeconds(r,L.dist,L.type), spirit:r.spirit,
          best5000:r.best5000, best10000:r.best10000, uphill:r.uphill };
      });
      return mk(legRunners, {key:rv.key, name:rv.name, color:rivalColor(idx)});
    });
    return [my, ...others];
  },[]);

  const N = race.legs.length;
  // 各チームの「確定した区間タイム配列」。null=未走。
  const [legTimes, setLegTimes] = useState(()=> teams.map(()=> new Array(N).fill(null)));
  const [legInfo, setLegInfo]   = useState(()=> teams.map(()=> new Array(N).fill(null))); // {dayForm,blow,strategy}
  const [legProfiles, setLegProfiles] = useState(()=> teams.map(()=> new Array(N).fill(null))); // ペースプロファイル
  const [curLeg, setCurLeg]     = useState(0);     // これから走る区間index
  const [phase, setPhase]       = useState("brief"); // brief(区間前モーダル) | run(アニメ) | relay(中継所モーダル) | finish
  const [strategy, setStrategy] = useState("balance");
  const [anim, setAnim]         = useState(0);     // 現区間のアニメ進捗 0..1
  const [speed, setSpeed]       = useState(1);
  const [paused, setPaused]     = useState(false); // スプリット境界で停止中
  const [splitIdx, setSplitIdx] = useState(0);     // 次に停止する自校スプリット境界index
  const [splitStop, setSplitStop] = useState(null); // 停止中の境界index(モーダル表示用)
  const [commentary, setCommentary] = useState([]); // 実況ログ(区間毎リセット)
  const raf=useRef(); const last=useRef(0); const animRef=useRef(0);

  const myIdx = teams.findIndex(t=>t.isMe);

  // 区間 li までの累計タイム(確定済みのみ)
  const cumThrough = (ti, li) => {
    let s=0; for(let k=0;k<=li;k++){ const v=legTimes[ti][k]; if(v==null) return null; s+=v; } return s;
  };
  // 中継所 li 通過時点の順位表(li区を走り終えた累計)
  const standingsAt = (li) => {
    return teams.map((t,ti)=>({ team:t, ti, cum: cumThrough(ti, li) }))
      .filter(x=>x.cum!=null)
      .sort((a,b)=>a.cum-b.cum);
  };

  // --- 1区間を解決(全チーム) ---
  const resolveLeg = (li, myStrategy) => {
    const newTimes = legTimes.map(a=>a.slice());
    const newInfo  = legInfo.map(a=>a.slice());
    const newProfs = legProfiles.map(a=>a.slice());
    const dist = race.legs[li].dist;
    teams.forEach((t,ti)=>{
      const rn = t.legRunners[li];
      if (t.isMe) {
        const df = rollDayForm();
        const res = resolveLegTime(rn.base, rn.spirit, myStrategy, df);
        newTimes[ti][li]=res.time; newInfo[ti][li]={dayForm:df, blow:res.blow, strategy:myStrategy};
        newProfs[ti][li]=buildPaceProfile(dist, res.time, res.blow);
      } else {
        // ライバルはAI戦略(区間で軽く分散)+当日変数
        const aiKeys=["balance","balance","hold","attack","position"];
        const ai = aiKeys[Math.floor(Math.random()*aiKeys.length)];
        const df = rollDayForm();
        const res = resolveLegTime(rn.base, rn.spirit, ai, df);
        newTimes[ti][li]=res.time; newInfo[ti][li]={dayForm:df, blow:res.blow, strategy:ai};
        newProfs[ti][li]=buildPaceProfile(dist, res.time, res.blow);
      }
    });
    setLegTimes(newTimes); setLegInfo(newInfo); setLegProfiles(newProfs);
    return newTimes;
  };

  // animRefを同期
  useEffect(()=>{ animRef.current = anim; },[anim]);

  // スプリット境界で実況を生成
  const emitSplitCommentary = (boundaryIdx) => {
    const li = curLeg;
    const prof = legProfiles[myIdx]?.[li];
    if (!prof) return;
    const chk = prof.checks[boundaryIdx];
    const prevChk = boundaryIdx>0 ? prof.checks[boundaryIdx-1] : {km:0, t:0};
    const legDist = race.legs[li].dist;
    const myLegT = legTimes[myIdx][li];
    const lines = [];
    // 通過タイム
    lines.push(`⏱ ${chk.km}km通過 ${fmtTime(Math.round(chk.t))}`);
    // 名所(レース別)
    const spots = (RACE_SPOTS[race.key]?.[li]) || [];
    spots.forEach(sp=>{ if (sp.km>prevChk.km && sp.km<=chk.km) lines.push(`📍 ${sp.text}`); });
    // つぶれ
    const myInf = legInfo[myIdx][li];
    if (myInf?.blow && prof.blowAtKm!=null && prof.blowAtKm>=prevChk.km && prof.blowAtKm<chk.km+0.01){
      lines.push(`⚠ ${teams[myIdx].legRunners[li].name}の様子がおかしい…ペースが上がらない!`);
    }
    // 前後差の変化
    const now = computeRoadPositions(teams, legTimes, legProfiles, li, chk.t/myLegT, myIdx, legDist);
    const before = computeRoadPositions(teams, legTimes, legProfiles, li, prevChk.t/myLegT, myIdx, legDist);
    let aheadTi=-1, aheadGap=Infinity;
    now.gaps.forEach((g,ti)=>{ if (ti!==myIdx && g<0 && -g<aheadGap){ aheadGap=-g; aheadTi=ti; } });
    if (aheadTi>=0 && aheadGap<=150){
      const beforeGap = -before.gaps[aheadTi];
      const delta = Math.round(beforeGap - aheadGap);
      if (delta>=3) lines.push(`▲ 前を行く${teams[aheadTi].name}との差、${delta}秒縮まる (残り${Math.round(aheadGap)}秒)`);
      else if (delta<=-3) lines.push(`▽ ${teams[aheadTi].name}との差が${-delta}秒開く`);
    }
    // 順位変動
    if (now.liveRank < before.liveRank) lines.push(`🔥 総合${now.liveRank}位に浮上!`);
    else if (now.liveRank > before.liveRank) lines.push(`… 総合${now.liveRank}位に後退`);
    setCommentary(prev=>[...prev, ...lines]);
  };

  // アニメ: 現区間を anim 0→1。自校スプリット境界で一時停止して実況。終わったら relay へ。
  useEffect(()=>{
    if (phase!=="run" || paused) return;
    last.current=performance.now();
    const loop=(now)=>{
      const dt=(now-last.current)/1000; last.current=now;
      let np = animRef.current + dt*0.10*speed; // ×1でじっくり(21km区間≈10秒+停止)。×4で従来並み。
      // 次の停止境界(最後のチェックポイント=中継所では停止せずrelayへ)
      const myProf = legProfiles[myIdx]?.[curLeg];
      const myLegT = legTimes[myIdx]?.[curLeg] ?? 1;
      let stopAt = null;
      if (myProf && splitIdx < myProf.checks.length-1){
        stopAt = myProf.checks[splitIdx].t / myLegT;
      }
      let stopped = false;
      if (stopAt!=null && animRef.current < stopAt && np >= stopAt){
        np = stopAt; stopped = true;
      }
      if (np>=1) np=1;
      animRef.current = np; setAnim(np);
      if (stopped){
        setPaused(true);
        setSplitStop(splitIdx);
        emitSplitCommentary(splitIdx);
        setSplitIdx(s=>s+1);
        return; // ループ停止(paused解除で再開)
      }
      if (np>=1) return; // 完了は別effectでrelayへ
      raf.current=requestAnimationFrame(loop);
    };
    raf.current=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf.current);
  },[phase,speed,paused,splitIdx,curLeg,legProfiles,legTimes]);

  useEffect(()=>{
    if (phase==="run" && anim>=1){
      // 中継所到達
      if (curLeg >= N-1){ setPhase("finish"); }
      else setPhase("relay");
    }
  },[anim,phase,curLeg,N]);

  // ブリーフィング確定 → 区間を解決してアニメ開始
  const startLeg = () => {
    resolveLeg(curLeg, strategy);
    setAnim(0); animRef.current=0;
    setSplitIdx(0); setPaused(false);
    const rn = teams[myIdx].legRunners[curLeg];
    setCommentary([`🏁 第${race.legs[curLeg].n}区 ${race.stations?.[curLeg]??""}を出発 — ${rn.name}が走り出す`]);
    setPhase("run");
  };
  // 中継所モーダルで次区間へ
  const toNextLeg = () => {
    setCurLeg(l=>l+1);
    setAnim(0); animRef.current=0;
    setSplitIdx(0); setPaused(false); setSplitStop(null); setCommentary([]);
    setPhase("brief");
  };
  // スプリット停止から再開
  const resumeRun = () => { setSplitStop(null); setPaused(false); };
  // 中継所まで一気にスキップ
  const skipToRelay = () => {
    setCommentary(prev=>[...prev, "⏭ 中継所へ…"]);
    setSplitStop(null); setPaused(false);
    animRef.current = 1; setAnim(1);
  };

  // 区間賞(全区間確定後): 各区間の最速チーム
  const legPrizes = useMemo(()=>{
    if (phase!=="finish") return [];
    return race.legs.map((L,li)=>{
      let best=null,bt=Infinity,bn="";
      teams.forEach((t,ti)=>{ const v=legTimes[ti][li]; if(v!=null&&v<bt){bt=v;best=t;bn=t.legRunners[li].name;} });
      return { leg:L.n, team:best, time:bt, name:bn };
    });
  },[phase,legTimes]);

  // 完走処理
  const finish = () => {
    const finalCum = teams.map((t,ti)=> cumThrough(ti, N-1) ?? 9e9);
    const order = teams.map((t,ti)=>({t,ti,cum:finalCum[ti]})).sort((a,b)=>a.cum-b.cum);
    const myPos = order.findIndex(o=>o.t.isMe)+1;
    const myStageWins = legPrizes.filter(p=>p.team&&p.team.isMe).length;
    // 区間順位(各区間で全校のその区間タイムを並べる)
    const legStandings = race.legs.map((L,li)=>{
      const rows = teams.map((t,ti)=>({name:t.name, time:legTimes[ti][li], isMe:!!t.isMe}))
        .filter(x=>x.time!=null).sort((a,b)=>a.time-b.time)
        .map((x,i)=>({rank:i+1, name:x.name, time:x.time, isMe:x.isMe}));
      return { leg:L.n, rows };
    });
    // 自校の各区間走者と区間タイム
    const myLegs = race.legs.map((L,li)=>{
      const rn = teams[myIdx].legRunners[li];
      return { leg:L.n, name:rn.name, grade:rn.grade||0, time:legTimes[myIdx][li] };
    });
    // ===== 今日の名場面(ハイライト)抽出 =====
    const rankProg = race.legs.map((L,li)=>{
      const st = standingsAt(li);
      const p = st.findIndex(s=>s.team.isMe);
      return p+1;
    });
    const highlights = [];
    // 区間賞
    legPrizes.forEach(p=>{
      if (p.team && p.team.isMe) highlights.push({icon:"🏆", title:`第${p.leg}区 区間賞`,
        desc:`${p.name}が区間トップの走り (${fmtTime(Math.round(p.time))})`});
    });
    // ごぼう抜き(最大の順位ジャンプ)
    let bestJump=0, bestLi=-1;
    rankProg.forEach((r,li)=>{
      if (li===0) return;
      const jump = rankProg[li-1] - r;
      if (jump > bestJump){ bestJump=jump; bestLi=li; }
    });
    if (bestJump>=2){
      const rn = teams[myIdx].legRunners[bestLi];
      highlights.push({icon:"🔥", title:`第${bestLi+1}区 ${bestJump}人抜き`,
        desc:`${rn.name}が${rankProg[bestLi-1]}位→${rankProg[bestLi]}位へ順位を押し上げた`});
    }
    // つぶれ
    race.legs.forEach((L,li)=>{
      if (legInfo[myIdx][li]?.blow){
        const rn = teams[myIdx].legRunners[li];
        highlights.push({icon:"⚠", title:`第${li+1}区 まさかの失速`,
          desc:`${rn.name}が終盤に大きくペースダウン。苦しい展開に`});
      }
    });
    // 箱根特有
    if (isHakone){
      const stOut = standingsAt(Math.min(4, N-1));
      if (stOut.length && stOut[0].team.isMe)
        highlights.push({icon:"🏔", title:"往路優勝", desc:"芦ノ湖に一番乗り。山を制した"});
      if (myPos<=10) highlights.push({icon:"🎫", title:"シード権獲得",
        desc:`総合${myPos}位でフィニッシュ。来年への切符を掴んだ`});
      else if (myPos<=13) highlights.push({icon:"💔", title:"シードまであと一歩",
        desc:`総合${myPos}位。ボーダーに届かなかった`});
    }
    if (highlights.length===0)
      highlights.push({icon:"🤝", title:"堅実な襷リレー", desc:"大きな波乱なく全区間を走り切った"});

    onDone({
      raceKey, myRank: myPos, total: teams.length,
      myTime: finalCum[myIdx], leaderTime: order[0].cum,
      usedIds: lineup.slice(),
      myStageWins,
      seedLine: isHakone? HAKONE_SEED_LINE : null,
      table: order.map((o,i)=>({rank:i+1,name:o.t.name,time:o.cum,isMe:!!o.t.isMe,key:o.t.key})),
      stagePrizes: legPrizes.map(p=>({leg:p.leg,name:p.name,team:p.team?.name,isMe:!!p.team?.isMe,time:p.time})),
      legStandings, myLegs,
      highlights: highlights.slice(0,3),
    });
  };

  // --- 表示用: 現在の中継所順位 ---
  const lastDoneLeg = curLeg - (phase==="brief"||phase==="run" ? 1 : 0);
  const liveStandings = standingsAt(Math.max(0, (phase==="relay"||phase==="finish")?curLeg:curLeg-1));
  const myLive = liveStandings.find(s=>s.team.isMe);
  const myRankLive = myLive? liveStandings.indexOf(myLive)+1 : teams.length;

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.txt,fontFamily:mono,display:"flex",flexDirection:"column"}}>
      {/* ヘッダ */}
      <div style={{position:"sticky",top:0,zIndex:30,background:race.color,padding:"9px 14px",
        display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontSize:10,color:"#0b0f14cc",letterSpacing:1}}>{race.name} 中継</div>
          <div style={{fontFamily:serif,fontSize:16,fontWeight:700,color:"#0b0f14"}}>
            {phase==="finish"?"ゴール":`${Math.min(curLeg+1,N)}区 進行中`} ・ {myRankLive}位/{teams.length}校</div>
        </div>
        <div style={{textAlign:"right",color:"#0b0f14"}}>
          <div style={{fontSize:10}}>区間 {Math.min(curLeg+1,N)}/{N}</div>
          {isHakone && <div style={{fontSize:11,fontWeight:700}}>シード{myRankLive<=HAKONE_SEED_LINE?"圏内":"圏外"}</div>}
        </div>
      </div>

      {/* 区間チップ */}
      <div style={{background:C.panel,borderBottom:`1px solid ${C.line}`,padding:"8px 14px",display:"flex",gap:6,overflowX:"auto"}}>
        {race.legs.map((l,i)=>{
          const done = legTimes[myIdx][i]!=null;
          const cur = i===curLeg && phase!=="finish";
          return (
            <div key={i} style={{minWidth:46,textAlign:"center",
              borderBottom:`2px solid ${cur?race.color:done?C.dim:C.line}`,paddingBottom:5}}>
              <div style={{fontSize:13,fontWeight:700,color:cur?race.color:done?C.sub:C.dim}}>{l.n}</div>
              <div style={{fontSize:7,color:C.dim}}>{l.dist}k {l.type==="up"?"山↑":l.type==="down"?"山↓":""}</div>
            </div>
          );
        })}
      </div>

      {/* メイン: ロードビュー(監督車視点・自校中心) */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 0 12px"}}>
        <div onClick={()=>{ if(phase==="run"&&paused) resumeRun(); }}>
          <RoadView teams={teams} legTimes={legTimes} legProfiles={legProfiles} curLeg={curLeg}
            anim={phase==="run"?anim:(phase==="brief"?0:1)} race={race} myIdx={myIdx}
            phase={phase}/>
        </div>
        {/* 実況 */}
        {(phase==="run"||phase==="relay") && commentary.length>0 && (
          <div style={{margin:"0 10px 8px",padding:"8px 12px",background:C.panel,
            border:`1px solid ${C.line}`,borderRadius:8,maxHeight:110,overflowY:"auto",
            display:"flex",flexDirection:"column-reverse"}}>
            <div>
              {commentary.map((c,i)=>(
                <div key={i} style={{fontSize:10.5,lineHeight:1.7,
                  color: i===commentary.length-1 ? C.txt : C.sub,
                  fontWeight: i===commentary.length-1 ? 700 : 400}}>{c}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 下部コントロール */}
      {phase==="run" && (
        <div style={{position:"sticky",bottom:0,background:C.panel,borderTop:`1px solid ${C.line}`,padding:"10px 14px",
          display:"flex",gap:8,alignItems:"center"}}>
          {paused ? (
            <>
              <button onClick={resumeRun} style={{flex:1,padding:"11px",borderRadius:8,border:"none",
                background:`linear-gradient(90deg,${race.color},${C.amber})`,color:"#0b0f14",
                fontFamily:mono,fontWeight:700,fontSize:13,letterSpacing:1,cursor:"pointer"}}>
                ▶ レース再開</button>
              <button onClick={skipToRelay} style={{padding:"11px 14px",borderRadius:8,border:`1px solid ${C.line}`,
                background:C.panel2,color:C.sub,fontSize:11,cursor:"pointer"}}>⏭ 中継所へ</button>
            </>
          ) : (
            <>
              <div style={{fontSize:10,color:C.sub}}>
                {curLeg+1}区 {race.stations?.[curLeg]&&race.stations?.[curLeg+1]?
                  `${race.stations[curLeg]}→${race.stations[curLeg+1]}`:""} 走行中…</div>
              <div style={{flex:1}}/>
              {[1,2,4].map(s=>(
                <button key={s} onClick={()=>setSpeed(s)} style={{padding:"6px 10px",borderRadius:6,
                  border:`1px solid ${speed===s?race.color:C.line}`,background:speed===s?C.panel2:C.panel,
                  color:speed===s?race.color:C.sub,fontSize:11,cursor:"pointer"}}>×{s}</button>
              ))}
              <button onClick={skipToRelay} style={{padding:"6px 12px",borderRadius:6,border:`1px solid ${C.line}`,
                background:C.panel,color:C.sub,fontSize:11,cursor:"pointer"}}>⏭ 中継所へ</button>
            </>
          )}
        </div>
      )}

      {/* ブリーフィング・モーダル(区間スタート前の戦略指示) */}
      {phase==="brief" && (
        <BriefModal race={race} li={curLeg} teams={teams} myIdx={myIdx}
          standingsAt={standingsAt} strategy={strategy} setStrategy={setStrategy}
          onStart={startLeg} isHakone={isHakone}/>
      )}

      {/* スプリット通過モーダル(5km毎) */}
      {phase==="run" && paused && splitStop!=null && (
        <SplitModal race={race} li={curLeg} teams={teams} myIdx={myIdx}
          legTimes={legTimes} legProfiles={legProfiles} legInfo={legInfo}
          boundaryIdx={splitStop} onResume={resumeRun} onSkip={skipToRelay} isHakone={isHakone}/>
      )}

      {/* 中継所モーダル(たすきリレー) */}
      {phase==="relay" && (
        <RelayModal race={race} li={curLeg} teams={teams} legTimes={legTimes} legInfo={legInfo}
          myIdx={myIdx} standingsAt={standingsAt} onNext={toNextLeg} waveGap={WAVE_GAP}
          isHakone={isHakone}/>
      )}

      {/* フィニッシュ */}
      {phase==="finish" && (
        <div style={{position:"sticky",bottom:0,background:C.panel,borderTop:`1px solid ${C.line}`,padding:"12px 14px"}}>
          <button onClick={finish} style={{width:"100%",padding:"15px",borderRadius:10,border:"none",
            background:`linear-gradient(90deg,${race.color},${C.amber})`,color:"#0b0f14",
            fontFamily:mono,fontWeight:700,fontSize:15,letterSpacing:2,cursor:"pointer"}}>
            🏁 ゴール — 結果を見る（{myRankLive}位）</button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ロードビュー(監督車視点): 自校中心・±90秒の近隣校のみ表示
   X軸=自校とのタイム差。中継所の時差を反映した物理的に正しい配置。
   ============================================================ */
function RoadView({teams,legTimes,legProfiles,curLeg,anim,race,myIdx,phase}) {
  const li = Math.min(curLeg, race.legs.length-1);
  const L = race.legs[li];
  const legDist = L.dist;
  const { starts, T, pos, gaps, myPos, liveRank } =
    computeRoadPositions(teams, legTimes, legProfiles, li, anim, myIdx, legDist);

  // 追い抜き検出(順位が変わった瞬間にフラッシュ)
  const prevRank = useRef(liveRank);
  const [flash,setFlash] = useState(null); // "up" | "down" | null
  useEffect(()=>{
    if (liveRank !== prevRank.current) {
      setFlash(liveRank < prevRank.current ? "up" : "down");
      prevRank.current = liveRank;
      const t = setTimeout(()=>setFlash(null), 1200);
      return ()=>clearTimeout(t);
    }
  },[liveRank]);

  const RANGE = 90; // 表示範囲±90秒
  const visible=[], aheadFar=[], behindFar=[];
  teams.forEach((t,ti)=>{
    if (ti===myIdx) return;
    const g = gaps[ti];
    if (g < -RANGE) aheadFar.push({t,ti,g});
    else if (g > RANGE) behindFar.push({t,ti,g});
    else visible.push({t,ti,g});
  });
  const leaderGap = Math.min(...gaps); // 最前方(最も負)
  const meIsLeader = leaderGap >= -1e-9;

  // 各校の順位(タイム差ベース: gapが小さい=前)
  const rankOfTeam = (ti)=> 1 + teams.filter((_,tj)=> tj!==ti &&
    (gaps[tj] < gaps[ti] - 1e-9 || (Math.abs(gaps[tj]-gaps[ti])<=1e-9 && starts[tj]<starts[ti]))).length;

  const ROAD_H = 190;
  const kmTicks = Array.from({length:Math.floor((legDist-0.01)/5)},(_,i)=>(i+1)*5);
  return (
    <div style={{padding:"4px 10px 10px"}}>
      {/* ステータス行 */}
      <div style={{display:"flex",alignItems:"baseline",gap:10,padding:"4px 4px 8px"}}>
        <span style={{fontSize:17,fontWeight:700,color:race.color}}>{liveRank}<span style={{fontSize:10}}>位</span></span>
        <span style={{fontFamily:serif,fontSize:13,fontWeight:700}}>{teams[myIdx].legRunners[li]?.name}</span>
        <span style={{fontSize:10.5,color:C.sub,fontFamily:mono,marginLeft:"auto"}}>
          {myPos.toFixed(1)} / {legDist}km</span>
        {flash==="up" && <span style={{fontSize:11,color:C.green,fontWeight:700}}>▲追い抜き!</span>}
        {flash==="down" && <span style={{fontSize:11,color:C.red,fontWeight:700}}>▼抜かれた</span>}
      </div>

      {/* シードラインバー(箱根8-10区) */}
      {race.key==="hakone" && li>=7 && (()=>{
        const order = teams.map((t,ti)=>({ti, p:pos[ti], s:starts[ti]}))
          .sort((a,b)=> b.p-a.p || a.s-b.s);
        if (order.length < 11) return null;
        const inSeed = liveRank <= 10;
        const refTeam = inSeed ? order[10] : order[9]; // 圏内なら11位、圏外なら10位が基準
        const gapS = Math.abs(Math.round(gaps[refTeam.ti]));
        return (
          <div style={{marginBottom:6,padding:"6px 11px",borderRadius:7,
            background: inSeed ? C.green+"18" : C.red+"18",
            border:`1px solid ${inSeed?C.green:C.red}66`,
            display:"flex",alignItems:"center",gap:8,fontSize:10.5}}>
            <span style={{fontWeight:700,color:inSeed?C.green:C.red}}>
              {inSeed?"🟢 シード圏内":"🔴 シード圏外"}</span>
            <span style={{color:C.sub,marginLeft:"auto"}}>
              {inSeed
                ? <>11位 {teams[refTeam.ti].name} に <b style={{color:C.green}}>+{gapS}秒</b></>
                : <>10位 {teams[refTeam.ti].name} まで <b style={{color:C.red}}>{gapS}秒</b></>}</span>
          </div>
        );
      })()}

      {/* 前方/後方の集約チップ */}
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4,minHeight:20}}>
        <div>
          {meIsLeader ? (
            <span style={{fontSize:10,color:C.gold,fontWeight:700}}>👑 首位を走行中</span>
          ) : aheadFar.length>0 ? (
            <span style={{fontSize:10,color:C.amber,background:C.panel2,padding:"3px 8px",borderRadius:5,
              border:`1px solid ${C.amber}44`}}>
              ▲ 前方{aheadFar.length}校 ・ 先頭まで {fmtTime(Math.round(-leaderGap))}</span>
          ) : (
            <span style={{fontSize:10,color:C.green}}>先頭集団が見えている!</span>
          )}
        </div>
        <div>
          {behindFar.length>0 && (
            <span style={{fontSize:10,color:C.cyan,background:C.panel2,padding:"3px 8px",borderRadius:5,
              border:`1px solid ${C.cyan}44`}}>
              後方{behindFar.length}校 ▼</span>
          )}
        </div>
      </div>

      {/* 道路 */}
      <div style={{position:"relative",height:ROAD_H,background:"#0d1218",
        border:`1px solid ${C.line}`,borderRadius:10,overflow:"hidden"}}>
        {/* 路面 */}
        <div style={{position:"absolute",top:"52%",left:0,right:0,height:22,transform:"translateY(-50%)",
          background:"#161d26",borderTop:`1px dashed #2a3441`,borderBottom:`1px dashed #2a3441`}}/>
        {/* センターライン(破線) */}
        <div style={{position:"absolute",top:"52%",left:0,right:0,height:1,transform:"translateY(-50%)",
          backgroundImage:"repeating-linear-gradient(90deg,#3a4553 0 14px,transparent 14px 28px)"}}/>
        {/* 秒差目盛り(30秒刻み)。前方(負)が左 */}
        {[-60,-30,30,60].map(s=>(
          <div key={s} style={{position:"absolute",top:6,bottom:6,left:`${50 + (s/RANGE)*47}%`,
            width:1,background:"#1c242e"}}>
            <span style={{position:"absolute",bottom:2,left:2,fontSize:10,color:"#3a4553"}}>{s>0?`+${s}`:s}</span>
          </div>
        ))}
        <div style={{position:"absolute",top:5,left:8,fontSize:10,color:C.dim}}>← 進行方向</div>

        {/* 他校チップ(近接時は縦にずらして重なりを回避) */}
        {(()=>{
          const sorted = visible.slice().sort((a,b)=>a.g-b.g);
          let lastX=-999, level=0;
          const layout = sorted.map(v=>{
            const x = 50 + (v.g/RANGE)*47; // 前方(g<0)は左へ
            if (Math.abs(x-lastX) < 8){ level = (level%2)+1; } else { level=0; }
            lastX = x;
            return {...v, x, level};
          });
          return layout.map(({t,ti,g,x,level})=>{
            const rk = rankOfTeam(ti);
            const finished = pos[ti]>=legDist-1e-9;
            const topPct = level===0 ? 52 : level===1 ? 30 : 74;
            return (
              <div key={t.key} style={{position:"absolute",left:`${x}%`,top:`${topPct}%`,
                transform:"translate(-50%,-50%)",textAlign:"center",zIndex:2,
                transition:"left 0.35s linear, top 0.35s linear"}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:1,fontWeight:700}}>{rk}</div>
                <div style={{width:26,height:26,borderRadius:6,background:"#fff",
                  border:`2px solid ${t.color}`,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:12,boxShadow:"0 2px 5px #0009",margin:"0 auto"}}>
                  {finished?"🏁":"🏃"}</div>
                <div style={{fontSize:10,fontWeight:700,color:t.color,marginTop:1,whiteSpace:"nowrap",
                  maxWidth:44,overflow:"hidden",textOverflow:"ellipsis"}}>{t.name.slice(0,4)}</div>
                <div style={{fontSize:9.5,color:g<0?C.amber:C.cyan,fontFamily:mono}}>
                  {g<0?`-${Math.round(-g)}s`:`+${Math.round(g)}s`}</div>
              </div>
            );
          });
        })()}

        {/* 自校チップ(中央固定・大きめ) */}
        <div style={{position:"absolute",left:"50%",top:"52%",transform:"translate(-50%,-50%)",
          textAlign:"center",zIndex:5}}>
          <div style={{fontSize:11,fontWeight:700,color:race.color,marginBottom:1}}>{liveRank}位</div>
          <div style={{width:38,height:38,borderRadius:9,background:race.color,
            border:`2px solid #fff`,display:"flex",alignItems:"center",justifyContent:"center",
            fontSize:19,boxShadow:`0 0 14px ${race.color}88, 0 3px 8px #000b`,margin:"0 auto"}}>🏃</div>
          <div style={{fontSize:10.5,fontWeight:700,color:"#fff",marginTop:2,whiteSpace:"nowrap"}}>
            {teams[myIdx].name.slice(0,5)}</div>
        </div>
      </div>

      {/* 区間進捗バー */}
      <div style={{marginTop:10,padding:"8px 10px",background:C.panel,border:`1px solid ${C.line}`,borderRadius:8}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.sub,marginBottom:5}}>
          <span>{race.stations?.[li] ?? ""}</span>
          <span style={{color:race.color,fontWeight:700}}>第{L.n}区 {legDist}km</span>
          <span>{race.stations?.[li+1] ?? ""}</span>
        </div>
        <div style={{position:"relative",height:7,background:"#11161d",borderRadius:4}}>
          {kmTicks.map(km=>(
            <div key={km} style={{position:"absolute",left:`${(km/legDist)*100}%`,top:0,bottom:0,
              width:1,background:"#2a3441"}}/>
          ))}
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${(myPos/legDist)*100}%`,
            background:`linear-gradient(90deg,${race.color}66,${race.color})`,borderRadius:4}}/>
          <div style={{position:"absolute",left:`${(myPos/legDist)*100}%`,top:-3,width:3,height:13,
            background:"#fff",borderRadius:2,transform:"translateX(-50%)",
            boxShadow:`0 0 6px ${race.color}`}}/>
        </div>
      </div>
    </div>
  );
}

/* ブリーフィング: 区間スタート前。前後差と戦略指示。 */
function BriefModal({race,li,teams,myIdx,standingsAt,strategy,setStrategy,onStart,isHakone}) {
  const L = race.legs[li];
  const rn = teams[myIdx].legRunners[li];
  const [showEntries,setShowEntries] = useState(false);
  // 中継所名: stations[li] → stations[li+1]
  const stFrom = race.stations?.[li];
  const stTo = race.stations?.[li+1];
  // li-1 中継所時点の順位(li>0)。li=0はスタート前なので想定順.
  const st = li>0 ? standingsAt(li-1) : null;
  let aheadGap=null, behindGap=null, myRank=null, aheadTeam=null, behindTeam=null;
  if (st){
    const myPos = st.findIndex(s=>s.team.isMe);
    myRank = myPos+1;
    if (myPos>0){ aheadGap = st[myPos].cum - st[myPos-1].cum; aheadTeam = st[myPos-1].team; }
    if (myPos<st.length-1){ behindGap = st[myPos+1].cum - st[myPos].cum; behindTeam = st[myPos+1].team; }
  }
  // 前後校のこの区間の走者情報
  const rivalRunnerInfo = (team) => {
    if (!team) return null;
    const r = team.legRunners?.[li];
    if (!r) return null;
    return r;
  };
  const aheadRunner = rivalRunnerInfo(aheadTeam);
  const behindRunner = rivalRunnerInfo(behindTeam);

  return (
    <ModalShell color={race.color}>
      <div style={{fontSize:10,color:C.sub,letterSpacing:1}}>
        {li===0? "スタート前" : `${stFrom}中継所`}</div>
      <div style={{fontFamily:serif,fontSize:22,fontWeight:700,color:race.color,marginTop:2}}>
        第{L.n}区 <span style={{fontSize:13,color:C.txt}}>{stFrom} → {stTo}</span></div>
      <div style={{fontSize:11,color:C.sub,marginTop:2}}>
        {L.dist}km ・ {TYPE_LABEL[L.type]}
        {isHakone && race.outboundGoalAt===li+1 && <span style={{color:C.gold,marginLeft:6}}>★往路ゴール</span>}</div>

      <div style={{marginTop:10,padding:"10px 12px",background:C.panel2,borderRadius:8,
        border:`1px solid ${C.line}`}}>
        <div style={{fontSize:10,color:C.sub}}>{L.n}区 走者</div>
        <div style={{fontFamily:serif,fontSize:18,fontWeight:700}}>{rn.name}
          <span style={{fontSize:10,color:C.dim,marginLeft:8,fontFamily:mono}}>5000 {fmtTime(rn.best5000)}</span>
          {rn.expBonus && <span style={{fontSize:10,color:C.green,marginLeft:8,
            border:`1px solid ${C.green}66`,borderRadius:4,padding:"1px 5px"}}>◎ 昨年もこの区間</span>}</div>
        {myRank && (
          <div style={{display:"flex",gap:14,marginTop:8,fontSize:11}}>
            <span style={{color:C.sub}}>現在 <b style={{color:race.color}}>{myRank}位</b></span>
            <span style={{color:C.sub}}>前と {aheadGap!=null?fmtTime(aheadGap):"—"}</span>
            <span style={{color:C.sub}}>後と {behindGap!=null?fmtTime(behindGap):"—"}</span>
          </div>
        )}
        {isHakone && myRank && (
          <div style={{marginTop:6,fontSize:10,color:myRank<=10?C.green:C.red}}>
            {myRank<=10?`シード圏内(${10-myRank}校の余裕)`:`シード圏外(あと${myRank-10}つ上げる)`}</div>
        )}
      </div>

      {/* 前後校のこの区間の走者 */}
      {(aheadRunner || behindRunner) && (
        <div style={{marginTop:8,padding:"9px 12px",background:C.panel,borderRadius:8,border:`1px solid ${C.line}`}}>
          <div style={{fontSize:10,color:C.sub,letterSpacing:1,marginBottom:5}}>ライバルの{L.n}区</div>
          {aheadRunner && (
            <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,padding:"3px 0"}}>
              <span style={{fontSize:10,color:C.amber,minWidth:26}}>▲前</span>
              <span style={{color:C.txt,fontWeight:700,minWidth:64}}>{aheadTeam.name}</span>
              <span style={{fontFamily:serif,flex:1}}>{aheadRunner.name}</span>
              <span style={{fontFamily:mono,fontSize:10,color:C.sub}}>10000 {fmtTime(aheadRunner.best10000)}</span>
              {L.type==="up" && <span style={{fontSize:10,color:C.purple}}>山{Math.round(aheadRunner.uphill??60)}</span>}
            </div>
          )}
          {behindRunner && (
            <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,padding:"3px 0",
              borderTop:aheadRunner?`1px solid ${C.line}`:"none"}}>
              <span style={{fontSize:10,color:C.cyan,minWidth:26}}>▼後</span>
              <span style={{color:C.txt,fontWeight:700,minWidth:64}}>{behindTeam.name}</span>
              <span style={{fontFamily:serif,flex:1}}>{behindRunner.name}</span>
              <span style={{fontFamily:mono,fontSize:10,color:C.sub}}>10000 {fmtTime(behindRunner.best10000)}</span>
              {L.type==="up" && <span style={{fontSize:10,color:C.purple}}>山{Math.round(behindRunner.uphill??60)}</span>}
            </div>
          )}
        </div>
      )}

      {/* 区間エントリー一覧トグル */}
      <button onClick={()=>setShowEntries(!showEntries)}
        style={{width:"100%",marginTop:8,padding:"7px",borderRadius:7,
        border:`1px solid ${C.line}`,background:"none",color:C.sub,fontSize:10.5,cursor:"pointer"}}>
        {showEntries?"▲ 閉じる":`▽ ${L.n}区 全校エントリー`}</button>
      {showEntries && (
        <div style={{marginTop:6,maxHeight:180,overflowY:"auto",background:C.panel,
          border:`1px solid ${C.line}`,borderRadius:8,padding:"6px 10px"}}>
          {(st? st.map(s=>s.team) : teams).map((t,i)=>{
            const r = t.legRunners?.[li];
            if (!r) return null;
            return (
              <div key={i} style={{display:"flex",alignItems:"center",gap:7,fontSize:10.5,
                padding:"3px 0",borderBottom:`1px solid ${C.line}22`,
                color:t.isMe?race.color:C.sub,fontWeight:t.isMe?700:400}}>
                <span style={{minWidth:20,fontSize:10,color:C.dim}}>{st? i+1 : "-"}</span>
                <span style={{minWidth:66}}>{t.name}</span>
                <span style={{fontFamily:serif,flex:1}}>{r.name}</span>
                <span style={{fontFamily:mono,fontSize:9.5,color:C.dim}}>{fmtTime(r.best10000)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{fontSize:10,color:C.sub,margin:"12px 0 6px",letterSpacing:1}}>{rn.name} への指示</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
        {Object.values(STRATEGIES).map(s=>{
          const on = strategy===s.key;
          return (
            <button key={s.key} onClick={()=>setStrategy(s.key)} style={{textAlign:"left",
              background:on?C.panel2:"#11161d",border:`1px solid ${on?s.color:C.line}`,borderRadius:8,
              padding:"8px 10px",cursor:"pointer"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:2,background:s.color}}/>
                <span style={{fontSize:12,fontWeight:on?700:400,color:on?C.txt:C.sub}}>{s.label}</span>
              </div>
              <div style={{fontSize:10.5,color:C.dim,marginTop:3,lineHeight:1.4}}>{s.desc}</div>
            </button>
          );
        })}
      </div>
      <button onClick={onStart} style={{width:"100%",marginTop:14,padding:"13px",borderRadius:9,border:"none",
        background:`linear-gradient(90deg,${race.color},${C.amber})`,color:"#0b0f14",fontFamily:mono,
        fontWeight:700,fontSize:14,letterSpacing:2,cursor:"pointer"}}>
        {li===0?"🏁 スタート":"🏃 たすきを渡す"}</button>
    </ModalShell>
  );
}

/* 中継所モーダル: たすきリレーの瞬間。区間結果・繰り上げ・前後差。 */
function RelayModal({race,li,teams,legTimes,legInfo,myIdx,standingsAt,onNext,waveGap,isHakone}) {
  const L = race.legs[li];
  const st = standingsAt(li); // li区を終えた順位
  const myPos = st.findIndex(s=>s.team.isMe);
  const my = st[myPos];
  const leader = st[0];
  const myLegT = legTimes[myIdx][li];
  const myInfo = legInfo[myIdx][li];
  // 区間内順位(この区間タイムだけの速さ)
  const legRank = teams.map((t,ti)=>({ti,v:legTimes[ti][li]})).filter(x=>x.v!=null)
    .sort((a,b)=>a.v-b.v).findIndex(x=>x.ti===myIdx)+1;
  const aheadGap = myPos>0 ? my.cum - st[myPos-1].cum : null;
  const behindGap = myPos<st.length-1 ? st[myPos+1].cum - my.cum : null;
  const gapToLeader = my.cum - leader.cum;
  // 繰り上げスタート: トップからwaveGap以上離れた校(次区間)。自校が該当か。
  const waved = st.filter(s=> s.cum - leader.cum > waveGap);
  const meWaved = waved.some(s=>s.team.isMe);
  const next = teams[myIdx].legRunners[li+1];
  const dayForm = myInfo?.dayForm ?? 0;
  const formLabel = dayForm>0.4?"会心の走り":dayForm>0.1?"good":dayForm<-0.4?"大失速":dayForm<-0.1?"いまひとつ":"平常";
  const formColor = dayForm>0.1?C.green:dayForm<-0.4?C.red:dayForm<-0.1?C.amber:C.sub;

  return (
    <ModalShell color={race.color}>
      <div style={{fontSize:10,color:C.sub,letterSpacing:1}}>
        {race.stations?.[li+1] ? `${race.stations[li+1]}中継所 通過` : `${L.n}区 → ${L.n+1}区 中継所`}
        {isHakone && race.outboundGoalAt===li+1 && <span style={{color:C.gold,marginLeft:6}}>★往路ゴール</span>}</div>
      <div style={{fontFamily:serif,fontSize:20,fontWeight:700,marginTop:2}}>
        {teams[myIdx].legRunners[li].name} <span style={{fontSize:12,color:C.sub}}>が襷を運ぶ</span></div>

      {/* 区間結果 */}
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <div style={{flex:1,background:C.panel2,borderRadius:8,padding:"8px 10px",textAlign:"center",border:`1px solid ${C.line}`}}>
          <div style={{fontSize:10,color:C.sub}}>区間タイム</div>
          <div style={{fontSize:16,fontWeight:700,color:race.color}}>{fmtTime(myLegT)}</div>
          <div style={{fontSize:10,color:legRank<=3?C.gold:C.dim}}>区間{legRank}位{legRank===1?" 🏆":""}</div>
        </div>
        <div style={{flex:1,background:C.panel2,borderRadius:8,padding:"8px 10px",textAlign:"center",border:`1px solid ${C.line}`}}>
          <div style={{fontSize:10,color:C.sub}}>総合順位</div>
          <div style={{fontSize:16,fontWeight:700,color:race.color}}>{myPos+1}位</div>
          <div style={{fontSize:10,color:C.dim}}>/{st.length}校</div>
        </div>
        <div style={{flex:1,background:C.panel2,borderRadius:8,padding:"8px 10px",textAlign:"center",border:`1px solid ${C.line}`}}>
          <div style={{fontSize:10,color:C.sub}}>当日の調子</div>
          <div style={{fontSize:13,fontWeight:700,color:formColor}}>{formLabel}</div>
          {myInfo?.blow && <div style={{fontSize:10,color:C.red}}>つぶれ</div>}
        </div>
      </div>

      {/* 前後差 */}
      <div style={{marginTop:10,padding:"10px 12px",background:C.panel,borderRadius:8,border:`1px solid ${C.line}`}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0"}}>
          <span style={{color:C.sub}}>前の{myPos>0?st[myPos-1].team.name:"—"}まで</span>
          <span style={{fontWeight:700,color:aheadGap!=null?C.amber:C.dim}}>{aheadGap!=null?"-"+fmtTime(aheadGap):"首位"}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderTop:`1px solid ${C.line}`}}>
          <span style={{color:C.sub}}>後ろの{myPos<st.length-1?st[myPos+1].team.name:"—"}まで</span>
          <span style={{fontWeight:700,color:behindGap!=null?C.cyan:C.dim}}>{behindGap!=null?"+"+fmtTime(behindGap):"最後尾"}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",borderTop:`1px solid ${C.line}`}}>
          <span style={{color:C.sub}}>トップ({leader.team.name})まで</span>
          <span style={{fontWeight:700,color:myPos===0?C.gold:C.sub}}>{myPos===0?"首位":"-"+fmtTime(gapToLeader)}</span>
        </div>
      </div>

      {isHakone && (
        <div style={{marginTop:8,fontSize:11,fontWeight:700,textAlign:"center",
          color:myPos+1<=10?C.green:C.red}}>
          {myPos+1<=10? `シード圏内 (${myPos+1}位 / ボーダー10位)` : `シード圏外 (${myPos+1}位 — あと${myPos+1-10}つ)`}</div>
      )}

      {/* 繰り上げスタート演出 */}
      {meWaved && (
        <div style={{marginTop:10,padding:"8px 10px",borderRadius:8,background:C.red+"22",border:`1px solid ${C.red}`}}>
          <div style={{fontSize:12,fontWeight:700,color:C.red}}>⚠ 繰り上げスタート</div>
          <div style={{fontSize:10.5,color:C.sub,marginTop:2,lineHeight:1.4}}>
            トップから{fmtTime(waveGap)}以上離れ、{next?.name}は一斉スタート。実際の総合計時は継続されます。</div>
        </div>
      )}
      {/* 繰り上げ緊迫演出: 回避したがギリギリだった場合 */}
      {isHakone && !meWaved && myPos>0 && (waveGap - gapToLeader) <= 120 && (waveGap - gapToLeader) > 0 && (
        <div style={{marginTop:10,padding:"8px 10px",borderRadius:8,background:C.amber+"1c",border:`1px solid ${C.amber}`}}>
          <div style={{fontSize:12,fontWeight:700,color:C.amber}}>
            ⏱ 繰り上げまで残り{Math.round(waveGap - gapToLeader)}秒 — 間一髪、襷が繋がった!</div>
        </div>
      )}
      {!meWaved && waved.length>0 && (
        <div style={{marginTop:8,fontSize:10,color:C.dim}}>※ {waved.length}校が繰り上げスタート対象</div>
      )}

      {/* 往路ゴール(芦ノ湖): 往路成績を表示 */}
      {isHakone && race.outboundGoalAt===li+1 && (
        <div style={{marginTop:10,padding:"10px 12px",background:C.panel,borderRadius:8,
          border:`1px solid ${C.gold}66`}}>
          <div style={{fontSize:11,fontWeight:700,color:C.gold,letterSpacing:1,marginBottom:6}}>
            🏔 往路成績 — 芦ノ湖</div>
          {st.slice(0,5).map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,padding:"2px 0",
              color:s.team.isMe?race.color:C.sub,fontWeight:s.team.isMe?700:400}}>
              <span style={{minWidth:22,color:i===0?C.gold:C.dim,fontWeight:700}}>{i+1}</span>
              <span style={{flex:1}}>{s.team.name}</span>
              <span style={{fontFamily:mono,fontSize:10.5}}>
                {i===0? fmtTime(Math.round(s.cum)) : "+"+fmtTime(Math.round(s.cum-st[0].cum))}</span>
            </div>
          ))}
          {myPos>=5 && (
            <div style={{display:"flex",alignItems:"center",gap:8,fontSize:11,padding:"2px 0",
              borderTop:`1px dashed ${C.line}`,marginTop:3,color:race.color,fontWeight:700}}>
              <span style={{minWidth:22}}>{myPos+1}</span>
              <span style={{flex:1}}>{my.team.name}</span>
              <span style={{fontFamily:mono,fontSize:10.5}}>+{fmtTime(Math.round(my.cum-st[0].cum))}</span>
            </div>
          )}
          {myPos===0 && (
            <div style={{marginTop:6,fontSize:12,fontWeight:700,color:C.gold,textAlign:"center"}}>
              🏆 往路優勝!</div>
          )}
          <div style={{marginTop:6,fontSize:10,color:C.dim}}>翌朝、復路6区は山下りから始まります。</div>
        </div>
      )}

      <div style={{marginTop:12,fontSize:10,color:C.sub}}>次・{L.n+1}区 走者: <b style={{color:C.txt,fontFamily:serif,fontSize:13}}>{next?.name}</b></div>
      <button onClick={onNext} style={{width:"100%",marginTop:8,padding:"13px",borderRadius:9,border:"none",
        background:`linear-gradient(90deg,${race.color},${C.amber})`,color:"#0b0f14",fontFamily:mono,
        fontWeight:700,fontSize:14,letterSpacing:1,cursor:"pointer"}}>
        {isHakone && race.outboundGoalAt===li+1 ? "復路へ — 6区に指示を出す →" : `${L.n+1}区へ — 指示を出す →`}</button>
    </ModalShell>
  );
}

/* スプリット通過モーダル: 5km毎のラップ・前後の大学とのタイム差 */
function SplitModal({race,li,teams,myIdx,legTimes,legProfiles,legInfo,boundaryIdx,onResume,onSkip,isHakone}) {
  const L = race.legs[li];
  const prof = legProfiles[myIdx]?.[li];
  if (!prof) return null;
  const chk = prof.checks[boundaryIdx];
  const prev = boundaryIdx>0 ? prof.checks[boundaryIdx-1] : {km:0, t:0};
  const lap = chk.t - prev.t;
  const myLegT = legTimes[myIdx][li];
  const state = computeRoadPositions(teams, legTimes, legProfiles, li, chk.t/myLegT, myIdx, L.dist);
  // 前後の最接近校
  let aheadTi=-1, aheadGap=Infinity, behindTi=-1, behindGap=Infinity;
  state.gaps.forEach((g,ti)=>{
    if (ti===myIdx) return;
    if (g<0 && -g<aheadGap){ aheadGap=-g; aheadTi=ti; }
    if (g>0 && g<behindGap){ behindGap=g; behindTi=ti; }
  });
  const rn = teams[myIdx].legRunners[li];
  const myInf = legInfo[myIdx][li];
  const blowHere = myInf?.blow && prof.blowAtKm!=null && prof.blowAtKm>=prev.km && prof.blowAtKm<chk.km+0.01;
  // ラップ評価: 区間平均ペースとの比較
  const evenLap = myLegT * (chk.km - prev.km) / L.dist;
  const diff = lap - evenLap;
  const lapTone = diff < -3 ? C.green : diff > 3 ? (blowHere?C.red:C.amber) : C.sub;
  const lapNote = blowHere ? "失速…!" : diff < -6 ? "ハイペース!" : diff < -3 ? "良いペース" : diff > 6 ? "ペースダウン" : diff > 3 ? "やや落ちる" : "イーブン";
  return (
    <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:50,
      display:"flex",justifyContent:"center",pointerEvents:"none"}}>
      <div style={{width:"100%",maxWidth:480,background:"#0b0f14f0",pointerEvents:"auto",
        borderTop:`3px solid ${race.color}`,borderRadius:"16px 16px 0 0",
        padding:"12px 16px 18px",boxShadow:"0 -8px 40px #000c",
        maxHeight:"52vh",overflowY:"auto"}}>
      <div style={{display:"flex",alignItems:"baseline",gap:8}}>
        <span style={{fontFamily:serif,fontSize:18,fontWeight:700,color:race.color}}>{chk.km}km地点 通過</span>
        <span style={{fontSize:10,color:C.sub}}>第{L.n}区 {race.stations?.[li]}→{race.stations?.[li+1]}</span>
      </div>

      {/* 自校走者のラップ */}
      <div style={{marginTop:8,padding:"9px 12px",background:C.panel2,borderRadius:8,border:`1px solid ${C.line}`}}>
        <div style={{display:"flex",alignItems:"baseline",gap:8}}>
          <span style={{fontFamily:serif,fontSize:15,fontWeight:700}}>{rn.name}</span>
          <span style={{fontSize:11,color:race.color,fontWeight:700,marginLeft:"auto"}}>現在 {state.liveRank}位</span>
        </div>
        <div style={{display:"flex",gap:8,marginTop:7}}>
          <div style={{flex:1,textAlign:"center",background:C.panel,borderRadius:7,padding:"6px 4px"}}>
            <div style={{fontSize:10,color:C.sub}}>ラップ ({prev.km}→{chk.km}km)</div>
            <div style={{fontSize:15,fontWeight:700,color:lapTone,fontFamily:mono}}>{fmtTime(Math.round(lap))}</div>
            <div style={{fontSize:10,color:lapTone}}>{lapNote}</div>
          </div>
          <div style={{flex:1,textAlign:"center",background:C.panel,borderRadius:7,padding:"6px 4px"}}>
            <div style={{fontSize:10,color:C.sub}}>通過タイム</div>
            <div style={{fontSize:15,fontWeight:700,color:C.txt,fontFamily:mono}}>{fmtTime(Math.round(chk.t))}</div>
            <div style={{fontSize:10,color:C.dim}}>残り {(L.dist-chk.km).toFixed(1)}km</div>
          </div>
        </div>
        {blowHere && (
          <div style={{marginTop:7,padding:"5px 9px",background:C.red+"22",border:`1px solid ${C.red}`,
            borderRadius:6,fontSize:10.5,color:C.red,fontWeight:700}}>
            ⚠ {rn.name}の様子がおかしい。腕振りが乱れ、ペースが上がらない!</div>
        )}
      </div>

      {/* 前後の大学 */}
      <div style={{marginTop:7,padding:"8px 12px",background:C.panel,borderRadius:8,border:`1px solid ${C.line}`}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:1,marginBottom:4}}>前後の大学</div>
        {aheadTi>=0 ? (
          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,padding:"2px 0"}}>
            <span style={{fontSize:10,color:C.amber,minWidth:26}}>▲前</span>
            <span style={{color:C.txt,fontWeight:700,minWidth:64}}>{teams[aheadTi].name}</span>
            <span style={{fontFamily:serif,flex:1}}>{teams[aheadTi].legRunners[li]?.name}</span>
            <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:C.amber}}>-{fmtTime(Math.round(aheadGap))}</span>
          </div>
        ) : (
          <div style={{fontSize:11,color:C.gold,fontWeight:700,padding:"2px 0"}}>👑 首位を独走中</div>
        )}
        {behindTi>=0 ? (
          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,padding:"2px 0",
            borderTop:`1px solid ${C.line}`}}>
            <span style={{fontSize:10,color:C.cyan,minWidth:26}}>▼後</span>
            <span style={{color:C.txt,fontWeight:700,minWidth:64}}>{teams[behindTi].name}</span>
            <span style={{fontFamily:serif,flex:1}}>{teams[behindTi].legRunners[li]?.name}</span>
            <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:C.cyan}}>+{fmtTime(Math.round(behindGap))}</span>
          </div>
        ) : (
          <div style={{fontSize:11,color:C.dim,padding:"2px 0",borderTop:`1px solid ${C.line}`}}>後方に他校なし(最後尾)</div>
        )}
      </div>

      {isHakone && li>=7 && (
        <div style={{marginTop:7,fontSize:11,fontWeight:700,textAlign:"center",
          color:state.liveRank<=10?C.green:C.red}}>
          {state.liveRank<=10 ? `シード圏内 (${state.liveRank}位)` : `シード圏外 (${state.liveRank}位)`}</div>
      )}

      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={onResume} style={{flex:2,padding:"12px",borderRadius:9,border:"none",
          background:`linear-gradient(90deg,${race.color},${C.amber})`,color:"#0b0f14",fontFamily:mono,
          fontWeight:700,fontSize:14,letterSpacing:1,cursor:"pointer"}}>▶ そのまま進む</button>
        <button onClick={onSkip} style={{flex:1,padding:"12px",borderRadius:9,
          border:`1px solid ${C.line}`,background:C.panel,color:C.sub,fontFamily:mono,
          fontSize:11,cursor:"pointer"}}>⏭ 中継所へ</button>
      </div>
      </div>
    </div>
  );
}

function ModalShell({children,color}) {
  // 非ブロック型ボトムシート: 背景を暗転させず、上部のロードビューが見えたままにする
  return (
    <div style={{position:"fixed",left:0,right:0,bottom:0,zIndex:50,
      display:"flex",justifyContent:"center",pointerEvents:"none"}}>
      <div style={{width:"100%",maxWidth:480,maxHeight:"58vh",overflowY:"auto",
        background:"#0b0f14f2",pointerEvents:"auto",
        borderTop:`3px solid ${color}`,borderRadius:"16px 16px 0 0",padding:"14px 16px 20px",
        boxShadow:"0 -8px 40px #000c"}}>
        {children}
      </div>
    </div>
  );
}

/* ============================================================
   箱根予選会 結果
   ============================================================ */
/* ============================================================
   高校生スカウト画面
   ============================================================ */
function ScoutScreen({prospects,scoutEfforts,setScoutEfforts,scoutBudget,scoutResolved,scoutResult,myStrength,onResolve,onBack}) {
  const [showResult, setShowResult] = useState(scoutResolved);
  useEffect(()=>{ if (scoutResolved) setShowResult(true); },[scoutResolved]);
  const totalSpent = Object.values(scoutEfforts).reduce((a,b)=>a+b,0);
  const remaining = Math.max(0, scoutBudget - totalSpent);

  const setEffort = (id, v) => {
    const others = Object.entries(scoutEfforts).filter(([k])=>+k!==id).reduce((a,[,b])=>a+b,0);
    const max = scoutBudget - others;
    const next = clamp(v, 0, Math.min(max, 30)); // 1名上限30pt
    setScoutEfforts(prev => ({...prev, [id]: next}));
  };

  // 推定マッチ率(競合は内部評価値ベースの粗い指標)
  const estimateOdds = (p) => {
    const myEffort = scoutEfforts[p.id]||0;
    const myAff = prospectAffinity(p, myStrength, []);
    const myScore = myEffort * (1 + myAff/50);
    // 人気度(fame)を競合圧の近似に
    const rivalPressure = (p.fame/100) * 60 + 8;
    const total = myScore + rivalPressure + 10;
    return Math.round(myScore/total*100);
  };

  if (showResult && scoutResult) {
    return (
      <div style={{padding:"14px 14px 90px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <button onClick={onBack} style={backBtn}>←</button>
          <div>
            <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.purple}}>スカウト結果</div>
            <div style={{fontSize:10,color:C.sub}}>来春入学 {scoutResult.recruitedCount}名 ・ 候補{scoutResult.detail.length}名中</div>
          </div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {scoutResult.detail.map((d,i)=>{
            const p = d.prospect;
            const me = d.chosen.isMe;
            const other = d.chosen.isOther;
            return (
              <div key={i} style={{background:C.panel,border:`1px solid ${me?C.purple:C.line}`,
                borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontFamily:serif,fontSize:14,fontWeight:700,color:me?C.purple:C.txt}}>{p.name}</span>
                    <span style={{fontSize:10,color:C.dim}}>{p.school}</span>
                  </div>
                  <span style={{fontSize:11,fontWeight:700,
                    color: me?C.green: other?C.dim:C.amber}}>
                    {me? "✓ 自校へ":other?"未進学/他大学":"→ "+d.chosen.name}</span>
                </div>
                <div style={{fontSize:10,color:C.sub,marginTop:4,display:"flex",gap:12}}>
                  <span>5000 {fmtTime(p.best5000)}</span>
                  <span>潜在 {"★".repeat(clamp(Math.round(p.pot/20),1,5))}</span>
                  <span>投入 {d.myEffort}pt</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:10,color:C.dim,marginTop:12,lineHeight:1.5}}>
          スカウト結果は確定済みです。獲得した高校生はシーズン終了時に1年生として入学します。</div>
      </div>
    );
  }

  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div>
          <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.purple}}>高校生スカウト</div>
          <div style={{fontSize:10,color:C.sub}}>候補 {prospects.length}名 ・ 残ポイント {remaining}/{scoutBudget}</div>
        </div>
      </div>
      <div style={{padding:"8px 12px",background:C.panel2,borderRadius:8,marginBottom:10,
        border:`1px solid ${C.line}`,fontSize:10.5,color:C.sub,lineHeight:1.5}}>
        ポイントを配分するほど自校を選ぶ確率が上がります。各候補の<b style={{color:C.txt}}>希望</b>(強豪志向/中堅志向、伸ばしたい方向性)が自校と合致すると更に有利。1名上限30pt。
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {prospects.map(p=>{
          const eff = scoutEfforts[p.id]||0;
          const odds = estimateOdds(p);
          const tierLabel = p.pot>=88?"超有望":p.pot>=78?"有望":p.pot>=68?"標準":"未知数";
          const tierColor = p.pot>=88?C.gold:p.pot>=78?C.amber:p.pot>=68?C.cyan:C.sub;
          return (
            <div key={p.id} style={{background:C.panel,border:`1px solid ${eff>0?C.purple:C.line}`,
              borderRadius:8,padding:"10px 12px"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:serif,fontSize:15,fontWeight:700}}>{p.name}</span>
                  <span style={{fontSize:10,color:C.dim}}>{p.school}</span>
                </div>
                <span style={{fontSize:10,fontWeight:700,color:tierColor}}>{tierLabel}</span>
              </div>
              <div style={{fontSize:10,color:C.sub,display:"flex",gap:10,marginBottom:6,flexWrap:"wrap"}}>
                <span>5000 <b style={{color:C.txt}}>{fmtTime(p.best5000)}</b></span>
                <span>潜在 <b style={{color:tierColor}}>{"★".repeat(clamp(Math.round(p.pot/20),1,5))}</b></span>
                <span style={{color:C.amber}}>{PREF_TEAM_LABEL[p.prefTeam]}</span>
                <span style={{color:C.cyan}}>{PREF_STYLE_LABEL[p.prefStyle]}</span>
                <span>人気 {p.fame}</span>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <button onClick={()=>setEffort(p.id, eff-2)} disabled={eff<=0}
                  style={ptBtn(eff<=0)}>−</button>
                <div style={{flex:1,height:8,background:"#11161d",borderRadius:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${(eff/30)*100}%`,background:C.purple,transition:"width .15s"}}/>
                </div>
                <button onClick={()=>setEffort(p.id, eff+2)} disabled={remaining<=0||eff>=30}
                  style={ptBtn(remaining<=0||eff>=30)}>＋</button>
                <div style={{minWidth:64,textAlign:"right"}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.purple}}>{eff}pt</div>
                  <div style={{fontSize:10,color:C.dim}}>勝率 {odds}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:16,padding:"12px 14px",background:C.panel2,borderRadius:9,
        border:`1px solid ${C.purple}66`}}>
        <div style={{fontSize:11,fontWeight:700,color:C.purple,marginBottom:4}}>📅 9月3週にマッチング発表</div>
        <div style={{fontSize:10.5,color:C.sub,lineHeight:1.5}}>
          結果は9月3週(週23)に各大学のスカウト圧と本人の希望をもとに一括発表されます。それまで何度でもポイントを再配分できます。</div>
      </div>
      <div style={{fontSize:10,color:C.dim,marginTop:8,lineHeight:1.5}}>
        ※9月3週時点で残ポイントがあっても使い切れずに失効します。早めの配分が肝心。</div>
    </div>
  );
}
const ptBtn = (disabled)=>({width:30,height:28,borderRadius:6,
  border:`1px solid ${disabled?C.dim:C.purple}`,background:disabled?"#11161d":C.panel2,
  color:disabled?C.dim:C.purple,fontSize:14,fontWeight:700,cursor:disabled?"default":"pointer"});

/* スカウト結果ポップアップ(9月3週に自動表示) */
function ScoutPopup({result,onClose,onSeeAll}) {
  const mine = result.detail.filter(d=>d.chosen.isMe);
  const lost = result.detail.filter(d=>!d.chosen.isMe && d.myEffort>0);
  return (
    <div style={{position:"fixed",inset:0,zIndex:80,background:"#000c",backdropFilter:"blur(3px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{width:"100%",maxWidth:440,maxHeight:"88vh",overflowY:"auto",background:C.bg,
        border:`2px solid ${C.purple}`,borderRadius:14,padding:"18px 16px 20px",
        boxShadow:`0 12px 60px ${C.purple}55`}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:10,color:C.purple,letterSpacing:2}}>📅 9月3週 ・ スカウト結果発表</div>
          <div style={{fontFamily:serif,fontSize:24,fontWeight:700,marginTop:4,color:C.purple}}>
            来春入学 {mine.length}名</div>
        </div>
        {mine.length>0 ? (
          <div style={{background:C.panel,border:`1px solid ${C.purple}66`,borderRadius:9,overflow:"hidden",marginBottom:10}}>
            {mine.map((d,i)=>{
              const p = d.prospect;
              const tier = p.pot>=88?"超有望":p.pot>=78?"有望":p.pot>=68?"標準":"未知数";
              const tc = p.pot>=88?C.gold:p.pot>=78?C.amber:p.pot>=68?C.cyan:C.sub;
              return (
                <div key={i} style={{padding:"10px 12px",
                  borderBottom: i<mine.length-1?`1px solid ${C.line}`:"none"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontFamily:serif,fontSize:15,fontWeight:700,color:C.green}}>✓ {p.name}</span>
                      <span style={{fontSize:10,color:C.dim}}>{p.school}</span>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,color:tc}}>{tier}</span>
                  </div>
                  <div style={{fontSize:10,color:C.sub,marginTop:3,display:"flex",gap:10}}>
                    <span>5000 {fmtTime(p.best5000)}</span>
                    <span>潜在 {"★".repeat(clamp(Math.round(p.pot/20),1,5))}</span>
                    <span>投入 {d.myEffort}pt</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{textAlign:"center",fontSize:12,color:C.sub,padding:"14px",
            background:C.panel,borderRadius:8,marginBottom:10}}>
            残念ながら今年は獲得ゼロでした。来年に向けてポイント配分を見直しましょう。</div>
        )}
        {lost.length>0 && (
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,color:C.sub,marginBottom:4,letterSpacing:1}}>逃した候補 ({lost.length}名)</div>
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}>
              {lost.slice(0,5).map((d,i)=>{
                const p = d.prospect;
                return (
                  <div key={i} style={{padding:"6px 12px",fontSize:10,
                    display:"flex",justifyContent:"space-between",alignItems:"center",
                    borderBottom: i<Math.min(4,lost.length-1)?`1px solid ${C.line}`:"none"}}>
                    <span style={{fontFamily:serif,fontSize:12,color:C.sub}}>{p.name}</span>
                    <span style={{fontSize:10,color:d.chosen.isOther?C.dim:C.amber}}>
                      {d.chosen.isOther?"未進学/他":"→ "+d.chosen.name} ({d.myEffort}pt)</span>
                  </div>
                );
              })}
              {lost.length>5 && <div style={{padding:"5px 12px",fontSize:10,color:C.dim,textAlign:"center"}}>他 {lost.length-5}名</div>}
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onSeeAll} style={{flex:1,padding:"11px",borderRadius:8,border:`1px solid ${C.line}`,
            background:C.panel,color:C.sub,fontFamily:mono,fontSize:12,cursor:"pointer"}}>全結果を見る</button>
          <button onClick={onClose} style={{flex:2,padding:"11px",borderRadius:8,border:"none",
            background:`linear-gradient(90deg,${C.purple},${C.cyan})`,color:"#0b0f14",fontFamily:mono,
            fontWeight:700,fontSize:13,letterSpacing:1,cursor:"pointer"}}>確認 ✓</button>
        </div>
        <div style={{fontSize:10.5,color:C.dim,marginTop:8,lineHeight:1.5,textAlign:"center"}}>
          獲得選手はシーズン終了時(来年4月)に1年生として正式入学します。</div>
      </div>
    </div>
  );
}

/* ============================================================
   月次レポート ポップアップ(毎月1週)
   ============================================================ */
function MonthlyReportPopup({report,onClose}) {
  const {month,year,grew,upcoming,injured,tired} = report;
  const monthColor = month>=3 && month<=5 ? C.green : month>=6 && month<=8 ? C.amber :
                     month>=9 && month<=11 ? C.cyan : C.blue;
  return (
    <div style={{position:"fixed",inset:0,zIndex:80,background:"#000c",backdropFilter:"blur(3px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{width:"100%",maxWidth:440,maxHeight:"88vh",overflowY:"auto",background:C.bg,
        border:`2px solid ${monthColor}`,borderRadius:14,padding:"18px 16px 20px",
        boxShadow:`0 12px 60px ${monthColor}55`}}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:10,color:monthColor,letterSpacing:3}}>📋 主務からの月次レポート</div>
          <div style={{fontFamily:serif,fontSize:24,fontWeight:700,marginTop:4,color:monthColor}}>
            {year}年目 {month}月</div>
        </div>

        {/* 先月の伸び */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:C.gold,marginBottom:6,letterSpacing:1}}>📈 先月成長した選手</div>
          {grew.length===0 ? (
            <div style={{fontSize:10,color:C.dim,padding:"8px 12px",background:C.panel,borderRadius:7}}>
              目立った伸びはありませんでした。練習メニューを見直してみては。</div>
          ) : (
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}>
              {grew.map((g,i)=>(
                <div key={i} style={{padding:"7px 11px",fontSize:11,
                  borderBottom: i<grew.length-1?`1px solid ${C.line}`:"none",
                  display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:serif,fontSize:12,fontWeight:700,minWidth:90}}>
                    {g.name}<span style={{fontSize:10,color:C.dim,fontFamily:mono,marginLeft:3}}>({g.grade})</span></span>
                  <span style={{flex:1,fontSize:10,color:C.sub,display:"flex",gap:6,flexWrap:"wrap"}}>
                    {g.dSpd>0.1 && <span style={{color:C.red}}>SPD+{g.dSpd}</span>}
                    {g.dSta>0.1 && <span style={{color:C.cyan}}>STA+{g.dSta}</span>}
                    {g.dSpr>0.1 && <span style={{color:C.amber}}>勝負+{g.dSpr}</span>}
                    {g.dUph>0.1 && <span style={{color:C.purple}}>山+{g.dUph}</span>}
                  </span>
                  <span style={{fontSize:11,fontWeight:700,color:C.green}}>+{g.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 今月の予定 */}
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,fontWeight:700,color:monthColor,marginBottom:6,letterSpacing:1}}>📅 今月の予定</div>
          {upcoming.length===0 ? (
            <div style={{fontSize:10,color:C.dim,padding:"8px 12px",background:C.panel,borderRadius:7}}>
              特別な大会はありません。練習に集中できる月です。</div>
          ) : (
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:8,overflow:"hidden"}}>
              {upcoming.map((u,i)=>(
                <div key={i} style={{padding:"7px 11px",fontSize:11,
                  borderBottom:i<upcoming.length-1?`1px solid ${C.line}`:"none"}}>
                  <span style={{color:monthColor,marginRight:6}}>●</span>{u}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 警告: 故障・疲労 */}
        {(injured.length>0 || tired.length>0) && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:C.red,marginBottom:6,letterSpacing:1}}>⚠ 注意</div>
            <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:8,padding:"8px 11px",fontSize:10,color:C.sub,lineHeight:1.6}}>
              {injured.length>0 && <div>故障離脱中: {injured.join("、")}</div>}
              {tired.length>0 && <div style={{color:C.amber,marginTop:injured.length>0?4:0}}>疲労蓄積: {tired.join("、")}</div>}
            </div>
          </div>
        )}

        <button onClick={onClose} style={{width:"100%",padding:"12px",borderRadius:8,border:"none",
          background:`linear-gradient(90deg,${monthColor},${C.amber})`,color:"#0b0f14",fontFamily:mono,
          fontWeight:700,fontSize:13,letterSpacing:1,cursor:"pointer"}}>承知しました ✓</button>
      </div>
    </div>
  );
}

/* ============================================================
   4年生引退ポップアップ(1月2週)
   ============================================================ */
function RetirePopup({info,onClose}) {
  return (
    <div style={{position:"fixed",inset:0,zIndex:80,background:"#000c",backdropFilter:"blur(3px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{width:"100%",maxWidth:420,background:C.bg,
        border:`2px solid ${C.gold}`,borderRadius:14,padding:"22px 18px",
        boxShadow:`0 12px 60px ${C.gold}66`,textAlign:"center"}}>
        <div style={{fontSize:10,color:C.gold,letterSpacing:3}}>1月2週 ・ 4年生引退</div>
        <div style={{fontFamily:serif,fontSize:24,fontWeight:700,marginTop:6,color:C.gold}}>襷を渡して</div>
        <div style={{fontSize:10,color:C.sub,marginTop:10,lineHeight:1.6}}>
          箱根駅伝を終えて4年生が陸上部を引退しました。<br/>記録室には永久に記録が残ります。</div>
        <div style={{marginTop:14,padding:"12px",background:C.panel,border:`1px solid ${C.line}`,borderRadius:9}}>
          {info.names.map((n,i)=>(
            <div key={i} style={{fontFamily:serif,fontSize:14,fontWeight:700,color:C.txt,padding:"3px 0"}}>{n}</div>
          ))}
        </div>
        <button onClick={onClose} style={{width:"100%",marginTop:16,padding:"12px",borderRadius:8,border:"none",
          background:`linear-gradient(90deg,${C.gold},${C.amber})`,color:"#111",fontFamily:mono,
          fontWeight:700,fontSize:13,letterSpacing:2,cursor:"pointer"}}>送り出す</button>
      </div>
    </div>
  );
}

/* ============================================================
   チュートリアル (1年目最初の一度だけ)
   ============================================================ */
function TutorialPopup({teamName,onClose}) {
  const [step,setStep] = useState(0);
  const steps = [
    {
      title: `${teamName || "大学"} 駅伝部監督就任`,
      subtitle: "ようこそ、駅伝部監督へ",
      body: (
        <>
          <div style={{fontSize:11,color:C.txt,lineHeight:1.7,marginBottom:10}}>
            あなたはこの大学の陸上部監督に就任しました。目標は<b style={{color:C.gold}}>三大駅伝(出雲・全日本・箱根)の三冠達成</b>です。
          </div>
          <div style={{fontSize:10,color:C.sub,lineHeight:1.6,padding:"9px 11px",background:C.panel2,borderRadius:7}}>
            <b style={{color:C.txt}}>選手24名(各学年6名)</b>を預かって、練習で鍛え、大会でぶつけていきます。<br/>
            1年 = 48週。<b style={{color:C.cyan}}>4月1週にスタート</b>、<b style={{color:C.blue}}>翌1月1週に箱根</b>、そして3月4週で次年度へ。
          </div>
        </>
      ),
    },
    {
      title: "1年間の流れ",
      subtitle: "主要イベントを覚えておこう",
      body: (
        <>
          <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:10.5}}>
            <TutorialRow color={C.cyan} label="5月2週" text="関東インカレ (10000m)" />
            <TutorialRow color={C.purple} label="7月1週" text="高校生スカウト開始 (来春入学の候補15名)" />
            <TutorialRow color={C.amber} label="8月" text="夏合宿 (スタミナ増強)" />
            <TutorialRow color={C.amber} label="9月2週" text="日本インカレ" />
            <TutorialRow color={C.purple} label="9月3週" text="スカウト結果発表" />
            <TutorialRow color={C.cyan} label="10月2週" text="🏆 出雲路駅伝" bold/>
            <TutorialRow color={C.red} label="10月3週" text="箱根予選会 (非シード校のみ)" />
            <TutorialRow color={C.gold} label="11月1週" text="🏆 全日本大学駅伝" bold/>
            <TutorialRow color={C.green} label="11月2-4週" text="上尾ハーフ・八王子ロング" />
            <TutorialRow color={C.blue} label="1月1週" text="🏆 箱根山駅伝 (シーズン最大の頂点)" bold/>
            <TutorialRow color={C.gold} label="1月2週" text="4年生引退" />
          </div>
        </>
      ),
    },
    {
      title: "操作の基本",
      subtitle: "画面下部のナビから",
      body: (
        <div style={{fontSize:10.5,color:C.sub,lineHeight:1.7}}>
          <div style={{marginBottom:8}}><b style={{color:C.txt}}>🏠 本部</b> — 今週のイベント確認 / 練習編成 / 週送り</div>
          <div style={{marginBottom:8}}><b style={{color:C.txt}}>👥 選手</b> — 24名の能力・PB・調子 / 今週の練習バッジ</div>
          <div style={{marginBottom:8}}><b style={{color:C.txt}}>🧭 編成室</b> — 練習枠・班・未所属選手を1画面で編成</div>
          <div style={{marginBottom:8}}><b style={{color:C.txt}}>🏆 記録室</b> — 距離別ランキング / 大会アーカイブ</div>
          <div style={{marginTop:12,padding:"9px 11px",background:C.panel2,borderRadius:7,fontSize:10,color:C.dim,lineHeight:1.6}}>
            <b style={{color:C.gold}}>💡 ヒント:</b> 初年度は<b style={{color:C.txt}}>中堅校スタート</b>。三冠は数年計画です。まずは記録会や関東インカレで持ちタイムを伸ばし、秋の駅伝で戦力を確かめましょう。
          </div>
        </div>
      ),
    },
  ];
  const cur = steps[step];
  const isLast = step === steps.length-1;

  return (
    <div style={{position:"fixed",inset:0,zIndex:90,background:"#000c",backdropFilter:"blur(3px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}>
      <div style={{width:"100%",maxWidth:460,maxHeight:"92vh",overflowY:"auto",background:C.bg,
        border:`2px solid ${C.gold}`,borderRadius:14,padding:"20px 18px",
        boxShadow:`0 12px 60px ${C.gold}55`}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:10,color:C.gold,letterSpacing:3}}>STEP {step+1} / {steps.length}</div>
          <div style={{fontFamily:serif,fontSize:22,fontWeight:700,marginTop:6,color:C.gold}}>{cur.title}</div>
          <div style={{fontSize:11,color:C.sub,marginTop:3}}>{cur.subtitle}</div>
        </div>

        {/* ステップインジケータ */}
        <div style={{display:"flex",gap:5,justifyContent:"center",marginBottom:14}}>
          {steps.map((_,i)=>(
            <div key={i} style={{width:i===step?18:6,height:5,borderRadius:3,
              background:i===step?C.gold:i<step?C.gold+"66":C.line,
              transition:"all .2s"}}/>
          ))}
        </div>

        {/* 本文 */}
        <div style={{marginBottom:16}}>{cur.body}</div>

        {/* ナビゲーション */}
        <div style={{display:"flex",gap:8}}>
          {step>0 && (
            <button onClick={()=>setStep(step-1)}
              style={{flex:1,padding:"11px",borderRadius:8,border:`1px solid ${C.line}`,
              background:C.panel,color:C.sub,fontFamily:mono,fontSize:12,cursor:"pointer"}}>← 戻る</button>
          )}
          {!isLast && (
            <button onClick={()=>setStep(step+1)}
              style={{flex:2,padding:"11px",borderRadius:8,
              background:C.panel2,color:C.gold,fontFamily:mono,fontWeight:700,
              fontSize:12,border:`1px solid ${C.gold}`,cursor:"pointer"}}>次へ →</button>
          )}
          {isLast && (
            <button onClick={onClose}
              style={{flex:2,padding:"11px",borderRadius:8,border:"none",
              background:`linear-gradient(90deg,${C.gold},${C.amber})`,color:"#111",fontFamily:mono,
              fontWeight:700,fontSize:13,letterSpacing:2,cursor:"pointer"}}>就任する ✓</button>
          )}
        </div>
      </div>
    </div>
  );
}
function TutorialRow({color,label,text,bold}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 9px",
      background:C.panel,border:`1px solid ${C.line}`,borderRadius:6}}>
      <span style={{fontSize:10,color:C.bg,background:color,
        borderRadius:3,padding:"2px 6px",fontWeight:700,minWidth:42,textAlign:"center"}}>{label}</span>
      <span style={{flex:1,color:bold?C.txt:C.sub,fontWeight:bold?700:400,fontFamily:serif}}>{text}</span>
    </div>
  );
}

/* ============================================================
   個人レース(meet) エントリー画面
   ============================================================ */
function MeetEntryScreen({meet,roster,onBack,onConfirm,onSkip}) {
  const [picked,setPicked] = useState([]);
  const healthy = roster.filter(r=>r.injury===0)
    .sort((a,b)=> meet.dist>=10000? a.best10000-b.best10000 : a.best5000-b.best5000);
  const cap = meet.capacity || 99;
  const toggle = (id) => setPicked(p => p.includes(id)? p.filter(x=>x!==id) : (p.length>=cap? p : [...p, id]));
  const dispDist = meet.dist>=1000? `${meet.dist/1000}km` : `${meet.dist}m`;
  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div>
          <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:meet.color}}>{meet.name}</div>
          <div style={{fontSize:10,color:C.sub}}>{dispDist} ・ エントリー上限{cap===99?"なし":`${cap}名`} ・ 選択中 {picked.length}名</div>
        </div>
      </div>
      <div style={{padding:"9px 12px",background:C.panel2,borderRadius:8,marginBottom:10,
        border:`1px solid ${C.line}`,fontSize:10.5,color:C.sub,lineHeight:1.5}}>
        {meet.desc}<br/>
        出走報酬: 持ちタイム更新の機会 ・ 能力上昇 ・ 疲労 +{meet.fatigue}</div>
      <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:"58vh",overflowY:"auto"}}>
        {healthy.map(r=>{
          const on = picked.includes(r.id);
          const expectedTime = meetTime({...r, condition:75, fatigue:r.fatigue}, meet);
          return (
            <button key={r.id} onClick={()=>toggle(r.id)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"8px 11px",
              background:on?meet.color+"22":C.panel,border:`1px solid ${on?meet.color:C.line}`,
              borderRadius:7,cursor:"pointer",textAlign:"left"}}>
              <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
                borderRadius:3,padding:"1px 5px",fontWeight:700}}>{r.grade}</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:serif,fontSize:14,fontWeight:on?700:400,color:on?meet.color:C.txt}}>{r.name}</div>
                <div style={{fontSize:10,color:C.dim,marginTop:1}}>
                  PB 5000 {fmtTime(r.best5000)} / 10000 {fmtTime(r.best10000)}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,fontWeight:700,color:meet.color}}>{fmtTime(expectedTime)}</div>
                <div style={{fontSize:10,color:C.dim}}>調子{Math.round(r.condition)} 疲労{Math.round(r.fatigue)}</div>
              </div>
            </button>
          );
        })}
      </div>
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button onClick={onSkip} style={{flex:1,padding:"13px",borderRadius:9,border:`1px solid ${C.line}`,
          background:C.panel,color:C.sub,fontFamily:mono,fontSize:13,cursor:"pointer"}}>出場しない</button>
        <button onClick={()=>onConfirm(picked)} disabled={picked.length===0}
          style={{flex:2,padding:"13px",borderRadius:9,border:"none",
          background: picked.length? `linear-gradient(90deg,${meet.color},${C.amber})`:"#2a2f37",
          color: picked.length? "#0b0f14":"#666",fontFamily:mono,fontWeight:700,
          fontSize:14,letterSpacing:1,cursor:picked.length?"pointer":"default"}}>
          🏁 {picked.length}名で出場</button>
      </div>
    </div>
  );
}

/* ============================================================
   個人レース 結果画面
   ============================================================ */
function MeetResultScreen({result,onContinue}) {
  const {meet, results} = result;
  const newPBs = results.filter(r=>r.newPB).length;
  return (
    <div style={{padding:"18px 14px 90px"}}>
      <div style={{textAlign:"center",marginBottom:14}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:2}}>{meet.name} 結果</div>
        <div style={{fontFamily:serif,fontSize:22,fontWeight:700,marginTop:4,color:meet.color}}>
          出走{results.length}名 / PB更新{newPBs}名</div>
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,overflow:"hidden"}}>
        {results.map((r,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"10px 14px",borderBottom: i<results.length-1?`1px solid ${C.line}`:"none",
            background: r.newPB? meet.color+"15":"transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:14,fontWeight:700,minWidth:22,
                color: i===0?C.gold:i<3?C.amber:C.sub}}>{i+1}</span>
              <span style={{fontFamily:serif,fontSize:14,fontWeight:700}}>{r.name}</span>
              {r.newPB && <span style={{fontSize:10,fontWeight:700,color:meet.color,
                border:`1px solid ${meet.color}`,borderRadius:4,padding:"1px 5px"}}>🏆 {r.newPB} PB</span>}
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:14,fontWeight:700,color:i===0?C.gold:C.txt}}>{fmtTime(r.time)}</div>
              {r.newPB && (
                <div style={{fontSize:10,color:meet.color}}>
                  {meet.dist===5000? `→ 5000 ${fmtTime(r.after.best5000)}`
                   : `→ 10000 ${fmtTime(r.after.best10000)}`}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:C.dim,marginTop:10,lineHeight:1.5}}>
        出走選手は疲労が +{meet.fatigue} 蓄積し、関連能力が伸びました。</div>
      <button onClick={onContinue} style={{width:"100%",marginTop:14,padding:"14px",borderRadius:10,
        border:"none",background:`linear-gradient(90deg,${C.green},#2f9c43)`,color:"#06210d",
        fontFamily:mono,fontWeight:700,fontSize:14,letterSpacing:2,cursor:"pointer"}}>▷ 本部へ戻る</button>
    </div>
  );
}

/* ============================================================
   箱根予選会 結果
   ============================================================ */
function YosenScreen({result,teamName,onContinue}) {
  return (
    <div style={{padding:"18px 14px 90px"}}>
      <div style={{textAlign:"center",marginBottom:16}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:2}}>{YOSEN.name} 結果</div>
        <div style={{fontFamily:serif,fontSize:22,fontWeight:700,marginTop:4,
          color: result.meQualified? C.green : C.red}}>
          {result.meSeeded? "シード校・予選免除" : result.meQualified? "予選通過" : "予選敗退"}</div>
        <div style={{fontSize:10,color:C.sub,marginTop:4}}>
          シード{result.seedCount}校 ＋ 予選上位{result.slots}校が本戦へ（上位{YOSEN.countTop}名のハーフ合計）</div>
      </div>
      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,overflow:"hidden"}}>
        {result.entries.map((e,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"9px 13px",borderBottom:i<result.entries.length-1?`1px solid ${C.line}`:"none",
            background: e.isMe? YOSEN.color+"22": e.qualified? "transparent":"#1a1012"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:13,fontWeight:700,minWidth:22,
                color: e.qualified? (i<result.slots?C.green:C.sub):C.red}}>{e.rank}</span>
              <span style={{fontFamily:serif,fontSize:14,fontWeight:e.isMe?700:400,
                color:e.isMe?YOSEN.color:C.txt}}>{e.name}</span>
              {e.isMe && <span style={{fontSize:10,color:YOSEN.color}}>● 自校</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:12,color:C.sub}}>{fmtTime(e.sum)}</span>
              <span style={{fontSize:10,fontWeight:700,minWidth:34,textAlign:"right",
                color:e.qualified?C.green:C.red}}>{e.qualified?"通過":"敗退"}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{fontSize:10,color:C.dim,marginTop:8,lineHeight:1.5}}>
        合計タイムは各校の調子・故障・適性を反映した上位{YOSEN.countTop}名の想定ハーフ合算です。</div>
      <button onClick={onContinue} style={{width:"100%",marginTop:16,padding:"14px",borderRadius:10,
        border:"none",background:`linear-gradient(90deg,${YOSEN.color},${C.amber})`,color:"#0b0f14",
        fontFamily:mono,fontWeight:700,fontSize:14,letterSpacing:2,cursor:"pointer"}}>▷ 本部へ戻る</button>
    </div>
  );
}

/* ============================================================
   レース結果
   ============================================================ */
function Result({result,onContinue}) {
  const race = RACES[result.raceKey];
  const win = result.myRank===1;
  const seedLine = result.seedLine; // 箱根のみ非null
  const gotSeed = seedLine && result.myRank<=seedLine;
  const myPrizes = (result.stagePrizes||[]).filter(p=>p.isMe);
  return (
    <div style={{padding:"20px 14px 90px"}}>
      <div style={{textAlign:"center",padding:"18px 0 18px"}}>
        <div style={{fontSize:10,color:C.sub,letterSpacing:2}}>{race.name} 最終結果</div>
        <div style={{fontFamily:serif,fontSize:60,fontWeight:700,lineHeight:1,marginTop:6,
          color:win?C.gold:result.myRank<=3?C.amber:C.txt}}>{result.myRank}<span style={{fontSize:24}}>位</span></div>
        <div style={{fontSize:13,color:C.sub,marginTop:6}}>総合 {fmtTime(result.myTime)}
          {!win && <span> ・ 優勝校と {fmtTime(result.myTime-result.leaderTime)} 差</span>}</div>
        {win && <div style={{marginTop:12,fontFamily:serif,fontSize:26,fontWeight:700,color:C.gold}}>🏆 優勝 🏆</div>}
        {/* シードボーダー演出(箱根) */}
        {seedLine && (
          <div style={{marginTop:12,display:"inline-block",padding:"8px 16px",borderRadius:10,
            background: gotSeed? C.green+"22":C.red+"22", border:`1px solid ${gotSeed?C.green:C.red}`}}>
            <div style={{fontSize:13,fontWeight:700,color:gotSeed?C.green:C.red}}>
              {gotSeed? `✓ シード権獲得（${result.myRank}位 / ${seedLine}位以内）`
                      : `✗ シード落ち（${result.myRank}位）来年は予選会から`}</div>
            {!gotSeed && result.myRank<=seedLine+2 && (
              <div style={{fontSize:10,color:C.amber,marginTop:3}}>あと{result.myRank-seedLine}つで悲願のシードだった…</div>)}
          </div>
        )}
        {result.myStageWins>0 && (
          <div style={{marginTop:10,fontSize:11,color:C.gold}}>🏅 区間賞 {result.myStageWins}個獲得</div>)}
      </div>

      {/* 今日の名場面(ハイライト) */}
      {result.highlights && result.highlights.length>0 && (
        <div style={{marginBottom:14,background:C.panel,border:`1px solid ${race.color}55`,
          borderRadius:10,padding:"11px 13px"}}>
          <div style={{fontSize:11,fontWeight:700,color:race.color,letterSpacing:1,marginBottom:8}}>
            📺 今日の名場面</div>
          {result.highlights.map((h,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"6px 0",
              borderBottom: i<result.highlights.length-1?`1px solid ${C.line}`:"none"}}>
              <span style={{fontSize:18,lineHeight:1.2}}>{h.icon}</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:C.txt}}>{h.title}</div>
                <div style={{fontSize:10.5,color:C.sub,marginTop:1,lineHeight:1.5}}>{h.desc}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 総合順位表(シードボーダー線つき) */}
      <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,overflow:"hidden"}}>
        {result.table.map((row,i)=>(
          <div key={i}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
              padding:"9px 14px",borderBottom: i<result.table.length-1?`1px solid ${C.line}`:"none",
              background: row.isMe? race.color+"22":"transparent"}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:15,fontWeight:700,minWidth:24,
                  color: i===0?C.gold:i<3?C.amber:C.sub}}>{row.rank}</span>
                <span style={{fontFamily:serif,fontSize:15,fontWeight:row.isMe?700:400,
                  color:row.isMe?race.color:C.txt}}>{row.name}</span>
                {row.isMe && <span style={{fontSize:10,color:race.color}}>● 自校</span>}
              </div>
              <span style={{fontSize:13,color:i===0?C.gold:C.sub,fontWeight:700}}>{fmtTime(row.time)}</span>
            </div>
            {seedLine && row.rank===seedLine && (
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"2px 14px",background:"#1a1f17"}}>
                <div style={{flex:1,height:1,background:C.green}}/>
                <span style={{fontSize:10,color:C.green,letterSpacing:1}}>━ シード権ボーダー ━</span>
                <div style={{flex:1,height:1,background:C.green}}/>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 区間賞一覧 */}
      {result.stagePrizes && result.stagePrizes.length>0 && (
        <div style={{marginTop:14,background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,padding:"10px 14px"}}>
          <div style={{fontSize:10,color:C.gold,letterSpacing:1,marginBottom:6}}>🏅 区間賞</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px"}}>
            {result.stagePrizes.map((p,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:10,
                padding:"2px 0",color:p.isMe?race.color:C.sub}}>
                <span style={{fontWeight:700,minWidth:26,color:p.isMe?race.color:C.dim}}>{p.leg}区</span>
                <span style={{fontFamily:serif,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                <span style={{fontSize:10,color:p.isMe?race.color:C.dim}}>{p.team?.slice(0,4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onContinue} style={{width:"100%",marginTop:18,padding:"15px",
        borderRadius:10,border:"none",background:`linear-gradient(90deg,${C.green},#2f9c43)`,
        color:"#06210d",fontFamily:mono,fontWeight:700,fontSize:15,letterSpacing:2,cursor:"pointer"}}>
        ▷ 続ける
      </button>
    </div>
  );
}

/* ============================================================
   シーズン終了画面
   ============================================================ */
function SeasonScreen({year,titles,roster,onContinue}) {
  const sanken = titles.izumo>0 && titles.alljapan>0 && titles.hakone>0;
  const graduated = []; // 表示用は省略
  return (
    <div style={{padding:"24px 14px 90px",textAlign:"center"}}>
      <div style={{fontSize:11,color:C.sub,letterSpacing:2}}>{year-1}年目 シーズン総括</div>
      {sanken && (
        <div style={{margin:"20px 0",padding:"20px",borderRadius:14,
          background:`linear-gradient(135deg,${C.gold}33,${C.blue}22)`,
          border:`1px solid ${C.gold}`}}>
          <div style={{fontFamily:serif,fontSize:30,fontWeight:700,color:C.gold}}>三 冠 達 成</div>
          <div style={{fontSize:11,color:C.txt,marginTop:6}}>出雲・全日本・箱根 完全制覇</div>
        </div>
      )}
      <div style={{display:"flex",gap:8,justifyContent:"center",margin:"20px 0"}}>
        {[["出雲路",titles.izumo,C.cyan],["全日本",titles.alljapan,C.gold],["箱根山",titles.hakone,C.blue]].map(([t,v,c])=>(
          <div key={t} style={{flex:1,maxWidth:100,background:C.panel,border:`1px solid ${v>0?c:C.line}`,
            borderRadius:10,padding:"14px 8px"}}>
            <div style={{fontSize:10,color:C.sub}}>{t}</div>
            <div style={{fontSize:28,fontWeight:700,color:v>0?c:C.dim}}>{v}<span style={{fontSize:12}}>勝</span></div>
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:C.sub,lineHeight:1.7,margin:"16px 0"}}>
        4年生が卒業し、新入生が入部しました。<br/>新シーズン（{year}年目）が始まります。
      </div>
      <button onClick={onContinue} style={{width:"100%",padding:"15px",borderRadius:10,border:"none",
        background:`linear-gradient(90deg,${C.gold},${C.amber})`,color:"#111",
        fontFamily:mono,fontWeight:700,fontSize:15,letterSpacing:2,cursor:"pointer"}}>
        ▷ 新シーズンへ
      </button>
    </div>
  );
}

/* ============================================================
   記録室 — 距離別ランキング / 大会アーカイブ
   ============================================================ */
function RecordsRoom({roster,distanceRecords,raceArchive,schoolLegBests,year,onBack}) {
  const [mode,setMode] = useState("track"); // track | ekiden
  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.gold}}>記録室</div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[["track","トラック / 距離別"],["ekiden","駅伝 大会記録"]].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,padding:"9px",borderRadius:8,
            border:`1px solid ${mode===k?C.gold:C.line}`,background:mode===k?C.panel2:C.panel,
            color:mode===k?C.gold:C.sub,fontSize:12,fontFamily:mono,fontWeight:mode===k?700:400,
            cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      {mode==="track"
        ? <TrackRecords roster={roster} distanceRecords={distanceRecords}/>
        : <EkidenRecords raceArchive={raceArchive} schoolLegBests={schoolLegBests}/>}
    </div>
  );
}

/* 距離別: 現役ランキング + 歴代ランキング */
function TrackRecords({roster,distanceRecords}) {
  const [dist,setDist] = useState(5000); // 5000 | 10000 | "half"
  const distLabel = dist===5000?"5000m":dist===10000?"10000m":"ハーフ";
  const pbField = dist===5000?"best5000":dist===10000?"best10000":"best10000"; // halfは10000基準で近似表示

  // 現役: 現在のロスターをPB順
  const active = roster.slice()
    .map(r=>({ name:r.name, grade:r.grade, abilities:[Math.round(r.speed),Math.round(r.stamina),Math.round(r.spirit)],
      time: dist==="half" ? Math.round(r.best10000*2.108) : r[pbField] }))  // ハーフ近似換算
    .sort((a,b)=>a.time-b.time).slice(0,5);
  // 歴代: アーカイブ(現役/OB混在)。ハーフは別管理。
  const histKey = dist==="half"?"half":dist;
  const hist = (distanceRecords[histKey]||[]).slice().sort((a,b)=>a.time-b.time).slice(0,5);

  return (
    <div>
      <div style={{display:"flex",gap:7,marginBottom:14}}>
        {[[5000,"5000m"],[10000,"10000m"],["half","ハーフ"]].map(([k,l])=>(
          <button key={k} onClick={()=>setDist(k)} style={{flex:1,padding:"7px",borderRadius:7,
            border:`1px solid ${dist===k?C.cyan:C.line}`,background:dist===k?C.panel2:C.panel,
            color:dist===k?C.cyan:C.sub,fontSize:12,fontFamily:mono,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      <RankBlock title={`${distLabel} 現役選手ランキング`} rows={active} dist={dist} accent={C.cyan}
        emptyMsg="まだ記録がありません"/>
      <div style={{height:14}}/>
      <RankBlock title={`${distLabel} 歴代ランキング`} rows={hist} dist={dist} accent={C.gold}
        emptyMsg="まだ歴代記録がありません。記録会やレースに出走すると蓄積されます。" showOB/>
    </div>
  );
}

function RankBlock({title,rows,dist,accent,emptyMsg,showOB}) {
  // ハーフは「分:秒」(例 61:19)で表示。トラックは通常のfmtTime。
  const fmt = (t)=> {
    if (dist!=="half") return fmtTime(t);
    const sec = Math.round(t);
    return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`;
  };
  return (
    <div>
      <div style={{textAlign:"center",fontFamily:serif,fontSize:15,fontWeight:700,color:accent,marginBottom:8}}>{title}</div>
      {rows.length===0 ? (
        <div style={{fontSize:10,color:C.dim,textAlign:"center",padding:"16px",
          background:C.panel,border:`1px solid ${C.line}`,borderRadius:9}}>{emptyMsg}</div>
      ) : (
        <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>
          {rows.map((r,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",
              borderBottom: i<rows.length-1?`1px solid ${C.line}`:"none",
              background: i%2? "transparent":"#1a1f27"}}>
              <span style={{fontSize:13,fontWeight:700,minWidth:34,
                color:i===0?C.gold:i<3?C.amber:C.sub}}>{i+1}位</span>
              <span style={{fontFamily:serif,fontSize:14,fontWeight:700,minWidth:96,flex:"0 0 auto"}}>
                {r.name}<span style={{fontSize:10,color:C.dim,fontFamily:mono,marginLeft:4}}>
                  {r.grade===0?"OB":`(${r.grade})`}</span></span>
              <div style={{flex:1,display:"flex",gap:5,justifyContent:"flex-end"}}>
                {(r.abilities||[]).map((v,j)=>{
                  const rk = rankOf(v);
                  return <span key={j} style={{fontSize:11,fontWeight:700,color:rk.c}}>{rk.r}{v}</span>;
                })}
              </div>
              <span style={{fontSize:13,fontWeight:700,color:accent,minWidth:52,textAlign:"right"}}>{fmt(r.time)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 駅伝 大会アーカイブ: 大会選択 → 年度選択 → 学内記録 / 順位表 */
function EkidenRecords({raceArchive,schoolLegBests}) {
  const [raceKey,setRaceKey] = useState(null);
  const [yearIdx,setYearIdx] = useState(null); // 選択中アーカイブのindex
  const [view,setView] = useState("school");   // school(学内記録) | standings(順位表)
  const [legIdx,setLegIdx] = useState(0);       // standings時の表示区間

  const raceMeta = {izumo:{name:"出雲路駅伝",color:C.cyan},alljapan:{name:"全日本大学駅伝",color:C.gold},hakone:{name:"箱根山駅伝",color:C.blue}};

  // 大会未選択: 3大会のカード
  if (!raceKey) {
    return (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {Object.entries(raceMeta).map(([k,m])=>{
          const count = (raceArchive[k]||[]).length;
          return (
            <button key={k} onClick={()=>{ if(count>0){setRaceKey(k); setYearIdx(null);} }}
              disabled={count===0}
              style={{textAlign:"left",background:C.panel,border:`1px solid ${count>0?m.color:C.line}`,
              borderRadius:10,padding:"14px 16px",cursor:count>0?"pointer":"default",opacity:count>0?1:0.5}}>
              <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:count>0?m.color:C.dim}}>{m.name}</div>
              <div style={{fontSize:10,color:C.sub,marginTop:3}}>
                {count>0?`${count}大会分の記録 ›`:"まだ記録がありません"}</div>
            </button>
          );
        })}
      </div>
    );
  }

  const archive = raceArchive[raceKey]||[];
  const meta = raceMeta[raceKey];

  // 年度未選択: 年度リスト
  if (yearIdx===null) {
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <button onClick={()=>setRaceKey(null)} style={backBtn}>←</button>
          <div style={{fontFamily:serif,fontSize:18,fontWeight:700,color:meta.color}}>{meta.name}</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {archive.map((a,i)=>(
            <button key={i} onClick={()=>{setYearIdx(i); setView("school");}}
              style={{background:C.panel,border:`1px solid ${a.myRank===1?C.gold:C.line}`,borderRadius:9,
              padding:"12px",cursor:"pointer",textAlign:"left"}}>
              <div style={{fontFamily:serif,fontSize:15,fontWeight:700}}>{a.year}年目成績</div>
              <div style={{fontSize:11,color:a.myRank===1?C.gold:C.sub,marginTop:3}}>
                {a.myRank}位 / {a.total}校 {a.myRank===1?"🏆":""}</div>
              <div style={{fontSize:10,color:C.dim,marginTop:2}}>{fmtTime(a.myTime)}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const a = archive[yearIdx];
  const legBests = schoolLegBests[raceKey]||{};

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <button onClick={()=>setYearIdx(null)} style={backBtn}>←</button>
        <div style={{flex:1}}>
          <div style={{fontFamily:serif,fontSize:17,fontWeight:700,color:meta.color}}>{meta.name}</div>
          <div style={{fontSize:10,color:C.sub}}>{a.year}年目 ・ {a.myRank}位</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[["school","学内記録"],["standings","大会順位"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,padding:"8px",borderRadius:7,
            border:`1px solid ${view===k?meta.color:C.line}`,background:view===k?C.panel2:C.panel,
            color:view===k?meta.color:C.sub,fontSize:12,fontFamily:mono,fontWeight:view===k?700:400,
            cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {view==="school" ? (
        /* 学内記録: 各区の自校歴代ベスト + この年の総合 */
        <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,overflow:"hidden"}}>
          <div style={{textAlign:"center",fontFamily:serif,fontSize:13,fontWeight:700,
            padding:"8px",color:meta.color,borderBottom:`1px solid ${C.line}`}}>{meta.name} 学内記録（区間歴代ベスト）</div>
          {a.myLegs.map((ml,li)=>{
            const best = legBests[li];
            return (
              <div key={li} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 13px",
                borderBottom:`1px solid ${C.line}`,background: li%2?"transparent":"#1a1f27"}}>
                <span style={{fontSize:13,fontWeight:700,color:meta.color,minWidth:34}}>{ml.leg}区</span>
                <span style={{fontFamily:serif,fontSize:14,flex:1}}>
                  {best?best.name:ml.name}
                  <span style={{fontSize:10,color:C.dim,fontFamily:mono,marginLeft:4}}>
                    ({best?best.grade:ml.grade})</span></span>
                {best && <span style={{fontSize:10,color:C.sub}}>{best.year}年目</span>}
                <span style={{fontSize:13,fontWeight:700,color:meta.color,minWidth:62,textAlign:"right"}}>
                  {fmtTime(best?best.time:ml.time)}</span>
              </div>
            );
          })}
          <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 13px",background:"#11161d"}}>
            <span style={{fontFamily:serif,fontSize:14,fontWeight:700,flex:1,color:C.txt}}>総合記録（{a.year}年目）</span>
            <span style={{fontSize:14,fontWeight:700,color:meta.color}}>{fmtTime(a.myTime)}</span>
          </div>
        </div>
      ) : (
        /* 大会順位: 総合 + 区間順位 */
        <div style={{display:"flex",gap:8}}>
          {/* 総合順位 */}
          <div style={{flex:1,background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>
            <div style={{textAlign:"center",fontSize:11,fontWeight:700,padding:"6px",
              color:C.sub,borderBottom:`1px solid ${C.line}`}}>総合順位</div>
            <div style={{maxHeight:"54vh",overflowY:"auto"}}>
              {a.table.map((row,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 9px",
                  borderBottom:`1px solid ${C.line}`,background: row.isMe? meta.color+"22": i%2?"transparent":"#1a1f27"}}>
                  <span style={{fontSize:10,color:C.sub,minWidth:18}}>{row.rank}</span>
                  <span style={{fontFamily:serif,fontSize:11,flex:1,fontWeight:row.isMe?700:400,
                    color:row.isMe?meta.color:C.txt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.name}</span>
                  <span style={{fontSize:10,color:C.sub}}>{fmtTime(row.time)}</span>
                </div>
              ))}
            </div>
          </div>
          {/* 区間順位 */}
          <div style={{flex:1,background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,overflow:"hidden"}}>
            <div style={{padding:"4px 6px",borderBottom:`1px solid ${C.line}`,display:"flex",gap:3,overflowX:"auto"}}>
              {a.legStandings.map((ls,li)=>(
                <button key={li} onClick={()=>setLegIdx(li)} style={{minWidth:24,padding:"3px",borderRadius:4,
                  border:"none",background:legIdx===li?meta.color:"transparent",
                  color:legIdx===li?"#0b0f14":C.sub,fontSize:10,fontWeight:700,cursor:"pointer"}}>{ls.leg}</button>
              ))}
            </div>
            <div style={{textAlign:"center",fontSize:10,color:C.sub,padding:"3px"}}>{(a.legStandings[legIdx]||{}).leg}区 区間順位</div>
            <div style={{maxHeight:"48vh",overflowY:"auto"}}>
              {((a.legStandings[legIdx]||{}).rows||[]).map((row,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 9px",
                  borderBottom:`1px solid ${C.line}`,background: row.isMe? meta.color+"22": i%2?"transparent":"#1a1f27"}}>
                  <span style={{fontSize:10,color:C.sub,minWidth:18}}>{row.rank}</span>
                  <span style={{fontFamily:serif,fontSize:11,flex:1,fontWeight:row.isMe?700:400,
                    color:row.isMe?meta.color:C.txt,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.name}</span>
                  <span style={{fontSize:10,color:C.sub}}>{fmtTime(row.time)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   編成室 (TrainingRoom) - 練習枠・班・未所属を1画面で扱う
   ============================================================ */
function TrainingRoom({trainings,setTrainings,trainingGroups,setTrainingGroups,roster,onBack}) {
  const [tab,setTab] = useState("slots"); // slots | groups | free
  const [hintDismissed,setHintDismissed] = useState(false);

  // 現在いずれかの班に所属している選手IDセット(重複所属を防ぐ判定に使う)
  const memberOf = (rid) => trainingGroups.findIndex(g=>g.ids.includes(rid));
  // 選手を指定班に移動(既存所属からは自動で外す) / null なら全体に戻す
  const moveToGroup = (runnerId, targetGroupIdx) => {
    setTrainingGroups(prev => {
      const next = prev.map(g => ({...g, ids: g.ids.filter(id=>id!==runnerId)}));
      if (targetGroupIdx!=null && targetGroupIdx>=0 && targetGroupIdx<next.length) {
        next[targetGroupIdx] = {...next[targetGroupIdx], ids: [...next[targetGroupIdx].ids, runnerId]};
      }
      return next;
    });
  };
  // 新しい班をこの選手1名で作成
  const createGroupWith = (runnerId, name) => {
    const cleanName = (name||"").trim() || "新しい班";
    setTrainingGroups(prev => {
      const withoutMe = prev.map(g => ({...g, ids: g.ids.filter(id=>id!==runnerId)}));
      return [...withoutMe, { gid:`g${_gid++}`, name: cleanName, ids: [runnerId] }];
    });
  };

  // 初回ヒント: 班がまだ0、かつ非表示化されていないときのみ
  const showHint = !hintDismissed && trainingGroups.length===0;

  return (
    <div style={{padding:"14px 14px 90px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
        <button onClick={onBack} style={backBtn}>←</button>
        <div>
          <div style={{fontFamily:serif,fontSize:20,fontWeight:700,color:C.gold}}>編成室</div>
          <div style={{fontSize:10,color:C.sub}}>今週の練習と班を編成する</div>
        </div>
      </div>

      {/* 初回ヒント (班未作成時のみ) */}
      {showHint && (
        <div style={{padding:"11px 13px",background:C.panel,border:`1px solid ${C.gold}55`,
          borderRadius:9,marginBottom:12,position:"relative"}}>
          <button onClick={()=>setHintDismissed(true)}
            style={{position:"absolute",top:6,right:8,background:"none",border:"none",
            color:C.dim,fontSize:16,cursor:"pointer",lineHeight:1}}>×</button>
          <div style={{fontSize:11,color:C.gold,fontWeight:700,marginBottom:5}}>💡 編成室の使い方</div>
          <div style={{fontSize:10.5,color:C.sub,lineHeight:1.6}}>
            全員一律の練習だけでなく<b style={{color:C.txt}}>班</b>を作れば、山専任やスピード特化などの集中練習(×1.1)が組めます。<br/>
            <b style={{color:C.txt}}>「未所属」タブ</b>で選手カードの<span style={{color:C.cyan}}>🎯全体▽</span>から班に入れて、<b style={{color:C.txt}}>「練習枠」タブ</b>で班にメニューを割り当てれば完成です。</div>
        </div>
      )}

      {/* タブ切替 */}
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {[["slots","練習枠",trainings.length],
          ["groups","班",trainingGroups.length],
          ["free","未所属",roster.filter(r=>memberOf(r.id)<0).length]].map(([k,l,n])=>(
          <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"8px 4px",borderRadius:8,
            border:`1px solid ${tab===k?C.gold:C.line}`,background:tab===k?C.panel2:C.panel,
            color:tab===k?C.gold:C.sub,fontSize:11,fontFamily:mono,fontWeight:tab===k?700:400,
            cursor:"pointer"}}>
            {l} <span style={{fontSize:10,color:tab===k?C.gold:C.dim,marginLeft:3}}>({n})</span>
          </button>
        ))}
      </div>

      {tab==="slots" && <SlotsView trainings={trainings} setTrainings={setTrainings}
        trainingGroups={trainingGroups} roster={roster}/>}
      {tab==="groups" && <GroupsView trainings={trainings} trainingGroups={trainingGroups}
        setTrainingGroups={setTrainingGroups} setTrainings={setTrainings} roster={roster}/>}
      {tab==="free" && <FreePoolView roster={roster} trainings={trainings} trainingGroups={trainingGroups}
        memberOf={memberOf} moveToGroup={moveToGroup} createGroupWith={createGroupWith}/>}
    </div>
  );
}

/* --- タブ1: 練習枠ビュー (Phase1: 現行TrainingEditorのロジックを移設) --- */
function SlotsView({trainings,setTrainings,trainingGroups,roster}) {
  const [editing,setEditing] = useState(null);
  const maxSlots = 3;
  const setSlot = (i, patch) => {
    setTrainings(prev => { const next = prev.slice(); next[i] = {...next[i], ...patch}; return next; });
  };
  const addSlot = () => {
    if (trainings.length>=maxSlots) return;
    setTrainings([...trainings, {menu:"jog", group:"all"}]);
  };
  const removeSlot = (i) => {
    setTrainings(trainings.filter((_,j)=>j!==i));
    setEditing(null);
  };
  // その枠に実際にヒットする選手を返す (実際の適用ルールと同じ)
  // 班枠: 班メンバー / 全体枠1つ目: 全員(班員は2メニュー目として) / 全体枠2つ目: 未所属のみ
  const runnersForSlot = (slotIdx) => {
    const t = trainings[slotIdx];
    if (!t) return [];
    const rg = resolveGroup(t.group, trainingGroups);
    if (rg.kind === "group") {
      return roster.filter(r => rg.g.ids.includes(r.id));
    }
    if (rg.kind === "none" && t.group !== "all") {
      return []; // 存在しない班参照
    }
    const allSlotIndexes = trainings
      .map((tt, i) => tt.group === "all" ? i : -1)
      .filter(i => i>=0);
    const allRank = allSlotIndexes.indexOf(slotIdx);
    if (allRank < 0 || allRank > 1) return [];
    if (allRank === 0) return roster; // 1つ目の全体枠は全員が対象
    // 2つ目の全体枠は班未所属選手のみ
    const inGroupIds = new Set();
    trainingGroups.forEach(g => g.ids.forEach(id => inGroupIds.add(id)));
    return roster.filter(r => !inGroupIds.has(r.id));
  };
  const groupDesc = (g) => {
    if (g==="all") return {name:"全体", color:C.sub};
    const rg = resolveGroup(g, trainingGroups);
    if (rg.kind === "group") return {name: rg.g.name, color:C.cyan};
    return {name:"—", color:C.dim};
  };
  // 選択中の班chipを判定
  const isSelectedGroup = (t, gr) => {
    if (isGroupRef(t.group)) return t.group.gid === gr.gid;
    if (Array.isArray(t.group)) return JSON.stringify(t.group) === JSON.stringify(gr.ids);
    return false;
  };

  return (
    <div>
      {/* 班状況の概観 (常時表示) */}
      {(trainingGroups.length>0 || roster.length>0) && (()=>{
        const inG = new Set();
        trainingGroups.forEach(g=>g.ids.forEach(id=>inG.add(id)));
        const freeN = roster.filter(r=>!inG.has(r.id) && r.injury===0).length;
        return (
          <div style={{padding:"8px 12px",background:C.panel2,border:`1px solid ${C.line}`,
            borderRadius:8,marginBottom:10,display:"flex",flexWrap:"wrap",gap:8,fontSize:10}}>
            <span style={{color:C.dim,marginRight:2}}>班状況:</span>
            {trainingGroups.map(g=>(
              <span key={g.gid} style={{color:g.ids.length===0?C.dim:C.cyan}}>
                {g.name} <span style={{fontSize:10}}>({g.ids.length})</span>
              </span>
            ))}
            {trainingGroups.length===0 && <span style={{color:C.dim}}>班なし</span>}
            <span style={{color:C.sub,marginLeft:"auto"}}>未所属 <b>{freeN}</b>名</span>
          </div>
        );
      })()}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {trainings.map((t,i)=>{
          const m = MENUS[t.menu];
          const gd = groupDesc(t.group);
          const targets = runnersForSlot(i);
          const isOpen = editing===i;
          // 全体枠が3つ目のときは "無効" を明示
          const isDisabled = t.group==="all" && (()=>{
            const allIdx = trainings.map((tt,j)=>tt.group==="all"?j:-1).filter(x=>x>=0);
            return allIdx.indexOf(i) > 1;
          })();
          return (
            <div key={i} style={{background:C.panel,border:`1px solid ${isOpen?m.color:C.line}`,
              borderRadius:9,overflow:"hidden",opacity:isDisabled?0.5:1}}>
              {/* ヘッダー(常時表示) */}
              <button onClick={()=>setEditing(isOpen?null:i)}
                style={{width:"100%",display:"flex",alignItems:"center",gap:10,
                background:"#11161d",border:"none",padding:"11px 12px",cursor:"pointer",textAlign:"left"}}>
                <span style={{width:7,height:32,borderRadius:2,background:m.color}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.txt}}>{m.label}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:2}}>{m.desc}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,fontWeight:700,color:gd.color}}>{gd.name}</div>
                  <div style={{fontSize:10,color:C.dim,marginTop:2}}>{targets.length}名 {isDisabled && "(無効)"}</div>
                </div>
                <span style={{fontSize:14,color:C.sub,marginLeft:4}}>{isOpen?"▲":"▽"}</span>
              </button>
              {/* 常時表示: 対象選手のリスト */}
              {!isDisabled && targets.length>0 && (
                <SlotTargetList runners={targets} menu={m} maxShown={isOpen?99:5}/>
              )}
              {!isDisabled && targets.length===0 && (
                <div style={{padding:"9px 12px",fontSize:10,color:C.dim,textAlign:"center"}}>
                  対象選手がいません</div>
              )}
              {/* 編集モード: メニュー選択・対象選択・削除 */}
              {isOpen && (
                <div style={{padding:"10px 12px",background:C.panel2,borderTop:`1px solid ${C.line}`}}>
                  <div style={{fontSize:10,color:C.sub,marginBottom:5}}>メニュー</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:10}}>
                    {Object.values(MENUS).map(mm=>(
                      <button key={mm.key} onClick={()=>setSlot(i,{menu:mm.key})}
                        style={{padding:"6px 4px",fontSize:10,borderRadius:5,
                        border:`1px solid ${t.menu===mm.key?mm.color:C.line}`,
                        background:t.menu===mm.key?mm.color+"22":C.panel,
                        color:t.menu===mm.key?mm.color:C.sub,cursor:"pointer"}}>{mm.label}</button>
                    ))}
                  </div>
                  <div style={{fontSize:10,color:C.sub,marginBottom:5}}>対象</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
                    <button onClick={()=>setSlot(i,{group:"all"})}
                      style={chipStyle(t.group==="all", C.sub)}>全体</button>
                    {trainingGroups.map((gr,gi)=>(
                      <button key={gr.gid} onClick={()=>setSlot(i,{group:{gid:gr.gid}})}
                        style={chipStyle(isSelectedGroup(t, gr), C.cyan)}>
                        {gr.name}({gr.ids.length})</button>
                    ))}
                  </div>
                  {trainings.length>1 && (
                    <button onClick={()=>removeSlot(i)} style={{background:"none",border:`1px solid ${C.red}`,
                      color:C.red,fontSize:10,padding:"5px 11px",borderRadius:5,cursor:"pointer"}}>この枠を削除</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {trainings.length<maxSlots && (
          <button onClick={addSlot} style={{padding:"9px",fontSize:11,borderRadius:7,
            border:`1px dashed ${C.line}`,background:"none",color:C.sub,cursor:"pointer"}}>
            ＋ 練習枠を追加 ({trainings.length}/{maxSlots})</button>
        )}
      </div>
      <div style={{fontSize:10.5,color:C.dim,marginTop:10,lineHeight:1.5}}>
        1人あたり最大2メニュー。班所属は班練(集中度×1.1)+全体枠の1つ目、未所属は全体枠を上から2つ実施。</div>
    </div>
  );
}

/* 練習枠内の対象選手リスト (メニュー連動の能力ハイライト + 平均能力) */
function SlotTargetList({runners, menu, maxShown=99}) {
  // メニューがどの能力を伸ばすかを判定 (MENUSのeff関数を空選手で呼んで確認)
  const eff = menu.eff({speed:70,stamina:70,spirit:70,uphill:70});
  const focused = []; // 主要効果 (上位順)
  if (eff.speed) focused.push({key:"speed",label:"SPD",color:C.red});
  if (eff.stamina) focused.push({key:"stamina",label:"STA",color:C.cyan});
  if (eff.uphill) focused.push({key:"uphill",label:"山",color:C.purple});
  if (eff.spirit) focused.push({key:"spirit",label:"勝負",color:C.amber});
  // フォーカス能力の平均(表示用)
  const focusAvg = focused.length>0 ? focused.map(f => {
    const avg = runners.reduce((a,r)=>a+r[f.key],0) / runners.length;
    return {...f, avg: Math.round(avg)};
  }) : [];
  const fatigueAvg = runners.length>0 ? Math.round(runners.reduce((a,r)=>a+r.fatigue,0)/runners.length) : 0;
  const shown = runners.slice(0, maxShown);
  const restCount = runners.length - shown.length;

  return (
    <div style={{padding:"8px 12px",background:C.panel}}>
      {/* 平均能力バー */}
      {focused.length>0 && (
        <div style={{display:"flex",gap:10,marginBottom:8,fontSize:10,color:C.dim,alignItems:"center"}}>
          <span style={{color:C.sub}}>平均:</span>
          {focusAvg.map(f=>(
            <span key={f.key} style={{color:f.color,fontWeight:700}}>{f.label} {f.avg}</span>
          ))}
          <span style={{marginLeft:"auto",color:fatigueAvg>60?C.red:fatigueAvg>40?C.amber:C.dim}}>
            疲{fatigueAvg}</span>
        </div>
      )}
      {/* 選手行 */}
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        {shown.map(r => (
          <SlotRunnerRow key={r.id} r={r} focused={focused}/>
        ))}
        {restCount>0 && (
          <div style={{fontSize:10,color:C.dim,textAlign:"center",padding:"3px"}}>
            ...ほか {restCount} 名 (展開して全表示)</div>
        )}
      </div>
    </div>
  );
}

/* 練習枠の対象選手行 (1行版) */
function SlotRunnerRow({r, focused}) {
  const isInjured = r.injury>0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"4px 6px",
      background:isInjured?"transparent":"#11161d",borderRadius:5,
      opacity:isInjured?0.45:1}}>
      <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
        borderRadius:2,padding:"1px 4px",fontWeight:700,minWidth:10,textAlign:"center"}}>{r.grade}</span>
      <span style={{fontFamily:serif,fontSize:12,fontWeight:isInjured?400:700,
        flex:1,color:isInjured?C.dim:C.txt}}>{r.name}
        {isInjured && <span style={{fontSize:10,color:C.red,marginLeft:5}}>🚑{r.injury}週</span>}</span>
      {/* フォーカス能力を強調表示 */}
      {focused.slice(0,2).map(f=>{
        const v = Math.round(r[f.key]);
        return (
          <span key={f.key} style={{fontSize:11,fontWeight:700,color:f.color,minWidth:44,textAlign:"right"}}>
            {f.label} {v}</span>
        );
      })}
      {/* 疲労インジケータ */}
      <span style={{fontSize:10,color:r.fatigue>70?C.red:r.fatigue>50?C.amber:C.dim,
        minWidth:32,textAlign:"right"}}>疲{Math.round(r.fatigue)}</span>
    </div>
  );
}

/* --- タブ2: 班ビュー (Phase3: 能力バー・メンバー管理・リネーム) --- */
function GroupsView({trainings,trainingGroups,setTrainingGroups,setTrainings,roster}) {
  const [creatingName,setCreatingName] = useState("");
  const [expanded,setExpanded] = useState(null); // group index

  const groupUsedInSlot = (gid) => {
    return trainings.findIndex(t => {
      if (isGroupRef(t.group)) return t.group.gid === gid;
      return false;
    });
  };
  const createGroup = () => {
    const nm = creatingName.trim();
    if (!nm) return;
    setTrainingGroups(prev => [...prev, {gid:`g${_gid++}`, name:nm, ids:[]}]);
    setCreatingName("");
  };
  const deleteGroup = (idx) => {
    if (!confirm(`「${trainingGroups[idx].name}」を削除しますか?`)) return;
    const removedGid = trainingGroups[idx].gid;
    setTrainingGroups(prev => prev.filter((_,i)=>i!==idx));
    setTrainings(prev => prev.map(t =>
      isGroupRef(t.group) && t.group.gid === removedGid
        ? {...t, group:"all"} : t));
  };
  const renameGroup = (idx, newName) => {
    const nm = (newName||"").trim();
    if (!nm) return;
    setTrainingGroups(prev => prev.map((g,i)=>i===idx?{...g, name:nm}:g));
  };
  // 班からメンバーを外す (単一所属ルール維持)
  const removeFromGroup = (groupIdx, runnerId) => {
    setTrainingGroups(prev => prev.map((g,i)=>
      i===groupIdx ? {...g, ids: g.ids.filter(id=>id!==runnerId)} : g));
  };
  // 班にメンバーを追加 (既存所属から自動離脱)
  const addToGroup = (groupIdx, runnerId) => {
    setTrainingGroups(prev => {
      const next = prev.map(g => ({...g, ids: g.ids.filter(id=>id!==runnerId)}));
      next[groupIdx] = {...next[groupIdx], ids: [...next[groupIdx].ids, runnerId]};
      return next;
    });
  };

  return (
    <div>
      {trainingGroups.length===0 && (
        <div style={{padding:"14px",background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,
          fontSize:11,color:C.sub,textAlign:"center",marginBottom:12}}>
          まだ班がありません。下の入力欄から班を作るか、「未所属」タブで選手を選んで班を作れます。</div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {trainingGroups.map((g,gi)=>(
          <GroupCard key={gi} group={g} groupIdx={gi}
            roster={roster} trainingGroups={trainingGroups}
            slotIdx={groupUsedInSlot(g.gid)} trainings={trainings}
            isExpanded={expanded===gi}
            onToggleExpand={()=>setExpanded(expanded===gi?null:gi)}
            onDelete={()=>deleteGroup(gi)}
            onRename={(n)=>renameGroup(gi,n)}
            onRemoveMember={(rid)=>removeFromGroup(gi, rid)}
            onAddMember={(rid)=>addToGroup(gi, rid)}/>
        ))}
      </div>
      {/* 新規作成 */}
      <div style={{marginTop:14,padding:"11px",background:C.panel,border:`1px dashed ${C.line}`,borderRadius:9}}>
        <div style={{fontSize:10,color:C.sub,marginBottom:6}}>新しい班を作る</div>
        <div style={{display:"flex",gap:6}}>
          <input value={creatingName} onChange={e=>setCreatingName(e.target.value)} placeholder="例: 山班"
            style={{flex:1,background:C.panel2,border:`1px solid ${C.line}`,borderRadius:6,
            padding:"7px 10px",color:C.txt,fontFamily:serif,fontSize:13,boxSizing:"border-box"}}/>
          <button onClick={createGroup} disabled={!creatingName.trim()}
            style={{padding:"7px 14px",borderRadius:6,border:"none",
            background:creatingName.trim()?C.cyan:"#2a2f37",
            color:creatingName.trim()?"#0b0f14":"#666",fontFamily:mono,fontWeight:700,fontSize:11,
            cursor:creatingName.trim()?"pointer":"default"}}>作成</button>
        </div>
        <div style={{fontSize:10,color:C.dim,marginTop:6,lineHeight:1.5}}>
          作成後、班カードを開いて選手を追加できます。</div>
      </div>
    </div>
  );
}

/* 個別の班カード (Phase3) */
function GroupCard({group,groupIdx,roster,trainingGroups,slotIdx,trainings,isExpanded,onToggleExpand,onDelete,onRename,onRemoveMember,onAddMember}) {
  const [renameMode,setRenameMode] = useState(false);
  const [rn,setRn] = useState(group.name);
  const inSlot = slotIdx>=0;
  const slotMenu = inSlot? MENUS[trainings[slotIdx].menu] : null;

  // メンバー選手データ (有効な選手のみ)
  const members = group.ids.map(id=>roster.find(r=>r.id===id)).filter(Boolean);
  const n = members.length;

  // 平均能力4指標
  const avg = (key) => n===0? 0 : Math.round(members.reduce((a,r)=>a+r[key],0)/n);
  const bars = [
    {label:"SPD", v:avg("speed"),   c:C.red},
    {label:"STA", v:avg("stamina"), c:C.cyan},
    {label:"勝負", v:avg("spirit"),  c:C.amber},
    {label:"山",  v:avg("uphill"),  c:C.purple},
  ];
  const fatigueAvg = avg("fatigue");

  // 未所属選手 (この班に追加候補)
  const inGroupIds = new Set();
  trainingGroups.forEach(gg => gg.ids.forEach(id => inGroupIds.add(id)));
  const candidates = roster.filter(r=>!inGroupIds.has(r.id));

  return (
    <div style={{background:C.panel,border:`1px solid ${inSlot?C.cyan:C.line}`,borderRadius:9,overflow:"hidden"}}>
      {/* ヘッダー */}
      <div style={{padding:"11px 13px"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
          {renameMode ? (
            <>
              <input autoFocus value={rn} onChange={e=>setRn(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){onRename(rn);setRenameMode(false);}}}
                style={{flex:1,background:C.panel2,border:`1px solid ${C.cyan}`,borderRadius:5,
                padding:"4px 8px",color:C.txt,fontFamily:serif,fontSize:14,boxSizing:"border-box"}}/>
              <button onClick={()=>{onRename(rn);setRenameMode(false);}}
                style={{fontSize:10,padding:"3px 8px",borderRadius:4,border:"none",background:C.cyan,color:"#0b0f14",cursor:"pointer",fontWeight:700}}>確定</button>
              <button onClick={()=>{setRn(group.name);setRenameMode(false);}}
                style={{fontSize:10,padding:"3px 8px",borderRadius:4,border:`1px solid ${C.line}`,background:"none",color:C.sub,cursor:"pointer"}}>×</button>
            </>
          ) : (
            <>
              <span style={{fontFamily:serif,fontSize:15,fontWeight:700,color:C.cyan,flex:1}}
                onClick={()=>setRenameMode(true)}>{group.name}
                <span style={{fontSize:10,color:C.dim,marginLeft:6,fontFamily:mono}}>✎</span></span>
              <span style={{fontSize:10,color:C.dim}}>{n}名</span>
              <button onClick={onDelete} style={{background:"none",border:`1px solid ${C.red}66`,
                color:C.red,fontSize:10,padding:"3px 7px",borderRadius:4,cursor:"pointer"}}>削除</button>
            </>
          )}
        </div>
        {/* 今週の練習 */}
        <div style={{fontSize:10,marginBottom:8}}>
          {inSlot ? (
            <span><span style={{color:C.sub}}>今週:</span>
              <span style={{color:slotMenu.color,fontWeight:700,marginLeft:6}}>● {slotMenu.label}</span>
              <span style={{color:C.dim,marginLeft:5}}>(集中度×1.1)</span></span>
          ) : (
            <span style={{color:C.amber}}>⚠ 今週の練習枠に未割当</span>
          )}
        </div>
        {/* 平均能力ミニバー */}
        {n>0 && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
            {bars.map(b=>(
              <div key={b.label}>
                <div style={{fontSize:10,color:C.dim,display:"flex",justifyContent:"space-between",marginBottom:2}}>
                  <span>{b.label}</span><span style={{color:b.c,fontWeight:700}}>{b.v}</span></div>
                <div style={{height:4,background:"#11161d",borderRadius:2}}>
                  <div style={{height:"100%",width:`${b.v}%`,background:b.c,borderRadius:2}}/>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 平均疲労バー */}
        {n>0 && (
          <div style={{marginBottom:2}}>
            <div style={{fontSize:10,color:C.dim,display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span>平均疲労</span>
              <span style={{color:fatigueAvg>60?C.red:fatigueAvg>40?C.amber:C.dim,fontWeight:700}}>{fatigueAvg}</span></div>
            <div style={{height:4,background:"#11161d",borderRadius:2}}>
              <div style={{height:"100%",width:`${fatigueAvg}%`,
                background:fatigueAvg>60?C.red:fatigueAvg>40?C.amber:C.green,borderRadius:2}}/>
            </div>
          </div>
        )}
        {/* 展開ボタン */}
        <button onClick={onToggleExpand} style={{width:"100%",marginTop:8,padding:"6px",
          background:"none",border:`1px solid ${C.line}`,borderRadius:6,
          color:C.sub,fontSize:10,cursor:"pointer"}}>
          {isExpanded? "▲ 閉じる" : `▽ メンバーを管理 (${n}名)`}</button>
      </div>
      {/* 展開: メンバー一覧と追加候補 */}
      {isExpanded && (
        <div style={{padding:"10px 13px",background:C.panel2,borderTop:`1px solid ${C.line}`}}>
          {/* メンバー一覧 */}
          <div style={{fontSize:10,color:C.sub,marginBottom:6}}>メンバー ({n}名)</div>
          {n===0 ? (
            <div style={{fontSize:10,color:C.dim,textAlign:"center",padding:"10px",background:C.panel,borderRadius:6}}>
              まだメンバーがいません。下から選手を追加してください。</div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12}}>
              {members.sort((a,b)=>a.best5000-b.best5000).map(r=>(
                <MemberRow key={r.id} r={r} onRemove={()=>onRemoveMember(r.id)}/>
              ))}
            </div>
          )}
          {/* 追加候補 (未所属選手) */}
          {candidates.length>0 && (
            <>
              <div style={{fontSize:10,color:C.sub,marginBottom:6}}>追加可能 ({candidates.length}名・未所属)</div>
              <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:280,overflowY:"auto"}}>
                {candidates.sort((a,b)=>a.best5000-b.best5000).map(r=>(
                  <CandidateRow key={r.id} r={r} onAdd={()=>onAddMember(r.id)}/>
                ))}
              </div>
            </>
          )}
          {candidates.length===0 && n>0 && (
            <div style={{fontSize:10,color:C.dim,textAlign:"center",padding:"8px",background:C.panel,borderRadius:6}}>
              全ての選手がいずれかの班に所属しています</div>
          )}
        </div>
      )}
    </div>
  );
}

/* 班メンバー行 (削除ボタン付き) */
function MemberRow({r,onRemove}) {
  const isInj = r.injury>0;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",
      background:C.panel,borderRadius:5,opacity:isInj?0.5:1}}>
      <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
        borderRadius:2,padding:"1px 4px",fontWeight:700,minWidth:10,textAlign:"center"}}>{r.grade}</span>
      <span style={{fontFamily:serif,fontSize:12,fontWeight:700,flex:1}}>{r.name}
        {isInj && <span style={{fontSize:10,color:C.red,marginLeft:5}}>🚑{r.injury}週</span>}</span>
      <span style={{fontSize:10,color:C.red}}>SPD{Math.round(r.speed)}</span>
      <span style={{fontSize:10,color:C.cyan}}>STA{Math.round(r.stamina)}</span>
      <span style={{fontSize:10,color:C.purple}}>山{Math.round(r.uphill)}</span>
      <button onClick={onRemove} style={{background:"none",border:`1px solid ${C.red}66`,
        color:C.red,fontSize:10,padding:"2px 6px",borderRadius:4,cursor:"pointer",marginLeft:4}}>外す</button>
    </div>
  );
}
/* 未所属選手行 (追加ボタン付き) */
function CandidateRow({r,onAdd}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,padding:"5px 8px",
      background:C.panel,borderRadius:5}}>
      <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
        borderRadius:2,padding:"1px 4px",fontWeight:700,minWidth:10,textAlign:"center"}}>{r.grade}</span>
      <span style={{fontFamily:serif,fontSize:12,flex:1,color:C.txt}}>{r.name}</span>
      <span style={{fontSize:10,color:C.red}}>SPD{Math.round(r.speed)}</span>
      <span style={{fontSize:10,color:C.cyan}}>STA{Math.round(r.stamina)}</span>
      <span style={{fontSize:10,color:C.purple}}>山{Math.round(r.uphill)}</span>
      <button onClick={onAdd} style={{background:C.cyan,border:"none",
        color:"#0b0f14",fontSize:10,padding:"2px 8px",borderRadius:4,cursor:"pointer",fontWeight:700,marginLeft:4}}>＋加入</button>
    </div>
  );
}

/* --- タブ3: 未所属選手プール (Phase1: 最小実装、選択チップつき) --- */
function FreePoolView({roster,trainings,trainingGroups,memberOf,moveToGroup,createGroupWith}) {
  const [sortKey,setSortKey] = useState("pb"); // pb | spd | sta | up | fat
  const [expanded,setExpanded] = useState(null); // runnerId of expanded chip picker
  const free = roster.filter(r=>memberOf(r.id)<0);
  const sorters = {
    pb:  (a,b)=>a.best5000-b.best5000,
    spd: (a,b)=>b.speed-a.speed,
    sta: (a,b)=>b.stamina-a.stamina,
    up:  (a,b)=>b.uphill-a.uphill,
    fat: (a,b)=>b.fatigue-a.fatigue,
  };
  const sorted = free.slice().sort(sorters[sortKey]);

  return (
    <div>
      <div style={{padding:"10px 12px",background:C.panel2,borderRadius:8,marginBottom:10,
        border:`1px solid ${C.line}`,fontSize:10.5,color:C.sub,lineHeight:1.5}}>
        班に所属していない選手は全体練習(上から2枠)を実施します。班に入れると集中度×1.1で伸びますが疲労も増加。</div>
      <div style={{display:"flex",gap:5,marginBottom:10,fontSize:10}}>
        <span style={{color:C.dim,alignSelf:"center",marginRight:4}}>並び:</span>
        {[["pb","PB"],["spd","SPD"],["sta","STA"],["up","山"],["fat","疲労"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSortKey(k)} style={{padding:"3px 8px",fontSize:10,borderRadius:5,
            border:`1px solid ${sortKey===k?C.cyan:C.line}`,background:sortKey===k?C.panel2:C.panel,
            color:sortKey===k?C.cyan:C.sub,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      {sorted.length===0 && (
        <div style={{padding:"22px 16px",background:C.panel,border:`1px solid ${C.line}`,borderRadius:9,
          textAlign:"center"}}>
          <div style={{fontSize:22,color:C.green,marginBottom:6}}>✓</div>
          <div style={{fontSize:12,color:C.txt,fontWeight:700,marginBottom:4}}>全員がいずれかの班に所属しています</div>
          <div style={{fontSize:10,color:C.dim,lineHeight:1.5}}>
            班タブから所属変更・削除、練習枠タブで各班にメニューを割り当てられます。</div>
        </div>
      )}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {sorted.map(r=>(
          <RunnerRowCompact key={r.id} r={r} expanded={expanded===r.id}
            onToggleExpand={()=>setExpanded(expanded===r.id?null:r.id)}
            trainings={trainings} trainingGroups={trainingGroups} currentGroupIdx={-1}
            moveToGroup={(idx)=>{moveToGroup(r.id, idx); setExpanded(null);}}
            createGroupWith={(name)=>{createGroupWith(r.id, name); setExpanded(null);}}/>
        ))}
      </div>
    </div>
  );
}

/* 選手行 (コンパクト表示 + 練習バッジ + 班選択チップ) */
function RunnerRowCompact({r,expanded,onToggleExpand,trainings,trainingGroups,currentGroupIdx,moveToGroup,createGroupWith}) {
  const [newName,setNewName] = useState("");
  const currentLabel = currentGroupIdx<0 ? "全体" : trainingGroups[currentGroupIdx]?.name || "?";
  const menus = trainings ? runnerAssignments(r.id, trainings, trainingGroups) : [];
  return (
    <div style={{background:C.panel,border:`1px solid ${expanded?C.cyan:C.line}`,borderRadius:8,padding:"9px 12px"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        <span style={{fontSize:10,color:C.bg,background:gradeColor(r.grade),
          borderRadius:3,padding:"1px 5px",fontWeight:700,minWidth:14,textAlign:"center"}}>{r.grade}</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:serif,fontSize:14,fontWeight:700}}>{r.name}
            {r.injury>0 && <span style={{fontSize:10,color:C.red,marginLeft:5}}>🚑{r.injury}週</span>}</div>
          <div style={{fontSize:10,color:C.dim,marginTop:1,display:"flex",gap:8,flexWrap:"wrap"}}>
            <span>PB {fmtTime(r.best5000)}</span>
            <span style={{color:C.red}}>SPD{Math.round(r.speed)}</span>
            <span style={{color:C.cyan}}>STA{Math.round(r.stamina)}</span>
            <span style={{color:C.purple}}>山{Math.round(r.uphill)}</span>
            <span style={{color:r.fatigue>60?C.red:C.dim}}>疲{Math.round(r.fatigue)}</span>
          </div>
        </div>
        <button onClick={onToggleExpand} style={{background:C.panel2,border:`1px solid ${C.cyan}66`,
          borderRadius:5,padding:"5px 9px",fontSize:10,color:C.cyan,cursor:"pointer",whiteSpace:"nowrap"}}>
          🎯 {currentLabel} ▽</button>
      </div>
      {/* 今週の練習バッジ */}
      {menus.length>0 && r.injury===0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
          {menus.map((a,i)=>(
            <span key={i} style={{fontSize:10.5,padding:"2px 5px",borderRadius:3,
              border:`1px solid ${a.menu.color}66`,color:a.menu.color,background:a.menu.color+"11"}}>
              ● {a.menu.label}
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.line}`}}>
          <div style={{fontSize:10,color:C.sub,marginBottom:5}}>この選手を入れる班を選択</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:6}}>
            <button onClick={()=>moveToGroup(null)}
              style={chipStyle(currentGroupIdx<0, C.sub)}>全体</button>
            {trainingGroups.map((g,gi)=>(
              <button key={g.gid || gi} onClick={()=>moveToGroup(gi)}
                style={chipStyle(currentGroupIdx===gi, C.cyan)}>
                {g.name}({g.ids.length})</button>
            ))}
          </div>
          <div style={{display:"flex",gap:5}}>
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="+新規班名"
              style={{flex:1,background:C.panel2,border:`1px solid ${C.line}`,borderRadius:5,
              padding:"5px 8px",color:C.txt,fontFamily:serif,fontSize:11,boxSizing:"border-box"}}/>
            <button onClick={()=>{if(newName.trim()){createGroupWith(newName); setNewName("");}}}
              disabled={!newName.trim()}
              style={{padding:"5px 10px",borderRadius:5,border:"none",
              background:newName.trim()?C.amber:"#2a2f37",
              color:newName.trim()?"#111":"#666",fontSize:10,fontWeight:700,
              cursor:newName.trim()?"pointer":"default"}}>作成</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   年間カレンダー (本部上部の常時表示タイムライン)
   ============================================================ */
function YearCalendar({week}) {
  // 主要マイルストーンの週定義 (label短縮版)
  const milestones = [
    {w:1,  label:"新年度",   color:C.green},
    {w:6,  label:"関東IC",   color:C.cyan},
    {w:13, label:"スカウト", color:C.purple},
    {w:17, label:"夏合宿",   color:C.amber},
    {w:22, label:"日本IC",   color:C.amber},
    {w:26, label:"出雲",     color:C.cyan},
    {w:27, label:"予選会",   color:C.red},
    {w:29, label:"全日本",   color:C.gold},
    {w:30, label:"上尾",     color:C.green},
    {w:32, label:"八王子",   color:C.purple},
    {w:37, label:"箱根",     color:C.blue},
    {w:38, label:"引退",     color:C.gold},
  ];
  // 現在週の1年間における位置(%)
  const progress = ((week-1) / 47) * 100;
  return (
    <div style={{background:C.panel,border:`1px solid ${C.line}`,borderRadius:10,
      padding:"12px 14px",marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
        <div style={{fontSize:11,color:C.txt,fontWeight:700,letterSpacing:1}}>📅 年間カレンダー</div>
        <div style={{fontSize:10,color:C.gold,fontWeight:700}}>{weekLabel(week)}</div>
      </div>
      {/* プログレスバー本体 */}
      <div style={{position:"relative",height:34,marginBottom:4}}>
        {/* 背景トラック */}
        <div style={{position:"absolute",top:16,left:0,right:0,height:3,
          background:"#11161d",borderRadius:2}}/>
        {/* 経過部分 */}
        <div style={{position:"absolute",top:16,left:0,width:`${progress}%`,height:3,
          background:`linear-gradient(90deg,${C.green},${C.gold})`,borderRadius:2}}/>
        {/* 現在位置マーカー */}
        <div style={{position:"absolute",top:11,left:`${progress}%`,width:12,height:12,
          borderRadius:"50%",background:C.gold,transform:"translateX(-50%)",
          boxShadow:`0 0 8px ${C.gold},0 0 0 2px ${C.bg}`,zIndex:2}}/>
        {/* マイルストーン点 */}
        {milestones.map(ms=>{
          const p = ((ms.w-1)/47) * 100;
          const past = ms.w < week;
          const current = Math.abs(ms.w - week) <= 0;
          return (
            <div key={ms.w} style={{position:"absolute",top:14,left:`${p}%`,
              transform:"translateX(-50%)",width:7,height:7,borderRadius:"50%",
              background:current?ms.color:past?ms.color+"aa":ms.color+"55",
              border:`1px solid ${current?"#fff":ms.color}`,zIndex:1}}/>
          );
        })}
      </div>
      {/* 月ラベル */}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim,
        marginTop:2,paddingLeft:2,paddingRight:2}}>
        {["4","5","6","7","8","9","10","11","12","1","2","3"].map((m,i)=>{
          const monthIdx = i;
          const isCurrentMonth = Math.floor((week-1)/4) === monthIdx;
          return (
            <span key={i} style={{color:isCurrentMonth?C.gold:C.dim,
              fontWeight:isCurrentMonth?700:400}}>{m}月</span>
          );
        })}
      </div>
      {/* 次のマイルストーン */}
      {(()=>{
        const next = milestones.find(ms=>ms.w>=week);
        if (!next) return null;
        const weeksToNext = next.w - week;
        return (
          <div style={{marginTop:10,padding:"7px 10px",background:C.panel2,borderRadius:6,
            display:"flex",alignItems:"center",gap:8,fontSize:10.5}}>
            <span style={{color:C.sub}}>次のイベント:</span>
            <span style={{color:next.color,fontWeight:700}}>● {next.label}</span>
            <span style={{color:C.sub,marginLeft:"auto"}}>
              {weeksToNext===0 ? "今週" : `あと${weeksToNext}週`}</span>
          </div>
        );
      })()}
    </div>
  );
}

/* ============================================================
   下部ナビ
   ============================================================ */
function BottomNav({screen,setScreen,pendingRace}) {
  const items=[["hub","🏠","本部"],["squad","👥","選手"],["training","🧭","編成室"],["records","🏆","記録室"]];
  if(pendingRace) items.push(["lineup","🏁","レース編成"]);
  return (
    <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.panel,
      borderTop:`1px solid ${C.line}`,display:"flex",zIndex:25}}>
      {items.map(([k,ic,l])=>(
        <button key={k} onClick={()=>setScreen(k)} style={{flex:1,padding:"9px 0 11px",
          background:"none",border:"none",cursor:"pointer",
          borderTop:`2px solid ${screen===k?C.gold:"transparent"}`}}>
          <div style={{fontSize:17}}>{ic}</div>
          <div style={{fontSize:10,color:screen===k?C.gold:C.sub,marginTop:2}}>{l}</div>
        </button>
      ))}
    </div>
  );
}
