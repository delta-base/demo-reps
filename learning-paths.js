// REPS — Learning paths: short day-by-day tracks built from existing scenarios.
// Each day reuses the normal scenario buttons ([data-start] / [data-voice-start]), so it follows
// the practice panel (text or voice). Progress is kept in this browser only.
(() => {
  const STORE = 'reps.paths.v1';
  const PITCH_TITLES = {
    elevator: 'Sixty seconds with a busy VP',
    cfo: 'Make the CFO care',
    displacement: '“We already use someone”',
    random: 'Surprise buyer: anything goes',
  };
  const PATHS = [
    { id: 'price', title: 'Price negotiation in 7 days', blurb: 'Protect value when the other side pushes on price.', days: [
      'lib:discount', 'lib:procurement', 'lib:margin', 'cfo', 'lib:objection', 'lib:commitment', 'random'] },
    { id: 'discovery', title: 'Discovery & value in 5 days', blurb: 'Ask better questions and make the gap worth closing.', days: [
      'lib:gap', 'lib:challenger', 'elevator', 'lib:stakeholders', 'displacement'] },
    { id: 'founder', title: 'Founder fundraising in 3 days', blurb: 'Stay curious when investors ask for control.', days: [
      'lib:fundraise', 'lib:control', 'random'] },
  ];

  const esc = s => String(s).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
  const save = v => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* storage blocked */ } };
  let progress = load(); // { [pathId]: [doneDayIndex, ...] }
  let active = null;     // { path, day } the learner started from a path card

  const lib = () => (typeof scenarios === 'object' && scenarios) || {};
  const titleOf = key => key.startsWith('lib:') ? String(lib()[key.slice(4)]?.title || key).replace(/[“”"]/g, '') : PITCH_TITLES[key];
  const kindOf = key => key.startsWith('lib:') ? 'REPS scenario' : key === 'random' ? 'Surprise pitch' : 'Pitch practice';
  const startAttr = key => key.startsWith('lib:') ? `data-start="${key.slice(4)}"` : `data-voice-start="${key}"`;

  function render() {
    const root = document.getElementById('learning-paths');
    if (!root) return;
    root.innerHTML = PATHS.map(p => {
      const done = new Set(progress[p.id] || []);
      const next = p.days.findIndex((_, i) => !done.has(i));
      const pct = Math.round(done.size / p.days.length * 100);
      return `<article class="path-card">
        <div class="path-head"><div><h3>${esc(p.title)}</h3><p>${esc(p.blurb)}</p></div>
          <div class="path-ring" style="--pct:${pct}"><span>${done.size}/${p.days.length}</span></div></div>
        <ol class="path-days">${p.days.map((key, i) => {
          const state = done.has(i) ? 'done' : i === next ? 'next' : '';
          return `<li class="path-day ${state}"><span class="path-num">${done.has(i) ? '✓' : i + 1}</span>
            <span class="path-copy"><small>Day ${i + 1} · ${esc(kindOf(key))}</small><strong>${esc(titleOf(key))}</strong></span>
            <button type="button" class="path-go" ${startAttr(key)} data-path="${p.id}" data-day="${i}">${done.has(i) ? 'Again' : i === next ? 'Start' : 'Open'}</button></li>`;
        }).join('')}</ol>
        ${next === -1 ? '<p class="path-complete">Path complete. Well done. Try it again on Tough.</p>' : ''}
      </article>`;
    }).join('');
  }

  // Remember which path day was opened; the scenario itself is started by the page's own handlers.
  document.addEventListener('click', e => {
    const b = e.target.closest('.path-go');
    if (b) active = { path: b.dataset.path, day: Number(b.dataset.day), key: b.dataset.start ? `lib:${b.dataset.start}` : b.dataset.voiceStart };
  }, true);

  // A finished rep (pitch-voice.js, or the text demo's re-assess step) ticks off the day.
  window.addEventListener('reps:rep-done', e => {
    const key = e.detail?.key;
    if (!active || key !== active.key) return;
    const list = new Set(progress[active.path] || []);
    list.add(active.day);
    progress[active.path] = [...list];
    save(progress);
    active = null;
    render();
  });

  render();
})();
