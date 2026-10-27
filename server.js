#!/usr/bin/env node
// IdeaForge — ИИ-агент (Claude Code / Codex / OpenCode) придумывает идеи приложений на тему,
// оценивает их, лучшую сам делает в отдельной папке, остальные складывает в «Банк идей».
// Без зависимостей: нужен только Node.js 18+ и установленный CLI-агент.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// Внутри IdeaForge.exe (Node SEA) страница вшита как ресурс, а данные лежат рядом с exe.
let sea = null;
try { sea = require('node:sea'); if (!sea.isSea()) sea = null; } catch (_) { sea = null; }
const ROOT = sea ? path.dirname(process.execPath) : __dirname;
const pageHtml = () => sea ? sea.getAsset('index.html', 'utf8') : fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
const DATA_FILE = path.join(ROOT, 'data.json');
const WORK_DIR = path.join(ROOT, '.work');          // пустая папка для «думающих» запусков агента
const PORT = Number(process.env.PORT) || 4777;
const isWin = process.platform === 'win32';

const DEFAULT_AGENTS = [
  { id: 'claude', name: 'Claude Code', cmd: 'claude', gen: '-p',
    build: '-p --dangerously-skip-permissions --output-format stream-json --verbose',
    install: 'https://claude.com/claude-code' },
  { id: 'codex', name: 'Codex', cmd: 'codex', gen: 'exec --skip-git-repo-check -',
    build: 'exec --skip-git-repo-check --full-auto -', install: 'npm i -g @openai/codex' },
  { id: 'opencode', name: 'OpenCode', cmd: 'opencode', gen: 'run {prompt}', build: 'run {prompt}',
    install: 'npm i -g opencode-ai' },
];

