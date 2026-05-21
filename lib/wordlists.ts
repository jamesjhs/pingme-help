// @ts-nocheck
const VERBS = [
  'adapt','admire','advance','affirm','aid','aim','align','amaze','amplify','animate',
  'answer','apply','arrange','ascend','assist','attune','balance','beam','believe','blaze',
  'bless','bloom','boost','brighten','build','calm','care','celebrate','center','champion',
  'cheer','clarify','climb','coach','comfort','connect','create','cultivate','dare','deliver',
  'design','develop','direct','discover','dream','drive','elevate','embrace','empower','encourage',
  'enjoy','enrich','explore','express','flourish','focus','forgive','foster','gain','gather',
  'generate','gift','gladden','glow','guide','harmonize','heal','help','ignite','imagine',
  'improve','inspire','join','jump','kindle','launch','lead','learn','lift','light',
  'listen','magnify','master','mentor','model','motivate','nourish','notice','nurture','open',
  'organize','originate','overcome','partner','perform','persist','plan','play','polish','prepare',
  'progress','protect','prosper','radiate','reach','rebuild','refresh','rejoice','renew','rescue',
  'resolve','restore','rise','safeguard','savor','shape','share','shine','simplify','smile',
  'spark','stabilize','start','strengthen','support','surge','teach','thrive','transform','trust',
  'uplift','value','venture','vitalize','welcome','win','wonder','work','write','zoom',
  'assistive','breathe','capture','dedicate','energize','fasten','ground','honor','involve','jubilate',
  'keep','laugh','mediate','navigate','observe','pioneer','qualify','reframe','succeed','tend',
  'unite','validate','wander','yearn','zeal','activate','befriend','compose','devote','evolve',
  'feature','greet','highlight','include','journey','knit','link','merge','negotiate','optimize'
];

const USERNAME_NOUNS = [
  'anchor','apricot','arc','aurora','avenue','beacon','birdsong','blossom','breeze','brook',
  'canvas','cedar','chime','circle','cloud','clover','compass','coral','cove','crystal',
  'dawn','delta','drift','echo','ember','field','finch','flame','flora','forest',
  'garden','gem','glade','glimmer','grove','harbor','harmony','haven','hazel','horizon',
  'island','ivy','jewel','journey','joy','kernel','kindle','lagoon','lantern','laurel',
  'leaf','legend','lighthouse','lily','lotus','lumen','maple','marble','meadow','melody',
  'meridian','mint','morning','mosaic','mountain','nest','nova','oak','oasis','orbit',
  'orchard','origin','palm','path','pearl','petal','phoenix','pine','planet','plume',
  'pond','prairie','quartz','quest','rainbow','reef','ridge','river','rose','sail',
  'sanctuary','sapphire','seed','shore','sky','song','spark','spring','star','stone',
  'stream','summit','sunrise','sunset','tide','trail','tree','unity','valley','velvet',
  'vista','wave','willow','wind','wonder','woodland','zenith','bloom','bridge','brooklet',
  'buttercup','cascade','chestnut','daybreak','dew','fir','glow','hillside','isle','jetty',
  'key','lake','marina','moonbeam','northstar','olive','pebble','quill','rain','seabreeze',
  'thistle','updraft','verdant','waterfall','xenia','yard','zephyr','acorn','bay','canyon',
  'dock','elm','fjord','glen','hearth','inlet','knoll','mesa','orchid','ripple'
];

