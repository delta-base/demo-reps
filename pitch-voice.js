// REPS — Voice pitch practice.
// Talk to an AI buyer in real time through an ElevenLabs Agent, then get a local debrief.
//
// Configuration (first match wins):
//   1. ?agent=<agent_id> in the URL
//   2. window.REPS_VOICE_CONFIG = { agentId, signedUrlEndpoint }  (voice-config.js, or voice-server.mjs from .env)
// If signedUrlEndpoint is set, a signed URL is fetched instead, so the agent can stay private.
//
// Persona, first line and voice come from per-session overrides. The agent must allow the
// "System prompt", "First message" and "Voice" overrides in its Security settings.

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm';
const RECENT_VOICES_KEY = 'reps.voice.recent';
const MAX_CALL_SECONDS = 20 * 60; // matches the agent's max_duration_seconds

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const PERSONA_RULES = `
How to behave:
- This is a live sales or negotiation roleplay. The person talking to you is the learner (seller or founder). Stay fully in character. Never mention that you are an AI, a roleplay, or a coach.
- Speak naturally and briefly: 1 to 3 sentences per turn, like a real phone or video call.
- Do not volunteer your underlying concerns. Reveal them only when the learner asks a good, specific question.
- Push back with realistic objections. Reward clear, specific, quantified value and genuine curiosity; get more guarded when the learner is generic, defensive, concedes too fast, rambles, or pitches features without asking anything.
- If the learner asks for a concrete next step or proposes a deal and has earned it, agree to a specific one. If they have not earned it, politely decline or stall.
- If the learner says goodbye, close the call in one sentence.`;

const DIFFICULTY = {
  friendly: { label: 'Friendly', rule: 'You are open and curious. Give the learner the benefit of the doubt, and raise at most one mild objection.' },
  realistic: { label: 'Realistic', rule: 'You are professional but busy. Raise two genuine objections and expect specifics before you agree to anything.' },
  tough: { label: 'Tough', rule: 'You are skeptical and short on time. Interrupt rambling, challenge every claim with "how do you know?", and raise three or more objections before you consider a next step.' },
};

// ---------- Personas & voices ----------
// Premade ElevenLabs voices that suit business conversations. Tone steers the pick by difficulty.
const VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'female', tone: 'warm' },
  { id: 'hpp4J3VqNfWAUOO0d1Us', name: 'Bella', gender: 'female', tone: 'warm' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', tone: 'warm' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', tone: 'neutral' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', gender: 'female', tone: 'firm' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'female', tone: 'firm' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', gender: 'male', tone: 'warm' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', gender: 'male', tone: 'warm' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', tone: 'warm' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', gender: 'male', tone: 'warm' },
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric', gender: 'male', tone: 'neutral' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', tone: 'neutral' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', tone: 'neutral' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', tone: 'firm' },
  { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', tone: 'firm' },
  { id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill', gender: 'male', tone: 'firm' },
];
const TONE_FOR = { friendly: 'warm', tough: 'firm' };

// A voice that matches the persona's gender and the difficulty, avoiding the last few used.
function pickVoice(gender, difficulty) {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT_VOICES_KEY) || '[]'); } catch { /* storage blocked */ }
  const sameGender = VOICES.filter(v => v.gender === gender);
  const tone = TONE_FOR[difficulty];
  const pool = [sameGender.filter(v => (!tone || v.tone === tone) && !recent.includes(v.id)), sameGender.filter(v => !recent.includes(v.id)), sameGender]
    .find(list => list.length);
  const voice = pool[Math.floor(Math.random() * pool.length)];
  try { localStorage.setItem(RECENT_VOICES_KEY, JSON.stringify([voice.id, ...recent].slice(0, 4))); } catch { /* storage blocked */ }
  return voice;
}