// Что делаем: у каждого типа свои идеи, критерии и задание на сборку.
const KINDS = {
  app: { label: 'Приложение', many: 'приложений', one: 'приложение',
    ideaRules: 'каждое можно сделать за один сеанс работы ИИ-агента как рабочее приложение (в браузере или на компьютере), без своих серверов, платных API и регистрации',
    build: `- выбери простой стек, который запускается без лишних установок: лучше всего один index.html с JS/CSS; если нужно больше — Python 3 или Node.js;
- интерфейс и тексты на русском, аккуратный современный вид;
- доведи до рабочего состояния и сам проверь, что всё запускается без ошибок;
- добавь README.md на русском: что это, как запустить, что умеет;
- если запуск не через index.html — сделай run.bat (Windows) для запуска двойным кликом;` },
  game: { label: 'Игра', many: 'игр', one: 'игру',
    ideaRules: 'каждую можно сделать за один сеанс ИИ-агента как браузерную игру в одном index.html (Canvas/JS), без сервера и внешних ассетов; игра должна затягивать уже с первой минуты',
    build: `- игра — один index.html (Canvas + JS + CSS), графика рисуется кодом или эмодзи, звуки — через WebAudio; без внешних файлов и библиотек;
- управление с клавиатуры и мышью/тачем, экран старта, счёт, рекорд в localStorage, экран проигрыша и «Ещё раз»;
- тексты на русском, сочный современный вид, плавная анимация;
- сам проверь, что в коде нет ошибок и игра проходима;
- добавь README.md на русском: правила и управление;` },
  site: { label: 'Сайт', many: 'сайтов', one: 'сайт',
    ideaRules: 'каждый можно сделать за один сеанс ИИ-агента как статичный сайт (HTML/CSS/JS) без бэкенда; полезный или эффектный, с интерактивом',
    build: `- статичный сайт: index.html + при необходимости style.css и script.js, без сборщиков и бэкенда;
- современный адаптивный дизайн (телефон и компьютер), тексты на русском, интерактивные элементы;
- сам проверь, что страницы открываются без ошибок в консоли;
- добавь README.md на русском: что это и как выложить (например, GitHub Pages);` },
  mod: { label: 'Мод', many: 'модов', one: 'мод',
    ideaRules: 'каждый — мод или плагин для конкретной популярной игры (если игра не указана в теме — выбирай из Minecraft, Terraria, Garry\'s Mod, Skyrim, Stardew Valley и т.п.); название игры обязательно укажи в названии идеи; мод должен быть реально собираемым за один сеанс ИИ-агента с официальными или популярными инструментами моддинга',
    build: `- используй стандартный инструментарий моддинга этой игры (например, Fabric или Forge для Minecraft, tModLoader для Terraria, Lua-аддон для Garry's Mod, SMAPI для Stardew Valley, BepInEx для Unity-игр);
- если инструменты можно скачать и собрать мод здесь — собери и положи готовый файл мода в папку dist/;
- если собрать без самой игры нельзя — подготовь проект полностью, чтобы сборка шла одной командой, и опиши шаги;
- добавь README.md на русском: для какой игры и версии, как собрать, как установить, что мод делает;` },
  bot: { label: 'Бот', many: 'ботов', one: 'бота',
    ideaRules: 'каждый — Telegram-бот, которого можно сделать за один сеанс ИИ-агента на Python или Node.js, без платных API; полезный или весёлый',
    build: `- Telegram-бот на Python (aiogram/python-telegram-bot) или Node.js (grammY/telegraf), токен берётся из файла .env (сделай .env.example);
- тексты бота на русском, понятное меню команд и кнопки;
- проверь, что код запускается без синтаксических ошибок (без реального токена — хотя бы импорт и сборка);
- сделай run.bat для запуска и README.md на русском: как получить токен у @BotFather, как запустить, команды бота;` },
  video: { label: 'Ролик', many: 'роликов', one: 'ролик',
    ideaRules: 'каждая — короткий вертикальный ролик для TikTok/Reels/Shorts (15–40 секунд), который ИИ-агент может полностью собрать кодом: анимированная графика, текст, инфографика, кинетическая типографика, эффектные визуализации — без съёмки людей и без чужих видео; ролик должен цеплять с первой секунды',
    build: `- сделай готовый вертикальный ролик 1080×1920, 15–40 секунд, 30 к/с, файл video.mp4 в корне папки;
- делай ролик на Remotion (React): поставь пакеты через npm (remotion, @remotion/cli и нужные), композиция 1080×1920 30 к/с, рендер командой npx remotion render … --output video.mp4; FFmpeg и браузер для рендера Remotion скачает сам;
- используй возможности Remotion: spring/interpolate для плавной анимации, Sequence для сцен, переходы между сценами (@remotion/transitions), шрифты с кириллицей (@remotion/google-fonts);
- первая секунда — сильный крючок, крупный читаемый текст на русском, динамичный монтаж, текст не прижат к краям (снизу и справа оставь место под интерфейс TikTok);
- если получится — добавь музыку или звуки, сгенерированные кодом (без чужих треков);
- сам проверь, что video.mp4 существует, открывается и длительность правильная;
- рядом положи scenario.md: сценарий по секундам, текст для подписи к видео и хэштеги;
- исходники генерации оставь в папке, чтобы ролик можно было пересобрать;` },
};
const AGENT_URLS = { claude: 'https://claude.com/claude-code', codex: 'https://github.com/openai/codex', opencode: 'https://opencode.ai/' };
const kindOf = k => KINDS[k] ? k : 'app';

// Что нужно установить для раздела. any — хватит любой из команд; args — проверка запуском
// (на Windows «python» может оказаться заглушкой Microsoft Store, поэтому просто найти файл мало).
const REQS = {
  mod: [
    { name: 'Java JDK 21', why: 'для модов Minecraft (Fabric / Forge)', any: [['java', '-version']], url: 'https://adoptium.net/temurin/releases/?version=21' },
    { name: '.NET SDK', why: 'для модов Terraria, Stardew Valley и Unity-игр', any: [['dotnet', '--list-sdks', 'out']], url: 'https://dotnet.microsoft.com/download' },
  ],
  bot: [
    { name: 'Python 3', why: 'на нём пишется и запускается бот', any: [['python', '--version'], ['python3', '--version'], ['py', '--version']], url: 'https://www.python.org/downloads/' },
  ],
  video: [
    { name: 'Node.js', why: 'на нём работает Remotion, который собирает ролик (FFmpeg и браузер для рендера он скачает сам)', any: [['node', '--version'], ['npx', '--version']], url: 'https://nodejs.org/' },
  ],
};