const ADJECTIVES = [
  'able','adored','agile','airy','amazing','amber','amiable','ample','angelic','apt',
  'artful','awesome','balanced','beaming','beloved','best','blissful','bold','bright','brisk',
  'bubbly','calm','careful','caring','celebrated','certain','cheerful','classic','clean','clever',
  'close','colorful','comfy','confident','cool','cosmic','cozy','creative','crisp','curious',
  'daring','dazzling','dear','decent','delightful','devoted','direct','dreamy','driven','eager',
  'earnest','easy','elegant','elite','eminent','empathic','enduring','energetic','engaged','enhanced',
  'epic','equal','esteemed','ethical','euphoric','exact','excited','expert','fair','famous',
  'fancy','fast','fearless','festive','fine','fit','fluent','focused','fond','friendly',
  'fun','gallant','generous','gentle','genuine','gifted','glad','glorious','golden','graceful',
  'grand','grateful','great','grounded','growing','handsome','happy','harmonic','healthy','helpful',
  'heroic','honest','hopeful','humble','ideal','illustrious','improved','inclusive','inspired','jolly',
  'joyful','jubilant','keen','kind','lively','logical','lovely','lucky','luminous','magical',
  'mellow','merry','mindful','modest','modern','neat','noble','optimistic','ordered','peaceful',
  'perfect','playful','pleasant','polished','positive','precious','prime','proud','quick','radiant',
  'ready','refined','reliable','resilient','rich','robust','rosy','safe','savvy','serene',
  'shiny','sincere','skilled','smart','smooth','social','solid','sparkling','spirited','stellar',
  'steady','strong','stylish','sunny','super','swift','talented','thankful','thriving','tidy',
  'upbeat','upright','useful','vibrant','victorious','vivid','warm','wealthy','welcome','wholesome'
];

const EXTRA_VERBS = [
  'achieve','assist','awaken','befit','blossom','caretake','cooperate','determine','elevate',
  'encircle','encounter','enlighten','entertain','excel','grow','hustle','improvise','invent',
  'juggle','laugh','mastermind','observe','organise','persevere','practice','rebound','refresh',
  'reimagine','relax','sustain','uplift','venture','volunteer','whisper','workout'
];

const EXTRA_NOUNS = [
  'adventure','ally','anthem','arch','aster','atlas','balance','banner','beam','bell',
  'berry','blessing','bud','butterfly','campfire','canopy','caravan','charm','citadel','coast',
  'cornerstone','crown','current','cycle','diamond','dream','earth','energy','estate','festival',
  'friend','gate','glory','grass','harvest','home','insight','kite','light','line',
  'miracle','moment','park','passion','pillar','place','praise','promise','pulse','shelter',
  'signal','smile','snow','spirit','station','story','studio','thrive','torch','treasure'
];

const EXTRA_ADJECTIVES = [
  'adaptable','affectionate','agreeable','alive','allied','astonishing','attentive','authentic',
  'beneficial','blessed','captivating','clear','compassionate','credible','deft','dynamic',
  'effortless','empowered','encouraging','favorable','flourishing','glowing','heartening',
  'honorable','imaginative','intrepid','jazzy','legendary','lighthearted','masterful',
  'natural','nurturing','peaceable','pleasantly','poised','powerful','proactive','refreshing',
  'spiritedly','steadfast','supportive','timeless','trustworthy','unified','valiant'
];

function firstNUnique(values, target) {
  return Array.from(new Set(values.map((value) => value.toLowerCase()))).slice(0, target);
}

const VERB_LIST = firstNUnique([...VERBS, ...EXTRA_VERBS], 200);
const NOUN_LIST = firstNUnique([...USERNAME_NOUNS, ...EXTRA_NOUNS], 200);
const ADJECTIVE_LIST = firstNUnique([...ADJECTIVES, ...EXTRA_ADJECTIVES], 200);
const CODEWORD_NOUNS = NOUN_LIST;
const SEVEN_LETTER_CODEWORD_NOUNS = CODEWORD_NOUNS.filter((noun) => /^[a-z]{7}$/.test(noun));

function pickRandom(values) {
  return values[crypto.randomInt(values.length)];
}

function generateVerbNounUsername() {
  return `${pickRandom(VERB_LIST)}-${pickRandom(NOUN_LIST)}`;
}

function generateAdjectiveNounCodeword() {
  const noun = SEVEN_LETTER_CODEWORD_NOUNS.length > 0
    ? pickRandom(SEVEN_LETTER_CODEWORD_NOUNS)
    : pickRandom(CODEWORD_NOUNS).replace(/[^a-z]/g, '').slice(0, 7).padEnd(7, 'x');
  const suffix = String(crypto.randomInt(1000)).padStart(3, '0');
  return `${noun}${suffix}`;
}

module.exports = {
  VERBS: VERB_LIST,
  USERNAME_NOUNS: NOUN_LIST,
  ADJECTIVES: ADJECTIVE_LIST,
  CODEWORD_NOUNS,
  generateVerbNounUsername,
  generateAdjectiveNounCodeword
};
const crypto = require('node:crypto');