const FEMALE_NAMES = ['Sofie', 'Elena', 'Nadia', 'Hannah', 'Julia', 'Amira', 'Clara', 'Lotte', 'Ines', 'Charlotte', 'Marie', 'Eva'];
const MALE_NAMES = ['Lucas', 'Marco', 'Pieter', 'Karim', 'Tom', 'Bram', 'David', 'Omar', 'Jonas', 'Arthur', 'Ruben', 'Thomas'];
const LAST_NAMES = ['Peeters', 'Janssens', 'Moreau', 'Rossi', 'Haddad', 'De Smet', 'Fischer', 'Novak', 'Dubois', 'Claes', 'Bakker', 'Silva', 'Wouters', 'Maes'];
const initialsOf = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const hueOf = name => [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

function randomPerson() {
  const gender = Math.random() < 0.5 ? 'female' : 'male';
  const first = pick(gender === 'female' ? FEMALE_NAMES : MALE_NAMES);
  return { name: `${first} ${pick(LAST_NAMES)}`, gender };
}

// Best guess when a user types their own buyer name.
function genderOf(name, fallback) {
  const first = String(name).trim().split(/\s+/)[0];
  if (FEMALE_NAMES.includes(first)) return 'female';
  if (MALE_NAMES.includes(first)) return 'male';
  return fallback;
}

export const PITCH_SCENARIOS = {
  elevator: {
    number: '01 / ELEVATOR PITCH',
    title: 'Sixty seconds with a busy VP.',
    summary: 'You catch a VP of Sales between meetings. Earn attention fast, connect to their world, and leave with a next step.',
    tags: ['Hook', 'Relevance', 'Clear ask'],
    persona: { name: 'Maya Laurent', gender: 'female', role: 'VP Sales, mid-market SaaS (120 reps)', initials: 'ML' },
    objective: 'Within about two minutes, earn enough interest to book a 30-minute discovery call.',
    tips: ['Open with something about their world, not your company history.', 'One sharp problem, one outcome with a number.', 'End with a specific, low-friction ask.'],
    firstMessage: "Hi, sorry, I've only got a couple of minutes before my next call. What did you want to talk about?",
    prompt: `You are Maya Laurent, VP of Sales at a 120-rep mid-market SaaS company. You are walking between meetings and have about two minutes.
Hidden context (reveal only if asked well): new reps take about 7 months to ramp, which is too slow; win rates dropped from 24% to 19% this year; managers don't have time to coach. You've been burned by "AI training tools" that reps ignored.
The seller sells a sales practice and coaching platform.`,
  },
  cfo: {
    number: '02 / VALUE PITCH TO FINANCE',
    title: 'Make the CFO care.',
    summary: 'The CFO joins late and asks one thing: why should we spend money on this? Translate your pitch into business impact.',
    tags: ['ROI framing', 'Cost of inaction', 'Proof'],
    persona: { name: 'Thomas Verbeke', gender: 'male', role: 'CFO, logistics group (€300M revenue)', initials: 'TV' },
    objective: 'Get the CFO to agree that the business case is worth building together, with their numbers.',
    tips: ['Ask what the board measures before you quote ROI.', 'Make the cost of doing nothing explicit.', 'Use a proof point, then propose building the case together.'],
    firstMessage: "I'm told you have ten minutes. Honestly, every vendor says they'll save us money. Why should I spend budget on this right now?",
    prompt: `You are Thomas Verbeke, CFO of a logistics group with €300M revenue. Budgets are frozen except for projects with payback under 12 months.
Hidden context (reveal only if asked well): the board is focused on gross margin, which fell 2 points; the sales team gives away an average 11% discount to close deals; you suspect weak negotiation skills but have no data.
You dislike vague ROI claims and buzzwords. You respond well to questions about your priorities and to simple, conservative math.
The seller sells a sales practice and coaching platform.`,
  },
  displacement: {
    number: '03 / COMPETITIVE DISPLACEMENT',
    title: '“We already use someone.”',
    summary: 'The prospect is happy enough with an incumbent. Find the gap they tolerate, differentiate without bashing, and earn a pilot.',
    tags: ['Discovery', 'Differentiation', 'Objection handling'],
    persona: { name: 'Priya Nair', gender: 'female', role: 'Head of Enablement, fintech scale-up', initials: 'PN' },
    objective: 'Uncover a gap in the current setup and agree a small pilot or comparison.',
    tips: ['Acknowledge the incumbent, then get curious about what it does not do.', 'Differentiate on their gap, not your feature list.', 'Propose a low-risk way to compare.'],
    firstMessage: "Thanks for reaching out, but to be upfront, we already have a training platform and it's fine. So what's different about yours?",
    prompt: `You are Priya Nair, Head of Enablement at a 400-person fintech scale-up. You use a well-known video-based sales training library and your contract renews in 4 months.
Hidden context (reveal only if asked well): completion rates are under 30%; reps watch videos but don't change behaviour on calls; your CRO asked you to prove training impact on win rates and you can't.
You are loyal and dislike sellers who criticise the incumbent. You'd consider a small pilot with one team if the seller makes the gap feel real.
The seller sells a sales practice and coaching platform with AI roleplay.`,
  },
};

// ---------- Surprise pitch: a new buyer, business and product every time ----------
const pick = a => a[Math.floor(Math.random() * a.length)];

const BUYERS = [
  { business: 'a family-owned B2C car dealership with three showrooms selling new and used cars', role: 'Owner & Managing Director' },
  { business: 'a boutique hotel with 40 rooms in a historic city centre', role: 'General Manager' },
  { business: 'a chain of 12 neighbourhood bakeries', role: 'Founder & CEO' },
  { business: 'a regional chain of fitness studios with 9 locations', role: 'Head of Operations' },
  { business: 'a mid-size dental clinic group with 6 practices', role: 'Practice Group Director' },
  { business: 'an e-commerce shop selling premium pet food online', role: 'Co-founder, Growth' },
  { business: 'a logistics company running 80 delivery vans', role: 'Fleet Manager' },
  { business: 'a 200-seat family restaurant and event venue', role: 'Owner' },
  { business: 'a private school with 650 students', role: 'Head of Facilities & Finance' },
  { business: 'a real-estate agency with 25 agents', role: 'Managing Partner' },
  { business: 'a garden centre with a large outdoor showroom and café', role: 'Owner' },
  { business: 'a B2B software company with 150 employees', role: 'COO' },
];

const PRODUCTS = [
  { product: 'LiftDeck, a car elevator that stacks two cars in one parking space', price: 'about €18,000 per unit installed, or €390 a month on lease' },
  { product: 'an AI phone receptionist that answers and books calls 24/7', price: '€249 per month per location' },
  { product: 'smart solar carports with EV chargers', price: 'from €45,000, with a subsidy covering up to 30%' },
  { product: 'a customer-loyalty app with a points and referral program', price: '€1,200 setup plus €299 per month' },
  { product: 'an autonomous floor-cleaning robot', price: '€14,500 per robot or €520 per month' },
  { product: 'a staff scheduling and payroll platform', price: '€6 per employee per month' },
  { product: 'a 3D virtual-tour and video studio service', price: '€900 per location, one-off' },
  { product: 'energy-monitoring sensors that cut electricity bills', price: '€3,000 install plus a 20% share of savings in year one' },
  { product: 'a premium coffee-machine subscription for customers and staff', price: '€180 per month per machine, beans included' },
  { product: 'a cybersecurity monitoring service for small businesses', price: '€450 per month' },
  { product: 'a digital signage network with dynamic pricing screens', price: '€2,000 per screen plus €40 per month' },
  { product: 'a corporate e-bike leasing program for employees', price: 'tax-advantaged, about €0 net cost to the employer' },
];

const PERSONALITIES = [
  'numbers-driven: you want concrete figures and payback time',
  'friendly and chatty, but you avoid committing to anything',
  'risk-averse: you worry about disruption, reliability and what could go wrong',
  'impatient and direct: you hate small talk and long monologues',
  'curious about innovation, but burned before by a vendor who overpromised',
  'very price-sensitive: every euro is scrutinised',
];
const GOALS = [
  'Book an on-site visit or demo next week.',
  'Agree to a small paid pilot.',
  'Get a meeting that includes the other decision-maker.',
  'Close a first order or a signed letter of intent.',
  'Get permission to send a tailored proposal, with a follow-up call in the calendar.',
];
const OPENERS = [
  "Hello, {name} speaking. My assistant said you wanted five minutes. Go ahead.",
  "Yes, hi. I've got a few minutes. What's this about?",
  "{name} here. Honestly we get a lot of sales calls, so what makes this one different?",
  "Hi, sorry, it's busy here today. What can I do for you?",
];

// ---------- Existing REPS scenarios (the `scenarios` object in demo.html) ----------
// demo.html defines `const scenarios` in a classic script; top-level consts are visible here by name.
function libraryScenarios() {
  try { return typeof scenarios === 'object' && scenarios ? scenarios : {}; } catch { return {}; }
}

function fromLibrary(key, intention) {
  const x = libraryScenarios()[key];
  if (!x) return null;
  const strip = t => String(t).replace(/[“”"]/g, '').trim();
  const who = randomPerson();
  // Scripted replies tell the agent how this counterpart reacts and what sits behind their position.
  const reactions = (x.turns || []).flatMap(turn => turn.map(c => `- If the learner says something like "${strip(c.text)}" (${['weak', 'partial', 'strong'][c.quality]} move), you would react like: "${strip(c.reply)}"`));
  return {
    library: true,
    number: `${x.audience} SCENARIO`,
    title: strip(x.title),
    summary: x.context,
    persona: { name: who.name, gender: who.gender, role: x.role, initials: initialsOf(who.name) },
    objective: x.intentions[intention]?.label || x.intentions.map(i => i.label).join(' '),
    tips: x.intentions.map(i => i.next),
    intentions: x.intentions,
    firstMessage: strip(x.opening),
    prompt: `You are ${who.name}, the ${x.role} in this conversation.
The learner's situation (from their side): ${x.context}
You open with: "${strip(x.opening)}"
How you react to different moves. Use these as character guidance, not a script. Improvise naturally beyond them and keep your underlying concern consistent:
${reactions.join('\n')}
The learner is practising these behaviours, so make them work for it: ${x.intentions.map(i => i.label).join(' ')}`,
  };
}

function generateScenario(overrides = {}) {
  const buyer = pick(BUYERS);
  const offer = pick(PRODUCTS);
  const who = randomPerson();
  const first = who.name.split(' ')[0];
  return buildRandomScenario({
    name: who.name,
    gender: who.gender,
    role: buyer.role,
    business: buyer.business,
    product: offer.product,
    price: offer.price,
    personality: pick(PERSONALITIES),
    goal: pick(GOALS),
    opener: pick(OPENERS).replace('{name}', first),
    ...overrides,
  });
}

function buildRandomScenario(b) {
  const initials = initialsOf(b.name);
  return {
    random: true,
    brief: b,
    number: 'SURPRISE PITCH',
    title: `Sell ${b.product.split(',')[0]} to ${b.name.split(' ')[0]}.`,
    summary: `You are calling ${b.name}, ${b.role} of ${b.business}. You sell ${b.product} (${b.price}).`,
    persona: { name: b.name, gender: genderOf(b.name, b.gender || 'female'), role: `${b.role} · ${b.business}`, initials },
    facts: [['Their business', b.business], ['You sell', b.product], ['Your price', b.price], ['Their personality', b.personality]],
    objective: b.goal,
    tips: ['Find out how their business makes money before you pitch.', 'Connect one feature to one of their real problems, with a number.', 'If it is a stretch fit, find the angle, or be honest about it.'],
    firstMessage: b.opener,
    prompt: `You are ${b.name}, ${b.role} of ${b.business}.
Your personality: ${b.personality}.
A seller is calling to pitch: ${b.product}. Their price is ${b.price}.
Before the call, silently invent 2 or 3 concrete, plausible details about your business that matter for this decision: real numbers, a current workaround, your budget situation, and who else must approve. Stay consistent with them for the whole call. Reveal them only when the seller asks good, specific questions.
If the product is a poor fit for your business, say so honestly unless the seller finds a credible angle. If it is a good fit, still make them earn it.`,
  };
}

// ---------- Debrief analysis (local, heuristic) ----------
const FILLERS = /\b(um+|uh+|erm|you know|i mean|basically|actually|kind of|sort of|like,)\b/gi;
const CHECKS = [
  { key: 'hook', label: 'Opened with their world', why: 'Your first words were about the buyer, a trigger, or an outcome, not your company history.',
    test: (u) => u[0] && (/\?/.test(u[0]) || /\b(you|your|team|noticed|saw|heard|congrat|curious)\b/i.test(u[0])) &&!/\b(we are a|we're a|founded in|our company)\b/i.test(u[0]) },
  { key: 'discovery', label: 'Asked discovery questions', why: 'At least two genuine questions about the buyer’s situation before or while pitching.',
    test: (u) => u.join(' ').split('?').length - 1 >= 2 },
  { key: 'value', label: 'Made value concrete', why: 'You quantified an outcome: a number, percentage, time or money saved.',
    test: (u) => /(\d|percent|%|€|\$|£|\b(hours?|days?|weeks?|months?|half|double|twice)\b)/i.test(u.join(' ')) },
  { key: 'proof', label: 'Backed it with proof', why: 'You referenced a customer, case, pilot result or evidence.',
    test: (u) => /\b(customer|client|case study|for example|for instance|we helped|worked with|teams like|companies like|results?|data shows)\b/i.test(u.join(' ')) },
  { key: 'objection', label: 'Explored the objection', why: 'You acknowledged pushback and asked what was behind it before answering.',
    test: (u) => u.some(t => /\b(understand|fair|makes sense|good point|hear you|totally|appreciate)\b/i.test(t) && /\?/.test(t)) },
  { key: 'ask', label: 'Asked for a clear next step', why: 'You proposed a specific, low-friction next step.',
    test: (u) => /\b(next step|would you be open|could we|shall we|book|schedule|calendar|meeting|call on|pilot|trial|demo|tuesday|wednesday|thursday|friday|monday|next week)\b/i.test(u.slice(-3).join(' ')) },
];

function analyse(session) {
  const userTurns = session.messages.filter(m => m.who === 'you').map(m => m.text);
  const agentTurns = session.messages.filter(m => m.who === 'buyer').map(m => m.text);
  const words = t => (t.match(/\b[\w'’-]+\b/g) || []).length;
  const youWords = userTurns.reduce((n, t) => n + words(t), 0);
  const themWords = agentTurns.reduce((n, t) => n + words(t), 0);
  const talkShare = youWords + themWords ? Math.round(youWords / (youWords + themWords) * 100) : 0;
  const fillers = userTurns.join(' ').match(FILLERS) || [];
  const userSeconds = Math.max(1, session.listeningMs / 1000);
  const wpm = youWords ? Math.round(youWords / (userSeconds / 60)) : 0;
  const questions = userTurns.join(' ').split('?').length - 1;
  const longest = userTurns.reduce((m, t) => Math.max(m, words(t)), 0);
  const checks = CHECKS.map(c => {
    const ok = !!c.test(userTurns);
    return { ...c, ok };
  });
  const score = Math.round(checks.filter(c => c.ok).length / checks.length * 100);
  return { userTurns, youWords, talkShare, fillers, wpm, questions, longest, checks, score };
}

// ---------- UI ----------
let Conversation = null;
let state = null; // { key, difficulty, stage, conversation, messages, status, mode, startedAt, listeningMs, modeSince, raf, timer, error }
let returnFocus = null;

function resolveConfig() {
  const params = new URLSearchParams(location.search);
  const cfg = window.REPS_VOICE_CONFIG || {};
  return {
    agentId: params.get('agent') || cfg.agentId || '',
    signedUrlEndpoint: cfg.signedUrlEndpoint || '',
  };
}

function ensureDialog() {
  let d = $('#voice-dialog');
  if (d) return d;
  d = document.createElement('dialog');
  d.id = 'voice-dialog';
  d.setAttribute('aria-labelledby', 'vp-title');
  d.innerHTML = `<div class="vp-header"><img src="imgs/REPS_logo.png" alt="REPS" width="2086" height="754"><span class="vp-badge">VOICE PITCH · ELEVENLABS</span><button class="vp-close" type="button" aria-label="Close voice practice">×</button></div><div class="vp-body" id="vp-content"></div>`;
  document.body.appendChild(d);
  d.querySelector('.vp-close').addEventListener('click', closeDialog);
  d.addEventListener('close', handleClosed); // Esc key
  d.addEventListener('click', onDialogClick);
  d.addEventListener('submit', e => { if (e.target.id === 'vp-chat') sendChat(e); });
  return d;
}

function closeDialog() {
  $('#voice-dialog')?.close();
  handleClosed();
}

// Runs once per session, whether closed by our buttons or by Esc.
async function handleClosed() {
  if (!state || state.closed) return;
  state.closed = true;
  const onClose = state.onClose;
  const spoke = state.messages.some(m => m.who === 'you');
  await endCall();
  // Another REPS dialog (e.g. the practice loop) may still be open underneath.
  if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
  if (returnFocus?.isConnected) returnFocus.focus();
  onClose?.({ spoke });
}

const practiceChannel = () => (window.REPSPractice?.channel === 'text' ? 'text' : 'voice');

function open(key, trigger, scenario, opts = {}) {
  returnFocus = trigger || document.activeElement;
  scenario ||= key === 'random' ? generateScenario() : key.startsWith('lib:') ? fromLibrary(key.slice(4), opts.intention) : PITCH_SCENARIOS[key];
  if (!scenario) return false;
  const onClose = opts.onClose ?? state?.onClose;
  const text = opts.channel ? opts.channel === 'text' : practiceChannel() === 'text';
  state = { key, scenario, onClose, text, difficulty: state?.difficulty || 'realistic', stage: 'setup', messages: [], status: 'disconnected', mode: 'listening', listeningMs: 0 };
  const d = ensureDialog();
  if (!d.open) d.showModal();
  document.body.classList.add('modal-open');
  $('#voice-dialog .vp-badge').textContent = state.text ? 'TEXT ROLEPLAY · ELEVENLABS' : 'VOICE PITCH · ELEVENLABS';
  render();
  return true;
}

function render() {
  const s = state.scenario;
  const root = $('#vp-content');
  $('#voice-dialog').classList.toggle('is-live', state.stage === 'live');
  if (state.stage === 'setup') root.innerHTML = renderSetup(s);
  else if (state.stage === 'live') root.innerHTML = renderLive(s);
  else root.innerHTML = renderDebrief(s);
  const h = $('#vp-title');
  if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  $('#voice-dialog').scrollTop = 0;
  if (state.stage === 'live') renderTranscript();
}

function renderSetup(s) {
  return `<div class="vp-kicker">${s.library ? "03 — VOICE PRACTICE" : "PITCH PRACTICE · VOICE"} · ${esc(s.number)}</div>
  <h2 id="vp-title">${esc(s.title)}</h2>
  <p class="vp-lead">${esc(s.summary)} ${state.text ? 'You will chat in text with an AI buyer in real time.' : 'You will speak out loud with an AI buyer in real time. Use headphones for the best experience.'}</p>
  <div class="vp-grid">
    ${s.random ? renderBriefEditor(s.brief) : `<div class="vp-card">
      <div class="vp-persona"><span class="vp-avatar">${esc(s.persona.initials)}</span><div><strong>${esc(s.persona.name)}</strong><small>${esc(s.persona.role)}</small></div></div>
      <div class="vp-objective"><strong>Your goal:</strong> ${esc(s.objective)}</div>
      <h3 style="margin-top:18px">Before you start</h3>
      <ul>${s.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
    </div>`}
    <div class="vp-card">
      <h3>Buyer difficulty</h3>
      <div class="vp-options" role="group" aria-label="Buyer difficulty">${Object.entries(DIFFICULTY).map(([k, v]) => `<button type="button" data-vp-difficulty="${k}" aria-pressed="${state.difficulty === k}">${v.label}</button>`).join('')}</div>
      <p class="vp-hint">${esc(DIFFICULTY[state.difficulty].rule)}</p>
      <div class="vp-setup-meta">
        <span>⏱ Up to 20 minutes</span>
        <span>${state.text ? '💬 Live text chat' : '🎧 Best with headphones'}</span>
        <span>📝 Debrief right after</span>
      </div>
    </div>
  </div>
  ${state.error ? `<div class="vp-error" role="alert">${esc(state.error)}</div>` : ''}
  <div class="vp-actions">
    <button class="vp-btn" type="button" data-vp-action="start">${state.text ? '💬 Start the chat' : '🎙 Start the call'}</button>
    <span class="vp-hint" style="margin:0">${state.text ? 'Type your replies; the buyer answers in text.' : 'Your browser will ask for microphone access.'}</span>
  </div>`;
}

const BRIEF_FIELDS = [
  ['name', 'Buyer name'], ['role', 'Their role'], ['business', 'Their business'],
  ['product', 'What you are selling'], ['price', 'Your price'], ['personality', 'Buyer personality'], ['goal', 'Your goal for the call'],
];
function renderBriefEditor(b) {
  return `<div class="vp-card">
    <div class="vp-brief-head"><h3>Your brief</h3><button class="vp-btn secondary vp-reroll" type="button" data-vp-action="reroll">🎲 New scenario</button></div>
    <p class="vp-hint">Randomly generated. Reroll it, or edit any field to set up your own situation.</p>
    ${BRIEF_FIELDS.map(([k, label]) => `<label class="vp-field">${label}${k === 'business' || k === 'product'
      ? `<textarea data-brief="${k}" rows="2">${esc(b[k])}</textarea>`
      : `<input data-brief="${k}" type="text" value="${esc(b[k])}">`}</label>`).join('')}
  </div>`;
}

function readBrief() {
  const b = { ...state.scenario.brief };
  document.querySelectorAll('[data-brief]').forEach(el => { const v = el.value.trim(); if (v) b[el.dataset.brief] = v; });
  const first = b.name.split(' ')[0];
  if (!b.opener.includes(first)) b.opener = b.opener.replace(/[A-Z][a-z]+ (here|speaking)/, `${first} $1`);
  return b;
}

const ICON = {
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.7 2.5M5.5 11a6.5 6.5 0 0 0 10.3 5.3M18.5 11c0 .8-.1 1.5-.4 2.2M12 17.5V21M4 4l16 16"/></svg>',
  cc: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10.5 10.2a2.4 2.4 0 1 0 0 3.6M17 10.2a2.4 2.4 0 1 0 0 3.6"/></svg>',
  panel: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M14.5 4v16"/></svg>',
  end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 14.5c4.7-4.3 12.3-4.3 17 0l-1.8 2.3a1 1 0 0 1-1.3.2l-2.3-1.4a1 1 0 0 1-.5-.9v-1.8a10.6 10.6 0 0 0-5.2 0v1.8a1 1 0 0 1-.5.9L6.6 17a1 1 0 0 1-1.3-.2z"/></svg>',
};

function caseHtml(s) {
  const facts = s.facts || [];
  return `<div class="cs-person"><span class="cs-avatar" style="--hue:${hueOf(s.persona.name)}">${esc(s.persona.initials)}</span><div><strong>${esc(s.persona.name)}</strong><small>${esc(s.persona.role)}</small></div></div>
    <div class="cs-block cs-goal"><span>Your goal</span><p>${esc(s.objective)}</p></div>
    <div class="cs-block"><span>Situation</span><p>${esc(s.summary)}</p></div>
    ${facts.length ? `<dl class="cs-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
    <div class="cs-block"><span>Moves to try</span><ul>${s.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
    <div class="cs-chip">${esc(DIFFICULTY[state.difficulty].label)} buyer${state.voice ? ` · voice ${esc(state.voice.name)}` : ''}</div>`;
}

function renderLive(s) {
  const tab = state.tab || (state.text ? 'chat' : 'case');
  const first = s.persona.name.split(' ')[0];
  return `<div class="call ${state.text ? 'is-text' : ''} ${state.panel === false ? 'no-panel' : ''}" id="vp-stage" data-status="${state.status}" data-mode="${state.mode}">
    <div class="call-top">
      <div class="call-live"><span class="call-dot"></span><span id="vp-state" role="status" aria-live="polite">${stateLabel()}</span></div>
      <h2 class="call-title" id="vp-title">${esc(s.title)}</h2>
      <div class="call-time"><span id="vp-timer">00:00</span><span class="call-limit">/ ${fmt(MAX_CALL_SECONDS)}</span></div>
    </div>
    <div class="call-body">
      <section class="call-main" aria-label="Call">
        <div class="tile tile-them" style="--hue:${hueOf(s.persona.name)}">
          <div class="tile-glow" aria-hidden="true"></div>
          <div class="avatar-wrap">
            <span class="avatar-ring r1" aria-hidden="true"></span><span class="avatar-ring r2" aria-hidden="true"></span>
            <div class="avatar" id="vp-avatar">${esc(s.persona.initials)}</div>
          </div>
          <div class="tile-typing" aria-hidden="true"><i></i><i></i><i></i></div>
          <div class="tile-label"><span class="eq" id="vp-eq-them" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>${esc(s.persona.name)}</strong><span>${esc(s.persona.role)}</span></div>
          ${state.text ? '' : `<div class="tile-caption ${state.captions === false ? 'off' : ''}" id="vp-caption" aria-hidden="true"></div>`}
          ${state.text ? '' : `<div class="tile tile-you ${state.muted ? 'muted' : ''}" id="vp-you">
            <div class="you-avatar">You</div>
            <div class="tile-label small"><span class="eq" id="vp-eq-you" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>You</strong><span class="you-muted">${ICON.micOff}</span></div>
          </div>`}
        </div>
      </section>
      <aside class="call-side" aria-label="Case and transcript">
        <div class="side-tabs" role="tablist">
          <button type="button" role="tab" data-vp-tab="case" aria-selected="${tab === 'case'}">Case details</button>
          <button type="button" role="tab" data-vp-tab="chat" aria-selected="${tab === 'chat'}">${state.text ? 'Chat' : 'Transcript'}</button>
        </div>
        <div class="side-panel case-panel" ${tab === 'case' ? '' : 'hidden'}>${caseHtml(s)}</div>
        <div class="side-panel chat-panel" ${tab === 'chat' ? '' : 'hidden'}>
          <div class="vp-transcript" id="vp-transcript" aria-label="Live transcript"></div>
          ${state.text ? `<form class="vp-chat" id="vp-chat"><input id="vp-chat-input" type="text" autocomplete="off" placeholder="Reply to ${esc(first)}…" aria-label="Your reply" ${state.status === 'connected' ? '' : 'disabled'}><button class="vp-send" type="submit" aria-label="Send">➤</button></form>` : ''}
        </div>
      </aside>
    </div>
    <div class="call-controls">
      ${state.text ? '' : `<button type="button" class="ctl ${state.muted ? 'off' : ''}" data-vp-action="mute" aria-pressed="${!!state.muted}" title="${state.muted ? 'Unmute' : 'Mute'}">${state.muted ? ICON.micOff : ICON.mic}<span>${state.muted ? 'Unmute' : 'Mute'}</span></button>
      <button type="button" class="ctl ${state.captions === false ? 'off' : ''}" data-vp-action="captions" aria-pressed="${state.captions !== false}" title="Captions">${ICON.cc}<span>Captions</span></button>`}
      <button type="button" class="ctl ${state.panel === false ? 'off' : ''}" data-vp-action="panel" aria-pressed="${state.panel !== false}" title="Case details">${ICON.panel}<span>Case</span></button>
      <button type="button" class="ctl ctl-end" data-vp-action="end" title="End and get your debrief">${ICON.end}<span>${state.text ? 'End chat' : 'End call'} & debrief</span></button>
    </div>
  </div>`;
}

function stateLabel() {
  const first = state.scenario.persona.name.split(' ')[0];
  if (state.status === 'connecting') return `Calling ${first}…`;
  if (state.status !== 'connected') return state.text ? 'Chat ended' : 'Call ended';
  if (state.text) return state.waiting ? `${first} is typing…` : 'Live · your turn';
  return state.mode === 'speaking' ? `${first} is speaking` : 'Live · listening to you';
}

function transcriptHtml() {
  const s = state.scenario;
  if (!state.messages.length) return `<p class="vp-empty">The transcript will appear here as you talk.</p>`;
  return state.messages.map(m => `<div class="vp-msg ${m.who === 'you' ? 'you' : ''}"><small>${m.who === 'you' ? 'YOU' : esc(s.persona.name.toUpperCase())}</small>${esc(m.text)}</div>`).join('');
}

function renderTranscript() {
  const el = $('#vp-transcript');
  if (!el) return;
  el.innerHTML = transcriptHtml();
  el.scrollTop = el.scrollHeight;
  const cap = $('#vp-caption');
  const last = state.messages[state.messages.length - 1];
  if (cap && last) { cap.textContent = last.who === 'buyer' ? last.text : ''; cap.classList.toggle('show', last.who === 'buyer'); }
}

function syncLiveState() {
  const stage = $('#vp-stage');
  if (!stage) return;
  stage.dataset.status = state.status;
  stage.dataset.mode = state.mode;
  stage.classList.toggle('is-waiting', !!state.waiting);
  $('#vp-state').textContent = stateLabel();
  const input = $('#vp-chat-input');
  if (input) { input.disabled = state.status !== 'connected'; if (!input.disabled) input.focus(); }
}

function renderDebrief(s) {
  const a = analyse(state);
  const dur = Math.round((state.endedAt - (state.startedAt || state.endedAt)) / 1000);
  const strongest = a.checks.find(c => c.ok);
  const nextFocus = a.checks.find(c => !c.ok);
  if (!a.userTurns.length) {
    return `<div class="vp-kicker">DEBRIEF</div><h2 id="vp-title">No pitch captured yet.</h2><p class="vp-lead">We didn't hear anything from you in that call. Check that your microphone is allowed and not muted, then try again.</p>
    <div class="vp-actions"><button class="vp-btn" type="button" data-vp-action="retry">Try again</button><button class="vp-btn secondary" type="button" data-vp-action="close">Back to scenarios</button></div>`;
  }
  const metric = (value, label, verdict, good) => `<div class="vp-metric"><strong>${value}</strong><span>${label}</span>${verdict ? `<em class="${good ? 'good' : 'warn'}">${verdict}</em>` : ''}</div>`;
  return `<div class="vp-kicker">DEBRIEF · ${esc(s.number)}</div>
  <h2 id="vp-title">How your pitch landed.</h2>
  <div class="vp-score"><strong>${a.score}</strong><span>pitch structure score · ${a.checks.filter(c => c.ok).length} of ${a.checks.length} moves observed · ${fmt(dur)} call</span></div>
  <div class="vp-metrics">
    ${metric(a.talkShare + '%', 'your share of the talking', a.talkShare > 65 ? 'Talking too much, ask more' : a.talkShare < 30 ? 'Say more about value' : 'Healthy balance', a.talkShare <= 65 && a.talkShare >= 30)}
    ${metric(a.questions, 'questions you asked', a.questions >= 3 ? 'Curious' : 'Ask more questions', a.questions >= 3)}
    ${state.text ? metric(a.userTurns.length, 'messages you sent', a.longest > 60 ? 'Shorter messages land better' : 'Concise', a.longest <= 60) : metric(a.wpm || '–', 'words per minute (est.)', a.wpm ? (a.wpm > 175 ? 'Slow down a little' : a.wpm < 110 ? 'Add some energy' : 'Comfortable pace') : '', a.wpm >= 110 && a.wpm <= 175)}
    ${metric(a.fillers.length, 'filler words heard', a.fillers.length > 4 ? 'Pause instead of filling' : 'Clean delivery', a.fillers.length <= 4)}
  </div>
  ${s.intentions ? `<div class="vp-card" style="margin-top:22px"><h3>The behaviours this scenario trains</h3><p class="vp-hint">Compare these with your transcript below. Did you make each move?</p><ul>${s.intentions.map(i => `<li><strong>${esc(i.label)}</strong> For example: ${esc(i.example)}</li>`).join('')}</ul></div>` : ''}
  <div class="vp-checks">${a.checks.map(c => `<div class="vp-check"><b class="${c.ok ? 'ok' : 'miss'}">${c.ok ? '✓ OBSERVED' : '○ NOT YET'}</b><div><strong>${esc(c.label)}</strong><p>${esc(c.why)}</p></div></div>`).join('')}</div>
  <div class="vp-grid">
    <div class="vp-card"><h3>Keep doing</h3><p class="vp-hint" style="font-size:.95rem">${strongest ? esc(strongest.label) + '. ' + esc(strongest.why) : 'Every rep counts. You showed up and pitched out loud.'}</p></div>
    <div class="vp-card"><h3>Focus for the next rep</h3><p class="vp-hint" style="font-size:.95rem">${nextFocus ? esc(nextFocus.label) + '. ' + esc(nextFocus.why) : 'Raise the difficulty and see if the structure holds under pressure.'}${a.longest > 90 ? ' Also: your longest turn ran ' + a.longest + ' words. Try to keep each turn under about 60.' : ''}</p></div>
  </div>
  <details class="vp-full"><summary>Full transcript</summary><div class="vp-transcript">${transcriptHtml()}</div></details>
  <p class="vp-hint" style="margin-top:14px">Debrief is generated locally from the transcript using simple heuristics. It is a prompt for reflection, not an assessment.</p>
  <div class="vp-actions"><button class="vp-btn" type="button" data-vp-action="retry">Try again</button>${s.random ? `<button class="vp-btn secondary" type="button" data-vp-action="new">🎲 New scenario</button>` : ''}${state.difficulty !== 'tough' ? `<button class="vp-btn secondary" type="button" data-vp-action="harder">Try a tougher buyer</button>` : ''}<button class="vp-btn secondary" type="button" data-vp-action="close">${state.onClose ? 'Continue to re-assess →' : 'Back to scenarios'}</button></div>`;
}

function sendChat(e) {
  e.preventDefault();
  const input = $('#vp-chat-input');
  const text = input?.value.trim();
  if (!text || !state.conversation) return;
  state.messages.push({ who: 'you', text });
  state.waiting = true;
  syncLiveState();
  state.conversation.sendUserMessage(text);
  input.value = '';
  renderTranscript();
}

// Re-render the live screen without losing the chat draft or focus target.
function rerenderLive() {
  const draft = $('#vp-chat-input')?.value || '';
  $('#vp-content').innerHTML = renderLive(state.scenario);
  renderTranscript();
  const input = $('#vp-chat-input');
  if (input) input.value = draft;
}

async function onDialogClick(e) {
  const tabBtn = e.target.closest('[data-vp-tab]');
  if (tabBtn) { state.tab = tabBtn.dataset.vpTab; state.panel = true; rerenderLive(); return; }
  const diff = e.target.closest('[data-vp-difficulty]');
  if (diff) { state.difficulty = diff.dataset.vpDifficulty; render(); return; }
  const action = e.target.closest('[data-vp-action]')?.dataset.vpAction;
  if (!action) return;
  if (action === 'start') startCall();
  else if (action === 'end') { await endCall(); state.stage = 'debrief'; render(); }
  else if (action === 'mute') { state.muted = !state.muted; state.conversation?.setMicMuted(state.muted); rerenderLive(); }
  else if (action === 'captions') { state.captions = state.captions === false; rerenderLive(); }
  else if (action === 'panel') { state.panel = state.panel === false; rerenderLive(); }
  else if (action === 'reroll') { state.scenario = generateScenario(); state.error = null; render(); }
  else if (action === 'retry') { open(state.key, returnFocus, state.scenario, { channel: state.text ? 'text' : 'voice' }); }
  else if (action === 'new') { open(state.key, returnFocus, null, { channel: state.text ? 'text' : 'voice' }); }
  else if (action === 'harder') { state.difficulty = state.difficulty === 'friendly' ? 'realistic' : 'tough'; open(state.key, returnFocus, state.scenario, { channel: state.text ? 'text' : 'voice' }); }
  else if (action === 'close') closeDialog();
}

async function getSessionTarget() {
  const cfg = resolveConfig();
  if (cfg.signedUrlEndpoint) {
    const res = await fetch(cfg.signedUrlEndpoint);
    if (!res.ok) throw new Error(`Could not get a signed URL (${res.status}). Is the voice server running?`);
    const { signed_url } = await res.json();
    return { signedUrl: signed_url };
  }
  if (!cfg.agentId) throw new Error('Live practice is not available on this site right now.');
  return { agentId: cfg.agentId };
}

async function startCall() {
  if (state.scenario.random) state.scenario = buildRandomScenario(readBrief());
  const s = state.scenario;
  if (!state.text) state.voice = pickVoice(s.persona.gender || 'female', state.difficulty);
  state.error = null;
  let target;
  try {
    target = await getSessionTarget();
    if (!state.text) await navigator.mediaDevices.getUserMedia({ audio: true }).then(st => st.getTracks().forEach(t => t.stop()));
  } catch (err) {
    state.error = err?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings and try again.' : (err?.message || String(err));
    render();
    return;
  }

  state.stage = 'live';
  state.status = 'connecting';
  state.messages = [];
  render();

  try {
    if (!Conversation) ({ Conversation } = await import(SDK_URL));
    const conversation = await Conversation.startSession({
      ...target,
      textOnly: state.text,
      overrides: {
        agent: {
          prompt: { prompt: `${s.prompt}\n\nDifficulty: ${DIFFICULTY[state.difficulty].rule}\n${PERSONA_RULES}${state.text ? '\n- This conversation happens in a text chat, not on the phone.' : ''}` },
          firstMessage: s.firstMessage,
        },
        ...(state.text ? { conversation: { textOnly: true } } : { tts: { voiceId: state.voice.id } }),
      },
      onConnect: () => {
        state.status = 'connected';
        state.startedAt = Date.now();
        state.modeSince = Date.now();
        startTicker();
        syncLiveState();
      },
      onDisconnect: (details = {}) => {
        if (state.stage !== 'live') return;
        finishTiming();
        state.status = 'disconnected';
        const said = state.messages.some(m => m.who === 'you');
        const why = details.closeReason || details.message || '';
        // Dropped before the learner spoke: show the reason on the setup screen instead of an empty debrief.
        if (!said && details.reason !== 'user' && (why || details.reason === 'error')) {
          state.stage = 'setup';
          state.error = /override/i.test(why)
            ? `ElevenLabs rejected the call: "${why}" Open your agent in ElevenAgents → Security → Overrides, turn on "First message" and "System prompt", save, then try again.`
            : `The call was closed by ElevenLabs${why ? `: "${why}"` : ''}${details.closeCode ? ` (code ${details.closeCode})` : ''}.`;
        } else {
          state.stage = 'debrief';
        }
        render();
      },
      onModeChange: ({ mode }) => {
        if (state.mode === 'listening' && state.modeSince) state.listeningMs += Date.now() - state.modeSince;
        state.mode = mode;
        state.modeSince = Date.now();
        syncLiveState();
      },
      onMessage: (m) => {
        const role = m.role || m.source;
        const text = (m.message || '').trim();
        if (!text || (state.text && role === 'user')) return; // typed messages are added on send
        if (role !== 'user') { state.waiting = false; syncLiveState(); }
        state.messages.push({ who: role === 'user' ? 'you' : 'buyer', text });
        renderTranscript();
      },
      onError: (message) => {
        console.error('[REPS voice]', message);
        state.error = typeof message === 'string' ? message : 'The voice connection ran into a problem.';
      },
    });
    state.conversation = conversation;
    if (state.muted) conversation.setMicMuted(true);
  } catch (err) {
    console.error('[REPS voice]', err);
    stopTicker();
    state.stage = 'setup';
    state.status = 'disconnected';
    state.error = `Could not start the call: ${err?.message || err}. Check the agent ID, and that prompt and first-message overrides are enabled in the agent's Security settings.`;
    render();
  }
}

function finishTiming() {
  if (state.mode === 'listening' && state.modeSince) state.listeningMs += Date.now() - state.modeSince;
  state.modeSince = null;
  state.endedAt = Date.now();
  stopTicker();
}

async function endCall() {
  if (!state) return;
  const conv = state.conversation;
  state.conversation = null;
  if (state.stage === 'live') finishTiming();
  stopTicker();
  if (conv) { try { await conv.endSession(); } catch { /* already closed */ } }
}

function startTicker() {
  stopTicker();
  state.timer = setInterval(() => {
    const el = $('#vp-timer');
    if (el && state.startedAt) el.textContent = fmt(Math.floor((Date.now() - state.startedAt) / 1000));
  }, 500);
  const tick = () => {
    const stage = $('#vp-stage');
    const c = state.conversation;
    if (stage && c && !state.text) {
      let out = 0, inp = 0;
      try { out = c.getOutputVolume(); inp = state.muted ? 0 : c.getInputVolume(); } catch { /* not ready */ }
      // Smooth the meters so they breathe instead of flicker.
      state.lvOut = (state.lvOut || 0) * 0.7 + Math.min(1, out * 2.2) * 0.3;
      state.lvIn = (state.lvIn || 0) * 0.7 + Math.min(1, inp * 2.6) * 0.3;
      stage.style.setProperty('--them', state.lvOut.toFixed(3));
      stage.style.setProperty('--you', state.lvIn.toFixed(3));
      $('#vp-you')?.classList.toggle('talking', state.lvIn > 0.12);
    }
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function stopTicker() {
  if (!state) return;
  clearInterval(state.timer);
  cancelAnimationFrame(state.raf);
  state.timer = state.raf = null;
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-voice-start]');
  if (b) open(b.dataset.voiceStart, b, null, { onClose: null });
});

// Entry point for the REPS practice loop's "Voice demo" mode (step 03 in demo.html).
window.REPSVoice = {
  openScenario: (key, { intention, onClose, trigger, channel = 'voice' } = {}) => open(`lib:${key}`, trigger, null, { intention, onClose, channel }),
};