let reqCache = { at: 0, value: null };
function checkCmd([cmd, arg, mode]) {
  const exe = resolveCmd(cmd);
  if (!exe) return false;
  try {
    const ext = path.extname(exe).toLowerCase();
    const r = isWin && (ext === '.cmd' || ext === '.bat')
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', exe, arg], { encoding: 'utf8', windowsHide: true, timeout: 6000 })
      : spawnSync(exe, [arg], { encoding: 'utf8', windowsHide: true, timeout: 6000, env: Object.assign({}, process.env, { PATH: currentPath() }) });
    if (r.status !== 0) return false;
    return mode === 'out' ? !!(r.stdout || '').trim() : true;
  } catch (_) { return false; }
}

function requirements(force) {
  if (!force && reqCache.value && Date.now() - reqCache.at < 30000) return reqCache.value;
  const memo = {}, value = {};
  for (const kind of Object.keys(REQS)) value[kind] = REQS[kind].map(r => ({
    name: r.name, why: r.why, links: r.links || [[r.name, r.url]],
    found: r.any.some(c => { const k = c.join(' '); if (!(k in memo)) memo[k] = checkCmd(c); return memo[k]; }),
  }));
  reqCache = { at: Date.now(), value };
  return value;
}

// ---------- данные ----------

let data = load();

function load() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken');
  }
  d.ideas = d.ideas || [];
  d.topics = d.topics || [];
  d.agents = d.agents && d.agents.length ? d.agents : JSON.parse(JSON.stringify(DEFAULT_AGENTS));
  d.settings = Object.assign({ agent: 'claude', kind: 'app', count: 10, auto: true, projectsDir: path.join(ROOT, 'projects') }, d.settings);
  // если приложение закрыли посреди разработки
  for (const i of d.ideas) if (i.status === 'building') i.status = i.builtAt ? 'built' : 'failed';
  return d;
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c;
const ideasWord = n => n + ' ' + plural(n, 'идею', 'идеи', 'идей');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const agentById = id => data.agents.find(a => a.id === id) || data.agents[0];

// ---------- поиск и запуск агента ----------

let pathCache = { at: 0, value: '' };
function currentPath() {
  if (!isWin) return process.env.PATH || '';
  if (Date.now() - pathCache.at < 10000) return pathCache.value;
  const parts = [process.env.PATH || ''];
  for (const key of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const r = spawnSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(r.stdout || '');
      if (m) parts.push(m[1].trim().replace(/%([^%]+)%/g, (all, v) => process.env[v] || all));
    } catch (_) {}
  }
  const seen = new Set();
  const value = parts.join(';').split(';').filter(d => d && !seen.has(d.toLowerCase()) && seen.add(d.toLowerCase())).join(';');
  pathCache = { at: Date.now(), value };
  return value;
}

function searchDirs() {
  const dirs = currentPath().split(path.delimiter);
  const home = os.homedir();
  dirs.push(path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.opencode', 'bin'));
  if (isWin && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
  if (!isWin) dirs.push('/usr/local/bin', '/opt/homebrew/bin');
  return dirs.filter(Boolean);
}

function resolveCmd(cmd) {
  if (!cmd) return null;
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const exts = isWin ? (path.extname(cmd) ? [''] : ['.exe', '.cmd', '.bat']) : [''];
  for (const d of searchDirs()) for (const e of exts) {
    const p = path.join(d.replace(/^"|"$/g, ''), cmd + e);
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

function splitArgs(s) {
  const out = []; const re = /"([^"]*)"|(\S+)/g; let m;
  while ((m = re.exec(s || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

let child = null, stopped = false;

// Запускает агента. Задание уходит через stdin, а если в аргументах есть {prompt} — подставляется туда.
function run(agent, argStr, prompt, cwd, onOut, onErr) {
  return new Promise((resolve, reject) => {
    const exe = resolveCmd(agent.cmd);
    if (!exe) return reject(new Error(`${agent.name} не найден (команда «${agent.cmd}»). Установка: ${agent.install}`));
    const viaArg = argStr.includes('{prompt}');
    const args = splitArgs(argStr).map(a => a === '{prompt}' ? prompt : a);
    const env = Object.assign({}, process.env, { PATH: currentPath() });
    delete env.CLAUDECODE; delete env.CLAUDE_CODE_ENTRYPOINT;   // чтобы вложенный claude не думал, что он внутри другой сессии

    let c;
    const ext = path.extname(exe).toLowerCase();
    if (isWin && (ext === '.cmd' || ext === '.bat')) {
      // npm-обёртки .cmd запускаются только через cmd.exe; кавычки и переводы строк cmd не переживает
      const q = s => '"' + String(s).replace(/"/g, "'").replace(/%/g, '％').replace(/[\r\n]+/g, ' ') + '"';
      c = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + [exe, ...args].map(q).join(' ') + '"'],
        { cwd, env, windowsVerbatimArguments: true, windowsHide: true });
    } else {
      c = spawn(exe, args, { cwd, env, windowsHide: true, detached: !isWin });
    }
    child = c; stopped = false;

    let out = '';
    const lines = (stream, cb, keep) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        if (keep) out += chunk;
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (cb && l.trim()) cb(l); }
      });
      stream.on('end', () => { if (cb && buf.trim()) cb(buf); });
    };
    lines(c.stdout, onOut, true);
    lines(c.stderr, onErr, false);
    c.on('error', e => { child = null; reject(e); });
    c.on('close', code => { child = null; resolve({ code: code == null ? -1 : code, out }); });
    c.stdin.on('error', () => {});
    if (!viaArg) c.stdin.write(prompt);
    c.stdin.end();
  });
}

function stop() {
  if (!child) return;
  stopped = true;
  if (isWin) spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true });
  else try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { child.kill('SIGTERM'); }
}

// ---------- живые события для страницы (SSE) ----------

const clients = new Set();
let job = { phase: 'idle' };
let runLog = [];

function send(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

function log(kind, text) {
  const entry = { kind, text: String(text), t: Date.now() };
  runLog.push(entry);
  if (runLog.length > 3000) runLog = runLog.slice(-2000);
  send('log', entry);
}

function setJob(j) { job = j; send('job', job); }
function pushState() { send('state', publicState()); }

function publicState() {
  return {
    ideas: data.ideas, topics: data.topics, settings: data.settings, job,
    kinds: Object.keys(KINDS).map(id => ({ id, label: KINDS[id].label })),
    agents: data.agents.map(a => Object.assign({}, a, { found: !!resolveCmd(a.cmd), url: AGENT_URLS[a.id] || (/^https?:/.test(a.install) ? a.install : '') })),
    reqs: requirements(),
  };
}

// Строка stream-json от Claude Code → понятная строка лога.
function prettyLine(line) {
  const t = line.trim();
  if (!t.startsWith('{')) return [['text', line]];
  let ev; try { ev = JSON.parse(t); } catch (_) { return [['text', line]]; }
  const out = [];
  if (ev.type === 'system' && ev.subtype === 'init') out.push(['info', `Агент запущен${ev.model ? ' · модель ' + ev.model : ''}`]);
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const c of ev.message.content) {
      if (c.type === 'text' && c.text.trim()) out.push(['text', c.text.trim()]);
      if (c.type === 'tool_use') out.push(['tool', `${c.name}  ${brief(c.input)}`]);
    }
  }
  if (ev.type === 'result') out.push([ev.is_error ? 'err' : 'done', ev.is_error ? 'Ошибка агента: ' + (ev.result || ev.subtype) : 'Агент закончил работу']);
  return out;
}

function brief(input) {
  if (!input) return '';
  const v = input.file_path || input.command || input.pattern || input.url || input.description || input.path || '';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
}

// ---------- промпты ----------

function genPrompt(topic, n, kind) {
  const K = KINDS[kind];
  const known = data.ideas.filter(i => kindOf(i.kind) === kind && i.topic.toLowerCase() === topic.toLowerCase()).slice(-40).map(i => '- ' + i.title);
  return `Ты — генератор идей. Придумай ровно ${n} разных идей: ${K.many} на тему «${topic}».

Требования к идеям:
- ${K.ideaRules};
- идеи разные по сути, а не вариации одной;
- конкретные, интересные, без банальностей.
${known.length ? '\nЭти идеи уже были, не повторяй их:\n' + known.join('\n') + '\n' : ''}
Ответь ТОЛЬКО JSON-массивом, без markdown и пояснений:
[{"title": "короткое название", "description": "2–3 предложения: что это, для кого и чем цепляет"}]`;
}

function analyzePrompt(topic, ideas, kind) {
  const K = KINDS[kind];
  const useful = kind === 'video' ? 'насколько ролик интересен и полезен зрителю, досмотрят ли его' : kind === 'game' ? 'насколько затягивает играть' : 'насколько полезно в жизни';
  return `Вот идеи (${K.many}) на тему «${topic}»:
${ideas.map((i, k) => `${k + 1}. ${i.title} — ${i.description}`).join('\n')}

Оцени каждую по шкале 0–10:
- usefulness — ${useful};
- feasibility — насколько надёжно ИИ-агент сделает это за один сеанс так, чтобы результат реально работал;
- novelty — оригинальность;
- wow — насколько впечатлит готовый результат${kind === 'video' ? ' и залетит в рекомендации' : ''}.
Выбери одну лучшую, чтобы сделать прямо сейчас (учитывай всё вместе, реализуемость важна).

Ответь ТОЛЬКО JSON без markdown:
{"ratings":[{"index":1,"usefulness":8,"feasibility":9,"novelty":6,"wow":7,"pros":"главный плюс","cons":"главный минус или риск"}],"best":1,"reason":"почему именно она, 1–2 предложения"}`;
}

function buildPrompt(idea) {
  const K = KINDS[kindOf(idea.kind)];
  return `Сделай ${K.one} в текущей папке (она пустая и целиком твоя).

Идея: ${idea.title}
${idea.description}
Тема: ${idea.topic}${idea.reason ? '\nПочему выбрана: ' + idea.reason : ''}

Требования:
${K.build}
- ничего не меняй за пределами этой папки.
В конце коротко напиши, что сделано и как этим пользоваться.`;
}

function improvePrompt(idea, request) {
  const K = KINDS[kindOf(idea.kind)];
  return `В текущей папке лежит ${K.one} «${idea.title}» (${idea.description}).
Доработай по просьбе пользователя: ${request}

Требования к результату остаются прежними:
${K.build}
Проверь, что всё по-прежнему работает, и обнови README.md${kindOf(idea.kind) === 'video' ? ', пересобери video.mp4 и обнови scenario.md' : ''}, если что-то поменялось. Ничего не меняй за пределами этой папки.`;
}

// ---------- разбор ответов ----------

function extractJson(text, open, close) {
  const s = text.replace(/```(?:json)?/g, '');
  const a = s.indexOf(open), b = s.lastIndexOf(close);
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
}

function parseIdeas(text) {
  let arr = extractJson(text, '[', ']');
  if (!Array.isArray(arr)) { const o = extractJson(text, '{', '}'); arr = o && (o.ideas || Object.values(o).find(Array.isArray)); }
  if (!Array.isArray(arr)) return null;
  return arr.filter(x => x && (x.title || x.name)).map(x => ({ title: String(x.title || x.name).trim(), description: String(x.description || x.desc || '').trim() }));
}

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? Math.max(0, Math.min(10, n)) : 0; };

// ---------- конвейер ----------

const busy = () => job.phase !== 'idle';

async function generate({ topic, count, agent, auto, kind }) {
  kind = kindOf(kind);
  topic = String(topic || '').trim();
  count = Math.max(1, Math.min(30, Number(count) || 10));
  const ag = agentById(agent);
  Object.assign(data.settings, { agent: ag.id, kind, count, auto: !!auto });
  data.topics = [topic, ...data.topics.filter(t => t.toLowerCase() !== topic.toLowerCase())].slice(0, 12);
  save();
  runLog = [];
  send('clear', {});
  setJob({ phase: 'gen', kind, topic, agent: ag.id, started: Date.now(), current: [] });
  fs.mkdirSync(WORK_DIR, { recursive: true });

  try {
    log('info', `${ag.name} придумывает ${ideasWord(count)} (${KINDS[kind].label.toLowerCase()}) на тему «${topic}»…`);
    const r1 = await run(ag, ag.gen, genPrompt(topic, count, kind), WORK_DIR, null, l => log('err', l));
    if (stopped) return finish('Остановлено');
    const raw = parseIdeas(r1.out);
    if (!raw || !raw.length) { log('err', r1.out.slice(0, 2000)); throw new Error('Агент ответил не в том формате — попробуй ещё раз'); }
    const ideas = raw.slice(0, count).map(x => ({
      id: uid(), kind, topic, title: x.title, description: x.description, status: 'bank', created: Date.now(), agent: ag.id,
    }));
    data.ideas.push(...ideas);
    save();
    log('done', `Готово: ${ideasWord(ideas.length)}. Сохранил в банк.`);
    setJob(Object.assign({}, job, { phase: 'analyze', started: Date.now(), current: ideas.map(i => i.id) }));
    pushState();

    log('info', 'Анализирую идеи: польза, реализуемость, новизна, вау-эффект…');
    const r2 = await run(ag, ag.gen, analyzePrompt(topic, ideas, kind), WORK_DIR, null, l => log('err', l));
    if (stopped) return finish('Остановлено');
    const a = extractJson(r2.out, '{', '}');
    if (!a || !Array.isArray(a.ratings)) { log('err', r2.out.slice(0, 2000)); throw new Error('Не смог разобрать анализ — идеи остались в банке'); }
    for (const r of a.ratings) {
      const i = ideas[Number(r.index) - 1];
      if (!i) continue;
      i.scores = { usefulness: num(r.usefulness), feasibility: num(r.feasibility), novelty: num(r.novelty), wow: num(r.wow) };
      i.score = Math.round((i.scores.usefulness + i.scores.feasibility + i.scores.novelty + i.scores.wow) / 4 * 10) / 10;
      i.pros = r.pros || ''; i.cons = r.cons || '';
    }
    let best = ideas[Number(a.best) - 1];
    if (!best) best = ideas.slice().sort((x, y) => (y.score || 0) - (x.score || 0))[0];
    best.best = true; best.reason = a.reason || '';
    save();
    log('done', `Лучшая идея: «${best.title}» — ${best.score}/10. ${best.reason}`);
    pushState();

    if (auto) { await build(best.id, true); return; }
    finish('Выбери идею и нажми «Сделать»');
  } catch (e) {
    finish('Ошибка: ' + e.message, true);
  }
}

function slug(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const r = String(s).toLowerCase().split('').map(c => map[c] !== undefined ? map[c] : c).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return r || 'app';
}

async function build(id, chained) {
  const idea = data.ideas.find(i => i.id === id);
  if (!idea) return finish('Идея не найдена', true);
  const ag = agentById(chained ? job.agent : data.settings.agent);
  if (!chained) { runLog = []; send('clear', {}); }
  const base = path.resolve(data.settings.projectsDir);
  let dir = path.join(base, slug(idea.title)), n = 2;
  while (fs.existsSync(dir)) dir = path.join(base, slug(idea.title) + '-' + n++);
  fs.mkdirSync(dir, { recursive: true });
  Object.assign(idea, { status: 'building', projectPath: dir, builtBy: ag.id });
  save();
  setJob({ phase: 'build', kind: kindOf(idea.kind), topic: idea.topic, agent: ag.id, started: Date.now(), current: chained ? job.current : [idea.id], building: idea.id });
  pushState();
  log('info', `${ag.name} делает «${idea.title}» в папке ${dir}`);
  await runBuild(ag, idea, buildPrompt(idea), dir, false);
}

async function improve(id, request) {
  const idea = data.ideas.find(i => i.id === id);
  if (!idea || !idea.projectPath) return;
  const ag = agentById(idea.builtBy || data.settings.agent);
  runLog = []; send('clear', {});
  const prev = idea.status;
  idea.status = 'building'; save();
  setJob({ phase: 'build', kind: kindOf(idea.kind), improving: true, topic: idea.topic, agent: ag.id, started: Date.now(), current: [idea.id], building: idea.id });
  pushState();
  log('info', `${ag.name} дорабатывает «${idea.title}»: ${request}`);
  await runBuild(ag, idea, improvePrompt(idea, request), idea.projectPath, prev);
}

async function runBuild(ag, idea, prompt, dir, prevStatus) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const r = await run(ag, ag.build, prompt, dir, l => prettyLine(l).forEach(([k, t]) => log(k, t)), l => log('err', l));
    const ok = r.code === 0 && !stopped;
    idea.status = ok ? 'built' : (prevStatus || 'failed');
    if (ok) idea.builtAt = Date.now();
    idea.entry = findEntry(dir, kindOf(idea.kind));
    save();
    try { fs.writeFileSync(path.join(dir, 'ideaforge.log'), runLog.map(e => `[${e.kind}] ${e.text}`).join('\n')); } catch (_) {}
    finish(stopped ? 'Остановлено' : ok ? `Готово! «${idea.title}» сделано` : `Агент завершился с кодом ${r.code}`, !ok);
  } catch (e) {
    idea.status = prevStatus || 'failed'; save();
    finish('Ошибка: ' + e.message, true);
  }
}

function findEntry(dir, kind) {
  if (kind === 'video') {
    for (const d of ['', 'out', 'output', 'dist', 'render'])
      try { const f = fs.readdirSync(path.join(dir, d)).find(n => /\.mp4$/i.test(n)); if (f) return d ? d + '/' + f : f; } catch (_) {}
  }
  if (kind === 'mod') for (const d of ['dist', 'build/libs', 'build']) if (fs.existsSync(path.join(dir, d))) return d + '/';
  for (const f of ['run.bat', 'start.bat', 'index.html', 'dist/index.html', 'public/index.html', 'src/index.html', 'main.py', 'app.py', 'README.md'])
    if (fs.existsSync(path.join(dir, f))) return f;
  return null;
}

function finish(msg, isErr) {
  log(isErr ? 'err' : 'done', msg);
  setJob({ phase: 'idle', last: msg, lastErr: !!isErr, current: job.current || [] });
  pushState();
  maybeQuit();
}

// ---------- открыть папку / запустить ----------

function openPath(p) {
  const cwd = !/^https?:/.test(p) && fs.existsSync(path.dirname(p)) ? path.dirname(p) : undefined;
  if (isWin) spawn('cmd.exe', ['/d', '/c', 'start "" "' + p + '"'], { detached: true, windowsHide: true, windowsVerbatimArguments: true, cwd }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
}

function openAction(idea, what) {
  const dir = idea.projectPath;
  if (!dir || !fs.existsSync(dir)) throw new Error('Папка проекта не найдена');
  if (what === 'folder') return openPath(dir);
  if (what === 'code') {
    const code = resolveCmd('code');
    if (!code) throw new Error('VS Code (команда code) не найден');
    if (isWin) spawn('cmd.exe', ['/d', '/s', '/c', '""' + code + '" "' + dir + '""'], { detached: true, windowsHide: true, windowsVerbatimArguments: true }).unref();
    else spawn(code, [dir], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  if (what === 'run') {
    const entry = findEntry(dir, kindOf(idea.kind));
    if (!entry) throw new Error('Не нашёл, чем запускать — открой README.md в папке');
    const p = path.join(dir, entry);
    if (entry.endsWith('.py')) spawn(isWin ? 'python' : 'python3', [p], { cwd: dir, detached: true, stdio: 'ignore' }).unref();
    else openPath(p);
    return;
  }
  if (what === 'log') return openPath(path.join(dir, 'ideaforge.log'));
}

// ---------- HTTP ----------

function body(req) {
  return new Promise(res => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch (_) { res({}); } });
  });
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // принимаем запросы только со своей страницы: к агенту с полными правами не должен достучаться чужой сайт
  if (req.method === 'POST') {
    const origin = req.headers.origin || '';
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return json(res, 403, { error: 'forbidden' });
    if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'json only' });
  }
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(pageHtml());
    }
    if (url.pathname === '/api/state') return json(res, 200, Object.assign(publicState(), { log: runLog }));
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => { clients.delete(res); maybeQuit(); });
      return;
    }
    if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
    const b = await body(req);
    const idea = b.id && data.ideas.find(i => i.id === b.id);
    switch (url.pathname) {
      case '/api/generate':
        if (busy()) return json(res, 409, { error: 'Агент уже работает' });
        if (!String(b.topic || '').trim()) return json(res, 400, { error: 'Напиши тему' });
        generate(b); return json(res, 200, { ok: true });
      case '/api/build':
        if (busy()) return json(res, 409, { error: 'Агент уже работает' });
        if (!idea) return json(res, 404, { error: 'Идея не найдена' });
        build(b.id, false); return json(res, 200, { ok: true });
      case '/api/improve':
        if (busy()) return json(res, 409, { error: 'Агент уже работает' });
        if (!idea || !String(b.request || '').trim()) return json(res, 400, { error: 'Нужна просьба' });
        improve(b.id, String(b.request).trim()); return json(res, 200, { ok: true });
      case '/api/stop': stop(); return json(res, 200, { ok: true });
      case '/api/delete':
        if (idea && idea.status === 'building') return json(res, 409, { error: 'Идея сейчас делается' });
        data.ideas = data.ideas.filter(i => i.id !== b.id); save(); pushState(); return json(res, 200, { ok: true });
      case '/api/tobank':
        if (idea) { idea.status = 'bank'; save(); pushState(); } return json(res, 200, { ok: true });
      case '/api/open':
        if (!idea) return json(res, 404, { error: 'Идея не найдена' });
        openAction(idea, b.what); return json(res, 200, { ok: true });
      case '/api/settings':
        if (b.settings) Object.assign(data.settings, b.settings);
        if (b.agents) data.agents = b.agents;
        if (b.resetAgents) data.agents = JSON.parse(JSON.stringify(DEFAULT_AGENTS));
        save(); pushState(); return json(res, 200, { ok: true });
      case '/api/recheck':
        pathCache.at = 0; requirements(true); pushState(); return json(res, 200, { ok: true, reqs: requirements() });
      case '/api/clearTopics':
        data.topics = []; save(); pushState(); return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

// ---------- окно приложения ----------
// Страница открывается отдельным окном (Edge/Chrome в режиме --app, со своим профилем) — без вкладок и адресной строки.
// Окно закрыли и агент не работает — IdeaForge завершается сам. Если агент ещё работает — дожидаемся конца.

const noOpen = process.argv.includes('--no-open');
const inTab = process.argv.includes('--browser');
let windowOpen = false, quitTimer = null;

function findAppBrowser() {
  const c = [];
  if (isWin) {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
      c.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      c.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const n of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) { const p = resolveCmd(n); if (p) c.push(p); }
  }
  return c.find(p => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || null;
}

function openWindow(url, own) {
  const browser = inTab ? null : findAppBrowser();
  if (!browser) { openPath(url); return; }
  const w = spawn(browser, ['--app=' + url, '--user-data-dir=' + path.join(ROOT, '.window'), '--window-size=1320,880',
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'], { stdio: 'ignore', windowsHide: false });
  if (!own) { w.unref(); return; }
  windowOpen = true;
  w.on('error', () => { windowOpen = false; openPath(url); });
  w.on('exit', () => { windowOpen = false; maybeQuit(); });
}

function maybeQuit() {
  if (noOpen || inTab) return;                       // в режиме сервера живём, пока не закроют консоль
  clearTimeout(quitTimer);
  quitTimer = setTimeout(() => {
    if (!windowOpen && clients.size === 0 && !busy()) process.exit(0);
  }, 4000);
}

function say(t) { try { console.log(t); } catch (_) {} }
process.on('uncaughtException', e => {
  try { fs.appendFileSync(path.join(ROOT, 'ideaforge-error.log'), new Date().toISOString() + ' ' + (e && e.stack || e) + '\n'); } catch (_) {}
  process.exit(1);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // уже запущен — просто показываем окно
    say(`IdeaForge уже запущен: http://localhost:${PORT}`);
    if (!noOpen) openWindow(`http://localhost:${PORT}`, false);
    setTimeout(() => process.exit(0), 300);
    return;
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  say(`\n  IdeaForge запущен → ${url}\n`);
  if (!noOpen) openWindow(url, true);
});

process.on('SIGINT', () => { stop(); process.exit(0); });
