(() => {
  const DATA = window.INSTITUTIONS.map((d, i) => ({ id: i, ...d }));
  const DIRS = window.DIRECTIONS;
  const MOSCOW = [55.7558, 37.6173];
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;
  const PEEK = 140;  // видимая высота свёрнутой шторки на телефоне (как --peek в CSS)
  const HALF = 0.5;  // доля шторки, видимая в положении «наполовину»
  // Свёрнутая панель восстанавливается до первого центрирования карты
  const COLLAPSE_KEY = 'vuzmap.panelCollapsed';
  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') document.body.classList.add('panel-collapsed'); } catch {}
  const SELECT_ZOOM = 13; // масштаб при выборе заведения (часть города); с него же кластеры распадаются на метки
  const TYPES = ['vuz', 'college', 'unicollege'];
  const TYPE_LABELS = {
    vuz: 'Высшее образование',
    college: 'Колледж / техникум (СПО)',
    unicollege: 'Колледж при вузе (СПО)',
  };
  const TYPE_SHORT = { vuz: 'Вуз', college: 'Колледж', unicollege: 'Колледж при вузе' };
  const OWN_LABEL = { gos: 'Государственный', private: 'Негосударственный' };
  const LEVELS = { bak: 'Бакалавриат', spec: 'Специалитет', mag: 'Магистратура', spo: 'СПО (колледж)' };
  // Уровни: с ucheba.ru; если нет — колледжи считаем СПО, а вуз подходит под любой уровень высшего (неизвестно точно)
  const levelsOf = d => d.levels && d.levels.length ? d.levels : d.type === 'vuz' ? ['bak', 'spec', 'mag'] : ['spo'];

  // Поиск по профессии: слово → направления
  const PROF = [
    [/^(программист|разработ|айти|it|тестировщ|кибер|информат|сисадмин)/, ['it']],
    [/^(врач|медсестр|медбрат|фельдшер|фармацевт|стоматолог|хирург|медик|лаборант)/, ['med']],
    [/^(юрист|адвокат|нотариус|полицейск|следовател|прокурор|судь)/, ['law']],
    [/^(учител|педагог|воспитател|преподават)/, ['ped']],
    [/^(дизайнер|художник|актер|актёр|музыкант|режиссер|режиссёр|танцор|хореограф|фотограф|певец|вокал)/, ['art']],
    [/^(инженер|механик|электрик|сварщ|технолог|робототех|энергетик)/, ['eng']],
    [/^(строител|архитект|прораб)/, ['build']],
    [/^(экономист|бухгалтер|менеджер|финанс|маркетолог|аналитик|банкир|логист)/, ['econ']],
    [/^(психолог|журналист|переводчик|лингвист|историк|филолог|социолог)/, ['hum']],
    [/^(водител|пилот|машинист|авиа|моряк|штурман|автомехан)/, ['transport']],
    [/^(агроном|ветеринар|эколог|зоотехник|кинолог|флорист)/, ['agro']],
    [/^(тренер|спортсмен|фитнес)/, ['sport']],
    [/^(химик|физик|биолог|математик|геолог|астроном)/, ['nat']],
  ];
  const profDirs = w => (PROF.find(([re]) => re.test(w)) || [])[1];

  // Избранное и дом хранятся в браузере
  const store = {
    get(k, def) { try { const v = localStorage.getItem('vuzmap.' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('vuzmap.' + k, JSON.stringify(v)); } catch {} },
  };
  const keyOf = d => `${d.name}|${d.city}`;
  const favs = new Set(store.get('favs', []));
  let home = store.get('home', null); // { lat, lng, label }

  // ───── Состояние фильтров ─────
  const state = {
    q: '',
    type: new Set(TYPES),
    region: new Set(['msk', 'mo']),
    own: new Set(['gos', 'private']),
    dirs: new Set(),
    levels: new Set(),
    budget: false,
    dorm: false,
    fav: false,
    radius: 0,
    colorBy: 'type',
    sort: 'name',
    selected: null,
  };

  // ───── Карта ─────
  const map = L.map('map', {
    zoomControl: false,
    minZoom: 7,
    maxBounds: [[53.6, 34.0], [57.6, 41.3]],
    maxBoundsViscosity: 0.8,
  });
  // Стартовый вид сразу со сдвигом под панель и полосу фильтров
  focusOn(MOSCOW, isMobile() ? 9 : 10);

  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'base-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const css = getComputedStyle(document.documentElement);
  const COLORS = Object.fromEntries(TYPES.map(t => [t, css.getPropertyValue('--' + t).trim()]));

  // ───── Зоны: Москва и Московская область ─────
  // Отдельная панель под метками, чтобы границы не перехватывали клики
  map.createPane('zones').style.zIndex = 350;
  const ACCENT = css.getPropertyValue('--accent').trim();
  const SHADE = `rgb(${css.getPropertyValue('--shade').trim()})`;
  const toLatLng = ring => ring.map(([lng, lat]) => [lat, lng]);

  // Затемнение всего, что за пределами области: прямоугольник мира с «дыркой» по контуру области
  L.polygon([
    [[85, -180], [85, 180], [-85, 180], [-85, -180]],
    toLatLng(REGIONS.mo.coordinates[0]),
  ], { pane: 'zones', interactive: false, stroke: false, fillColor: SHADE, fillOpacity: 0.12 }).addTo(map);

  const ZONE_STYLE = {
    msk: { color: ACCENT, weight: 2, opacity: 0.6, fillColor: ACCENT, fillOpacity: 0.04 },
    mo:  { color: ACCENT, weight: 2, opacity: 0.5, dashArray: '2 7', lineCap: 'round', fillOpacity: 0 },
  };
  const zones = Object.fromEntries(['mo', 'msk'].map(r => [r,
    L.geoJSON(REGIONS[r], { pane: 'zones', interactive: false, style: ZONE_STYLE[r] }).addTo(map),
  ]));

  // Выключенный в фильтре регион показываем бледнее
  function updateZones() {
    for (const [r, layer] of Object.entries(zones)) {
      const on = state.region.has(r);
      layer.setStyle({
        opacity: on ? ZONE_STYLE[r].opacity : 0.15,
        fillOpacity: on ? ZONE_STYLE[r].fillOpacity : 0,
      });
    }
  }

  // Значки типов: вуз — шапочка, колледж — книга, колледж при вузе — здание с колоннами
  const ICONS = {
    vuz: '<path fill="currentColor" d="M12 4 2 9l10 5 8-4v5h2V9L12 4zm-6 7.5v3.3L12 18l6-3.2v-3.3L12 14.5l-6-3z"/>',
    college: '<path fill="currentColor" d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zm2 2v10.2c.3-.1.6-.2 1-.2h7V7a1 1 0 0 0-1-1H7zm12 2h1v12h-1V8z"/>',
    unicollege: '<path fill="currentColor" d="M12 3 2 8v2h20V8L12 3zM4 12v6H3v2h18v-2h-1v-6h-2v6h-3v-6h-2v6h-2v-6H9v6H6v-6H4z"/>',
  };
  const svg = (type, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}">${ICONS[type]}</svg>`;

  // Цвет точек: по типу или по признаку (есть / нет / нет данных)
  const ATTR_COLORS = { yes: '#188038', no: '#d93025', unk: '#9aa0a6' };
  const COLOR_MODES = {
    type: { cats: TYPES, label: { vuz: 'Вузы', college: 'Колледжи', unicollege: 'При вузах' }, of: d => d.type },
    dorm: { cats: ['yes', 'no', 'unk'], label: { yes: 'Есть общежитие', no: 'Нет', unk: 'Нет данных' }, of: d => d.dorm === undefined ? 'unk' : d.dorm ? 'yes' : 'no' },
    budget: { cats: ['yes', 'no', 'unk'], label: { yes: 'Есть бюджет', no: 'Нет', unk: 'Нет данных' }, of: d => d.budget === undefined ? 'unk' : d.budget ? 'yes' : 'no' },
  };
  const catColor = c => COLORS[c] || ATTR_COLORS[c];

  function pinIcon(inst, active = false) {
    const cat = COLOR_MODES[state.colorBy].of(inst);
    return L.divIcon({
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      tooltipAnchor: [0, -17],
      html: `<div class="mk ${inst.type}${active ? ' active' : ''}" style="--c:${catColor(cat)}"><div class="mk-core">${svg(inst.type, 15)}</div></div>`,
    });
  }

  // Кластер: белый круг с числом, кольцо показывает долю каждой категории
  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 50,
    disableClusteringAtZoom: SELECT_ZOOM,
    spiderfyOnMaxZoom: true,
    iconCreateFunction(cl) {
      const ms = cl.getAllChildMarkers();
      const n = ms.length;
      const mode = COLOR_MODES[state.colorBy];
      let from = 0;
      const stops = mode.cats.map(t => {
        const to = from + (ms.filter(m => mode.of(m.inst) === t).length / n) * 100;
        const s = `${catColor(t)} ${from}% ${to}%`;
        from = to;
        return s;
      }).join(', ');
      const size = n < 10 ? 36 : n < 50 ? 44 : 52;
      return L.divIcon({
        className: 'cluster-wrap',
        iconSize: [size, size],
        html: `<div class="cl" style="background:conic-gradient(${stops})"><div class="cl-in">${n}</div></div>`,
      });
    },
  });
  map.addLayer(cluster);

  const markers = DATA.map(inst => {
    const m = L.marker([inst.lat, inst.lng], { icon: pinIcon(inst), title: inst.short });
    m.inst = inst;
    // Карточка-подсказка при наведении (HTML собирается в момент показа, фото грузится лениво)
    m.bindTooltip(() => hoverHtml(inst), { direction: 'top', className: 'hover-card', offset: [0, -4], opacity: 1 });
    m.on('click', () => select(inst.id));
    return m;
  });

  function hoverHtml(d) {
    const yn = v => v === undefined ? '<span class="nodata">нет данных</span>' : v ? '<span class="yes">есть</span>' : '<span class="no">нет</span>';
    // Без фото блок не выводим вовсе; если картинка не загрузилась — убираем его
    const pic = d.photo
      ? `<div class="hc-photo"><img src="${d.photo}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>`
      : '';
    return `${pic}
      <div class="hc-body">
        <div class="hc-title">${esc(d.short)}</div>
        <div class="hc-meta ${d.type}"><span class="t">${TYPE_SHORT[d.type]}</span>${d.founded ? ` · с ${d.founded} г.` : ''}</div>
        <div class="hc-addr">${esc(d.city)}${d.approx ? '' : ', ' + esc(d.address)}</div>
        ${d.metro ? `<div class="hc-addr">${metroText(d)}</div>` : ''}
        <div class="hc-facts"><span>Бюджет: ${yn(d.budget)}</span><span>Общежитие: ${yn(d.dorm)}</span></div>
        ${d.price || d.ege || d.attest ? `<div class="hc-facts">${d.ege ? `<span>ЕГЭ ≈ ${d.ege}</span>` : d.attest ? `<span>Аттестат ≈ ${d.attest}</span>` : ''}${d.price ? `<span>${money(d.price)}/год</span>` : ''}</div>` : ''}
        <div class="hc-hint">Нажмите, чтобы открыть</div>
      </div>`;
  }

  // ───── Мелкие форматтеры ─────
  const money = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' млн ₽' : Math.round(n / 1000) + ' тыс. ₽';
  const km = m => m < 1000 ? Math.round(m / 10) * 10 + ' м' : (m / 1000).toFixed(1).replace('.', ',') + ' км';
  const metroText = d => `${d.metroType === 'm' ? 'м.' : 'ст.'} ${esc(d.metro)} · ${km(d.metroDist)}`;
  const R = 6371000, rad = x => x * Math.PI / 180;
  const distM = (a, b, c, d) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2));
  const homeDist = d => home ? distM(home.lat, home.lng, d.lat, d.lng) : null;

  // ───── Фильтрация ─────
  const norm = s => s.toLowerCase().replace(/ё/g, 'е');
  // Текст для поиска: название, адрес, станция, программы и направления
  for (const d of DATA) d.hay = norm(`${d.name} ${d.short} ${d.city} ${d.address} ${d.metro || ''} ${(d.progs || []).join(' ')} ${d.dirs.map(k => DIRS[k]).join(' ')}`);

  function matches(inst, skip) {
    if (skip !== 'type' && !state.type.has(inst.type)) return false;
    if (!state.region.has(inst.region)) return false;
    // Неизвестная форма собственности фильтру «Гос./Частные» не мешает
    if (inst.own && !state.own.has(inst.own)) return false;
    if (state.budget && !inst.budget) return false;
    if (state.dorm && !inst.dorm) return false;
    if (state.fav && !favs.has(keyOf(inst))) return false;
    if (state.dirs.size && !inst.dirs.some(d => state.dirs.has(d))) return false;
    if (state.levels.size && !levelsOf(inst).some(l => state.levels.has(l))) return false;
    if (state.radius && home && homeDist(inst) > state.radius * 1000) return false;
    if (calcIds && !calcIds.has(inst.id)) return false; // калькулятор: только вузы, куда проходишь
    if (state.q) {
      // Каждое слово — в тексте заведения или профессия из его направлений («программист», «медсестра»)
      const ok = norm(state.q).split(/\s+/).every(w => inst.hay.includes(w) || (profDirs(w) || []).some(k => inst.dirs.includes(k)));
      if (!ok) return false;
    }
    return true;
  }

  function sortList(list) {
    const byName = (a, b) => a.short.localeCompare(b.short, 'ru');
    if (state.sort === 'founded') return list.sort((a, b) => (a.founded || 9999) - (b.founded || 9999) || byName(a, b));
    if (state.sort === 'price') return list.sort((a, b) => (a.price || Infinity) - (b.price || Infinity) || byName(a, b));
    if (state.sort === 'ege') return list.sort((a, b) => (b.ege || 0) - (a.ege || 0) || byName(a, b));
    if (state.sort === 'home' && home) return list.sort((a, b) => homeDist(a) - homeDist(b));
    return list.sort(byName);
  }

  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };

  function render() {
    const visible = DATA.filter(d => matches(d));
    const ids = new Set(visible.map(d => d.id));
    updateZones();

    cluster.clearLayers();
    cluster.addLayers(markers.filter(m => ids.has(m.inst.id)));

    // Счётчики на чипах типов
    for (const t of TYPES) {
      document.querySelector(`[data-cnt="${t}"]`).textContent = DATA.filter(d => d.type === t && matches(d, 'type')).length;
    }

    $('#results-count').textContent = `${visible.length} ${plural(visible.length, 'заведение', 'заведения', 'заведений')} на карте`;
    updateSideBits();
    saveHash();

    const ul = $('#results');
    if (!visible.length) {
      ul.innerHTML = `<li class="empty">${state.fav && !favs.size ? 'В избранном пока пусто.<br>Нажмите ☆ у заведения, чтобы добавить.' : 'Ничего не найдено.<br>Попробуйте ослабить фильтры.'}</li>`;
      return;
    }
    ul.innerHTML = sortList(visible).map(d => {
      const hd = homeDist(d);
      return `
      <li class="result ${d.type}" data-id="${d.id}">
        <div class="r-body">
          <div class="r-title">${esc(d.short)}</div>
          <div class="r-meta"><span class="t">${TYPE_SHORT[d.type]}</span>${d.own ? ' · ' + (d.own === 'gos' ? 'государственный' : 'частный') : ''}${d.founded ? ' · с ' + d.founded + ' г.' : ''}</div>
          <div class="r-sub">${esc(d.city)}${d.approx ? '' : ', ' + esc(d.address)}${hd !== null ? ` · <b class="dist">${km(hd)} от дома</b>` : ''}</div>
          ${d.metro ? `<div class="r-sub">${metroText(d)}</div>` : ''}
          <div class="r-tags">${d.ege ? `<span class="tag strong">ЕГЭ ≈ ${d.ege}</span>` : ''}${d.price ? `<span class="tag strong">${money(d.price)}/год</span>` : ''}${d.dirs.slice(0, 2).map(k => `<span class="tag">${DIRS[k]}</span>`).join('')}${d.dirs.length > 2 ? `<span class="tag">+${d.dirs.length - 2}</span>` : ''}</div>
        </div>
        <div class="r-side">
          <div class="r-icon ${d.type}">${svg(d.type, 22)}</div>
          ${starBtn(d)}
        </div>
      </li>`;
    }).join('');
  }

  // ───── Избранное ─────
  const starBtn = d => {
    const on = favs.has(keyOf(d));
    return `<button class="star${on ? ' on' : ''}" data-fav="${d.id}" aria-label="${on ? 'Убрать из избранного' : 'В избранное'}" title="${on ? 'Убрать из избранного' : 'В избранное'}">${on ? '★' : '☆'}</button>`;
  };
  function toggleFav(id) {
    const k = keyOf(DATA[id]);
    favs.has(k) ? favs.delete(k) : favs.add(k);
    store.set('favs', [...favs]);
    render();
    if (state.selected === id) {
      const b = $('#card [data-fav]');
      if (b) b.outerHTML = favAct(DATA[id]);
    }
  }
  const favAct = d => {
    const on = favs.has(keyOf(d));
    return `<button class="act${on ? ' fav-on' : ''}" data-fav="${d.id}"><span class="ic star-ic">${on ? '★' : '☆'}</span>${on ? 'В избранном' : 'В избранное'}</button>`;
  };

  // Счётчики, кнопка сравнения, легенда, «ещё фильтры»
  function updateSideBits() {
    const favIn = DATA.filter(d => favs.has(keyOf(d)));
    $('#fav-count').textContent = favIn.length || '';
    $('#compare-btn').hidden = favIn.length < 2;
    $('#compare-count').textContent = favIn.length;
    const more = state.levels.size + (state.radius && home ? 1 : 0);
    $('#more-count').textContent = more || '';
    $('#sort-home').hidden = !home;
    const mode = COLOR_MODES[state.colorBy];
    $('#legend-items').innerHTML = mode.cats.map(c => `<span><i class="dot" style="--c:${catColor(c)}"></i>${mode.label[c]}</span>`).join('');
  }

  // ───── Калькулятор ЕГЭ ─────
  const SUBJECTS = { rus: 'Русский язык', math: 'Математика (профиль)', inf: 'Информатика', phys: 'Физика', chem: 'Химия', bio: 'Биология',
    soc: 'Обществознание', hist: 'История', lang: 'Иностранный язык', lit: 'Литература', geo: 'География' };
  const PROGS = window.PROGRAMS || {};
  let calcIds = null; // Set id вузов для подсветки на карте или null
  let scores = store.get('scores', {});

  // Средний балл на предмет для программы: обязательные + лучший из «по выбору»; null — предметов не хватает
  function myAvg(p) {
    if (!p.req.every(s => scores[s] > 0)) return null;
    let used = p.req.map(s => scores[s]);
    if (p.opt.length) {
      const best = Math.max(...p.opt.map(s => scores[s] || 0));
      if (!best) return null;
      used = used.concat(best);
    }
    return used.reduce((a, b) => a + b, 0) / used.length;
  }

  function renderCalcForm() {
    $('#calc-form').innerHTML = Object.entries(SUBJECTS).map(([k, v]) => `
      <label class="calc-row${scores[k] ? ' filled' : ''}"><span>${v}</span>
        <input type="number" inputmode="numeric" min="0" max="100" placeholder="—" data-subj="${k}" value="${scores[k] || ''}"></label>`).join('');
  }

  function runCalc() {
    const lvl = $('#calc-level').value;
    const have = Object.values(scores).filter(v => v > 0).length;
    const box = $('#calc-results');
    if (have < 2) {
      box.innerHTML = '<div class="calc-empty">Введи баллы хотя бы по двум предметам — обычно это русский и профильный.</div>';
      setCalcIds(null);
      return;
    }
    const pass = [], near = [], paid = [];
    for (const inst of DATA) {
      if (inst.type !== 'vuz' || !inst.ucheba || !PROGS[inst.ucheba]) continue;
      for (const p of PROGS[inst.ucheba]) {
        if (p.lv === 'mag' || (lvl && p.lv !== lvl)) continue;
        const a = myAvg(p);
        if (a === null) continue;
        const row = { inst, p, a };
        if (p.b > 0 && p.s && a >= p.s) pass.push(row);
        else if (p.b > 0 && p.s && a >= p.s - 5) near.push(row);
        else paid.push(row);
      }
    }
    // Сначала самые «сильные» программы, куда хватает баллов
    pass.sort((x, y) => y.p.s - x.p.s);
    near.sort((x, y) => (y.a - y.p.s) - (x.a - x.p.s));
    const uniqVuz = rows => new Set(rows.map(r => r.inst.id)).size;
    const item = ({ inst, p, a }, kind) => `
      <li class="calc-item ${kind}" data-id="${inst.id}">
        <div class="ci-vuz">${esc(inst.short)}${p.ex ? ' <span class="ci-ex" title="Есть дополнительные или творческие экзамены">+ доп. экзамен</span>' : ''}</div>
        <div class="ci-prog">${esc(p.n)} <span class="ci-lv">· ${p.lv === 'spec' ? 'специалитет' : 'бакалавриат'}</span></div>
        <div class="ci-nums">${p.s ? `проходной ≈ <b>${p.s.toFixed(1).replace('.', ',')}</b> на предмет · у тебя <b>${a.toFixed(1).replace('.', ',')}</b>` : `у тебя ${a.toFixed(1).replace('.', ',')} на предмет · проходного балла нет данных`}${p.b ? ` · бюджет ${p.b} мест` : ' · только платно'}</div>
      </li>`;
    const section = (title, rows, kind, open) => rows.length ? `
      <details class="calc-sec ${kind}"${open ? ' open' : ''}><summary>${title} <span class="cnt">${rows.length} ${plural(rows.length, 'программа', 'программы', 'программ')} в ${uniqVuz(rows)} ${plural(uniqVuz(rows), 'вузе', 'вузах', 'вузах')}</span></summary>
        <ul>${rows.slice(0, 150).map(r => item(r, kind)).join('')}</ul></details>` : '';
    box.innerHTML = (pass.length + near.length + paid.length
      ? section('✅ Проходишь на бюджет', pass, 'pass', true) + section('🟡 Почти проходишь (не хватает до 5 баллов на предмет)', near, 'near', !pass.length) + section('💳 Можно платно или нет данных о проходном', paid, 'paid', false)
      : '<div class="calc-empty">Под твой набор предметов программ не нашлось. Добавь ещё предмет.</div>');
    setCalcIds($('#calc-map').checked ? new Set([...pass, ...near].map(r => r.inst.id)) : null);
  }
  function setCalcIds(ids) { calcIds = ids && ids.size ? ids : null; render(); }

  function openCalc() {
    closeCard();
    renderCalcForm();
    $('#view-list').hidden = true;
    $('#view-calc').hidden = false;
    if (isMobile()) setSheet('open');
    if (isCollapsed()) setCollapsed(false);
    runCalc();
  }
  function closeCalc() {
    calcReturn = false;
    $('#view-calc').hidden = true;
    $('#view-list').hidden = false;
    setCalcIds(null);
  }
  $('#calc-open').addEventListener('click', openCalc);
  $('#calc-back').addEventListener('click', closeCalc);
  let calcTimer;
  $('#calc-form').addEventListener('input', e => {
    const k = e.target.dataset.subj;
    if (!k) return;
    const v = Math.max(0, Math.min(100, Math.round(+e.target.value || 0)));
    if (v) scores[k] = v; else delete scores[k];
    e.target.closest('.calc-row').classList.toggle('filled', !!v);
    store.set('scores', scores);
    clearTimeout(calcTimer);
    calcTimer = setTimeout(runCalc, 250);
  });
  $('#calc-map').addEventListener('change', runCalc);
  $('#calc-level').addEventListener('change', runCalc);
  $('#calc-results').addEventListener('click', e => {
    const li = e.target.closest('.calc-item');
    if (!li) return;
    select(+li.dataset.id);
  });
  let calcReturn = false; // «Назад» из карточки, открытой из калькулятора, возвращает в калькулятор

  // ───── Сравнение ─────
  function openCompare() {
    const list = DATA.filter(d => favs.has(keyOf(d)));
    const yn = v => v === undefined ? '<span class="nodata">—</span>' : v ? '<span class="yes">есть</span>' : '<span class="no">нет</span>';
    const rows = [
      ['Тип', d => TYPE_SHORT[d.type]],
      ['Где', d => `${esc(d.city)}${d.approx ? '' : ', ' + esc(d.address)}`],
      ['Станция', d => d.metro ? metroText(d) : '—'],
      ['От дома', d => home ? km(homeDist(d)) : '—'],
      ['Бюджет', d => yn(d.budget)],
      ['Общежитие', d => yn(d.dorm)],
      ['Средний балл', d => d.ege ? `ЕГЭ ≈ ${d.ege}` : d.attest ? `аттестат ≈ ${d.attest}` : '—'],
      ['Стоимость', d => d.price ? money(d.price) + '/год' : '—'],
      ['Уровни', d => d.levels ? d.levels.map(l => LEVELS[l]).join(', ') : d.type === 'vuz' ? 'высшее' : LEVELS.spo],
      ['Основан', d => d.founded || '—'],
      ['Собственность', d => OWN_LABEL[d.own] || '—'],
      ['Сайт', d => d.site ? `<a href="${esc(d.site)}" target="_blank" rel="noopener">открыть</a>` : '—'],
    ];
    $('#compare-table').innerHTML = `<table><thead><tr><th></th>${list.map(d => `<th><button class="link-btn" data-goto="${d.id}">${esc(d.short)}</button> <button class="star on" data-fav="${d.id}" title="Убрать из избранного">★</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map(([k, f]) => `<tr><th>${k}</th>${list.map(d => `<td>${f(d)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (!$('#compare').open) $('#compare').showModal();
  }

  // ───── Видимая часть карты ─────
  let activeMarker = null;

  // Сколько пикселей карты закрыто интерфейсом с каждой стороны
  function covered() {
    const panel = $('#panel');
    if (!isMobile()) return { left: 0, right: isCollapsed() ? 0 : panel.offsetWidth, top: 0, bottom: 0 };
    const h = panel.offsetHeight;
    const bottom = panel.classList.contains('open') ? h : panel.classList.contains('half') ? h * HALF : PEEK;
    return { left: 0, right: 0, top: 0, bottom };
  }

  // Центрирует точку в видимой (не закрытой интерфейсом) части карты
  function focusOn(latlng, zoom) {
    const c = covered();
    const p = map.project(latlng, zoom).add([(c.right - c.left) / 2, (c.bottom - c.top) / 2]);
    map.setView(map.unproject(p, zoom), zoom);
  }

  function visiblePadding() {
    const c = covered();
    return { paddingTopLeft: [40 + c.left, 40 + c.top], paddingBottomRight: [40 + c.right, 40 + c.bottom] };
  }

  // ───── Карточка заведения ─────
  const ROW_ICONS = {
    pin: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
    budget: 'M12 3 1 9l11 6 9-4.9V17h2V9L12 3zm-6 9.2v4L12 20l6-3.8v-4L12 15.5l-6-3.3z',
    dorm: 'M7 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9a4 4 0 0 0-4-4z',
    year: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z',
    own: 'M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10z',
    region: 'M20.5 3 15 5.1 9 3 3.4 4.9a.5.5 0 0 0-.4.5V20.5a.5.5 0 0 0 .7.5L9 18.9l6 2.1 5.6-1.9a.5.5 0 0 0 .4-.5V3.5a.5.5 0 0 0-.5-.5zM15 19l-6-2.1V5l6 2.1V19z',
    metro: 'M12 2C7 2 4 3.5 4 7v9.5A3.5 3.5 0 0 0 7.5 20L6 21.5v.5h12v-.5L16.5 20a3.5 3.5 0 0 0 3.5-3.5V7c0-3.5-3-5-8-5zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM11 10H6V7h5v3zm5.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm1.5-7h-5V7h5v3z',
    score: 'M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.5 14l-1.7 7z',
    price: 'M11.8 10.9c-2.3-.6-3-1.2-3-2.1 0-1.1 1-1.9 2.7-1.9 1.8 0 2.4.8 2.5 2.1h2.2c-.1-1.7-1.1-3.3-3.2-3.8V3h-3v2.2c-1.9.4-3.5 1.7-3.5 3.6 0 2.3 1.9 3.4 4.6 4.1 2.5.6 3 1.5 3 2.4 0 .7-.5 1.8-2.7 1.8-2.1 0-2.9-.9-3-2.1H6.3c.1 2.2 1.8 3.5 3.7 3.9V21h3v-2.1c1.9-.4 3.5-1.5 3.5-3.6 0-2.8-2.4-3.8-4.7-4.4z',
    level: 'M5 13.2v4L12 21l7-3.8v-4L12 17l-7-3.8zM12 3 1 9l11 6 9-4.9V17h2V9L12 3z',
    link: 'M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z',
  };
  const ic = name => `<svg viewBox="0 0 24 24"><path fill="currentColor" d="${ROW_ICONS[name]}"/></svg>`;
  const ACT = {
    route: 'M21.7 11.3 12.7 2.3a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z',
    site: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.4 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zM8 8H5a8 8 0 0 1 4.3-3.6C8.8 5.5 8.4 6.7 8 8zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.4-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z',
    ucheba: 'M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  };
  const actIc = name => `<span class="ic"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="${ACT[name]}"/></svg></span>`;

  function select(id) {
    const inst = DATA[id];
    const marker = markers[id];
    if (isCollapsed()) setCollapsed(false); // карточку показываем в панели — разворачиваем её
    closeDirs();
    state.selected = id;
    if (isMobile()) setSheet('half');

    if (activeMarker) { activeMarker.setIcon(pinIcon(activeMarker.inst)); activeMarker.setZIndexOffset(0); }
    activeMarker = marker;
    marker.setIcon(pinIcon(inst, true));
    marker.setZIndexOffset(1000);

    // Приближаем до уровня части города; если пользователь уже приблизил сильнее — не отдаляем
    focusOn(marker.getLatLng(), Math.max(map.getZoom(), SELECT_ZOOM));

    const NO_DATA = '<span class="nodata">нет данных</span>';
    const yesNo = v => v === undefined ? NO_DATA : v ? '<span class="yes">есть</span>' : '<span class="no">нет</span>';
    const route = `https://yandex.ru/maps/?rtext=~${inst.lat},${inst.lng}&rtt=mt`;
    const search = `https://yandex.ru/search/?text=${encodeURIComponent(inst.name + ' ' + inst.city)}`;

    // Связь «вуз ↔ его колледж» в обе стороны
    const related = inst.type === 'unicollege'
      ? DATA.filter(d => d.type === 'vuz' && d.short === inst.parent).map(d => ({ d, k: 'Относится к вузу' }))
      : inst.type === 'vuz'
        ? DATA.filter(d => d.parent === inst.short).map(d => ({ d, k: 'Колледж при этом вузе' }))
        : [];

    const notes = [
      inst.approx && 'Точка на карте примерная',
      inst.source === 'osm' && 'Добавлено из OpenStreetMap, характеристики не проверены',
      inst.source === 'ucheba' && 'Общежитие и бюджетные места — по данным ucheba.ru',
      inst.source === 'raoo' && 'Из реестра аккредитации Рособрнадзора',
    ].filter(Boolean).map(n => `<span class="note">${n}</span>`).join('');
    const hd = homeDist(inst);

    // Шапка с фото — только если фото есть; не загрузилось — шапку убираем целиком
    $('#card').innerHTML = `
      ${inst.photo ? `<div class="card-hero ${inst.type} has-photo">
        <img src="${inst.photo}" alt="${esc(inst.short)}" referrerpolicy="no-referrer" onerror="const h=this.parentNode;h.nextElementSibling.classList.add('no-hero');h.remove()">
          ${inst.photoSource
            ? `<a class="photo-credit" href="${inst.photoSource}" target="_blank" rel="noopener">Фото: ${({ ucheba: 'ucheba.ru', mapillary: 'Mapillary', streetview: 'Google Street View' })[inst.photoVia] || 'сайт заведения'}</a>`
            : `<a class="photo-credit" href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent((inst.photoFile || '').replace(/ /g, '_'))}" target="_blank" rel="noopener">Фото: Wikimedia Commons</a>`}
      </div>` : ''}
      <div class="card-body${inst.photo ? '' : ' no-hero'}">
        <h2 class="card-title">${esc(inst.short)}</h2>
        ${inst.name !== inst.short ? `<p class="card-full">${esc(inst.name)}</p>` : ''}
        <div class="card-meta ${inst.type}"><span class="t">${TYPE_LABELS[inst.type]}</span>${inst.founded ? ` · с ${inst.founded} года` : ''}</div>
      </div>
      <div class="card-actions">
        <a class="act primary" href="${route}" target="_blank" rel="noopener">${actIc('route')}Маршрут</a>
        <a class="act" href="${inst.site || search}" target="_blank" rel="noopener">${actIc('site')}${inst.site ? 'Сайт' : 'Найти сайт'}</a>
        ${inst.ucheba ? `<a class="act" href="https://www.ucheba.ru/uz/${inst.ucheba}" target="_blank" rel="noopener">${actIc('ucheba')}Программы</a>` : ''}
        ${favAct(inst)}
      </div>
      <ul class="info">
        <li>${ic('pin')}<div>${esc(inst.city)}, ${esc(inst.address)}${hd !== null ? ` <b class="dist">· ${km(hd)} от дома</b>` : ''}${notes}</div></li>
        ${inst.metro ? `<li>${ic('metro')}<div>${metroText(inst)}<span class="note">${inst.metroType === 'm' ? 'Ближайшая станция метро или МЦК' : 'Ближайшая ж/д станция (МЦК, МЦД, электрички)'}, по прямой</span></div></li>` : ''}
        <li>${ic('budget')}<div><span class="k">Бюджетные места:</span> ${yesNo(inst.budget)}</div></li>
        <li>${ic('dorm')}<div><span class="k">Общежитие:</span> ${yesNo(inst.dorm)}</div></li>
        ${inst.ege || inst.attest ? `<li>${ic('score')}<div><span class="k">Средний балл поступивших:</span> ${inst.ege ? `ЕГЭ ≈ ${inst.ege} за предмет` : `аттестат ≈ ${inst.attest}`}<span class="note">По данным ucheba.ru, в среднем по программам</span></div></li>` : ''}
        ${inst.price ? `<li>${ic('price')}<div><span class="k">Платное обучение:</span> в среднем ${money(inst.price)} в год</div></li>` : ''}
        <li>${ic('level')}<div><span class="k">Уровни:</span> ${inst.levels ? inst.levels.map(l => LEVELS[l]).join(', ') : inst.type === 'vuz' ? '<span class="nodata">высшее, подробнее нет данных</span>' : LEVELS.spo}</div></li>
        ${inst.founded ? `<li>${ic('year')}<div><span class="k">Основан в</span> ${inst.founded} году</div></li>` : ''}
        <li>${ic('own')}<div>${OWN_LABEL[inst.own] || '<span class="nodata">Форма собственности: нет данных</span>'}</div></li>
        <li>${ic('region')}<div>${inst.region === 'msk' ? 'Москва' : 'Московская область'}</div></li>
        ${related.map(({ d, k }) => `
          <li style="padding:0"><button class="row" data-goto="${d.id}" style="display:flex;gap:20px;padding:10px 24px;align-items:flex-start">
            ${ic('link')}<div><span class="k">${k}:</span> <b>${esc(d.short)}</b></div></button></li>`).join('')}
      </ul>
      <div class="card-dirs">
        <h3>Направления подготовки</h3>
        <div class="tags">${inst.dirs.map(k => `<span class="tag">${DIRS[k]}</span>`).join('')}</div>
        ${inst.progs ? `<h3 class="progs-h">Программы <span class="hint">по ucheba.ru</span></h3>
        <ul class="progs">${inst.progs.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      </div>`;

    if (!$('#view-calc').hidden) calcReturn = true; // открыли из калькулятора — «Назад» вернёт туда
    $('#view-calc').hidden = true;
    $('#view-list').hidden = true;
    $('#view-card').hidden = false;
    $('#view-card').scrollTop = 0;
    saveHash();
  }

  // Положение шторки на телефоне: '' (свёрнута) | 'half' | 'open'
  function setSheet(pos) {
    const p = $('#panel');
    p.classList.toggle('half', pos === 'half');
    p.classList.toggle('open', pos === 'open');
    document.body.classList.toggle('sheet-up', !!pos);
  }

  function closeCard() {
    state.selected = null;
    if (activeMarker) {
      activeMarker.setIcon(pinIcon(activeMarker.inst));
      activeMarker.setZIndexOffset(0);
      activeMarker = null;
    }
    $('#view-card').hidden = true;
    if (calcReturn) { calcReturn = false; $('#view-calc').hidden = false; }
    else $('#view-list').hidden = false;
    saveHash();
  }

  // ───── Состояние в адресе: ссылкой можно поделиться ─────
  // #q=…&t=vuz,college&r=msk&o=gos&d=it,med&l=bak&b=1&h=1&f=1&s=price&c=dorm&id=<ключ>
  let hashReady = false;
  function saveHash() {
    if (!hashReady) return;
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.type.size < TYPES.length) p.set('t', [...state.type].join(','));
    if (state.region.size < 2) p.set('r', [...state.region].join(','));
    if (state.own.size < 2) p.set('o', [...state.own].join(','));
    if (state.dirs.size) p.set('d', [...state.dirs].join(','));
    if (state.levels.size) p.set('l', [...state.levels].join(','));
    if (state.budget) p.set('b', '1');
    if (state.dorm) p.set('h', '1');
    if (state.fav) p.set('f', '1');
    if (state.radius) p.set('km', state.radius);
    if (state.sort !== 'name') p.set('s', state.sort);
    if (state.colorBy !== 'type') p.set('c', state.colorBy);
    if (state.selected !== null) p.set('id', keyOf(DATA[state.selected]));
    const h = p.toString();
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  }
  function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const set = (k, all) => { const v = p.get(k); return v ? new Set(v.split(',').filter(x => all.includes(x))) : null; };
    state.q = p.get('q') || '';
    state.type = set('t', TYPES) || state.type;
    state.region = set('r', ['msk', 'mo']) || state.region;
    state.own = set('o', ['gos', 'private']) || state.own;
    state.dirs = set('d', Object.keys(DIRS)) || state.dirs;
    state.levels = set('l', Object.keys(LEVELS)) || state.levels;
    state.budget = p.get('b') === '1';
    state.dorm = p.get('h') === '1';
    state.fav = p.get('f') === '1';
    state.radius = +p.get('km') || 0;
    state.sort = p.get('s') || 'name';
    state.colorBy = COLOR_MODES[p.get('c')] ? p.get('c') : 'type';
    // Отражаем состояние в элементах
    $('#search').value = state.q;
    $('#search-clear').hidden = !state.q;
    document.querySelectorAll('.chip-group[data-filter]').forEach(g => g.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', state[g.dataset.filter].has(c.dataset.value))));
    document.querySelectorAll('#dirs .dir-opt').forEach(o => o.classList.toggle('active', state.dirs.has(o.dataset.value)));
    document.querySelectorAll('#levels .chip').forEach(c => c.classList.toggle('active', state.levels.has(c.dataset.value)));
    $('#f-budget').checked = state.budget;
    $('#f-dorm').checked = state.dorm;
    $('#f-fav').checked = state.fav;
    $('#sort').value = state.sort;
    $('#radius').value = String(state.radius);
    $('#color-by').value = state.colorBy;
    if (state.levels.size || state.radius) $('#more').open = true;
    const id = p.get('id');
    return id ? DATA.find(d => keyOf(d) === id) : null;
  }

  // ───── Обработчики UI ─────
  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Выпадающий список направлений
  const CHECK = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="m9 16.2-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg>';
  $('#dirs').innerHTML = Object.entries(DIRS)
    .map(([k, label]) => `<button class="dir-opt" data-value="${k}"><span class="box">${CHECK}</span>${label}</button>`).join('');

  function updateDirsBtn() {
    const n = state.dirs.size;
    $('#dirs-count').textContent = n ? n : '';
    $('#dirs-btn').classList.toggle('has-value', n > 0);
  }
  function openDirs() {
    const btn = $('#dirs-btn'), pop = $('#dirs-pop');
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    const fitTop = t => Math.max(12, Math.min(t, innerHeight - pop.offsetHeight - 12));
    if (isMobile()) {
      // Под кнопкой; если снизу не помещается — над ней
      const below = r.bottom + 8;
      pop.style.top = (below + pop.offsetHeight <= innerHeight - 12 ? below : fitTop(r.top - 8 - pop.offsetHeight)) + 'px';
    } else {
      // На ПК — слева от панели, поверх карты, на уровне кнопки
      pop.style.left = Math.max(12, $('#panel').getBoundingClientRect().left - pop.offsetWidth - 12) + 'px';
      pop.style.top = fitTop(r.top - 12) + 'px';
    }
  }
  function closeDirs() {
    $('#dirs-pop').hidden = true;
    $('#dirs-btn').setAttribute('aria-expanded', 'false');
  }
  $('#dirs-btn').addEventListener('click', e => {
    e.stopPropagation();
    $('#dirs-pop').hidden ? openDirs() : closeDirs();
  });
  $('#dirs').addEventListener('click', e => {
    const opt = e.target.closest('.dir-opt');
    if (!opt) return;
    const v = opt.dataset.value;
    state.dirs.has(v) ? state.dirs.delete(v) : state.dirs.add(v);
    opt.classList.toggle('active', state.dirs.has(v));
    updateDirsBtn();
    render();
  });
  document.addEventListener('click', e => {
    if (!$('#dirs-pop').hidden && !e.target.closest('#dirs-pop, #dirs-btn')) closeDirs();
  });
  $('#view-list').addEventListener('scroll', closeDirs);

  // Чипы-переключатели (тип / регион / собственность): нельзя выключить все
  document.querySelectorAll('.chip-group[data-filter]').forEach(group => {
    group.addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const set = state[group.dataset.filter]; // берём актуальный набор: «Сбросить» создаёт новые
      const v = chip.dataset.value;
      if (set.has(v)) {
        if (set.size === 1) return;
        set.delete(v);
      } else {
        set.add(v);
      }
      chip.classList.toggle('active', set.has(v));
      render();
    });
  });

  $('#f-budget').addEventListener('change', e => { state.budget = e.target.checked; render(); });
  $('#f-dorm').addEventListener('change', e => { state.dorm = e.target.checked; render(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });

  let searchTimer;
  $('#search').addEventListener('input', e => {
    state.q = e.target.value.trim();
    $('#search-clear').hidden = !state.q;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!$('#view-calc').hidden) closeCalc();
      closeCard();
      render();
      if (isMobile() && state.q) setSheet('open');
    }, 150);
  });
  $('#search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('#results .result');
      if (first) select(+first.dataset.id);
    }
  });
  $('#search-clear').addEventListener('click', e => {
    e.preventDefault();
    $('#search').value = '';
    state.q = '';
    $('#search-clear').hidden = true;
    render();
  });

  $('#reset').addEventListener('click', () => {
    state.type = new Set(TYPES);
    state.region = new Set(['msk', 'mo']);
    state.own = new Set(['gos', 'private']);
    state.dirs.clear();
    state.levels.clear();
    state.budget = state.dorm = state.fav = false;
    state.radius = 0;
    state.q = '';
    $('#search').value = '';
    $('#search-clear').hidden = true;
    $('#f-budget').checked = $('#f-dorm').checked = $('#f-fav').checked = false;
    $('#radius').value = '0';
    document.querySelectorAll('.chip-group[data-filter] .chip').forEach(c => c.classList.add('active'));
    document.querySelectorAll('#dirs .dir-opt, #levels .chip').forEach(c => c.classList.remove('active'));
    updateDirsBtn();
    render();
  });

  $('#results').addEventListener('click', e => {
    const star = e.target.closest('[data-fav]');
    if (star) { e.stopPropagation(); toggleFav(+star.dataset.fav); return; }
    const li = e.target.closest('.result');
    if (li) select(+li.dataset.id);
  });
  $('#back').addEventListener('click', closeCard);
  $('#card').addEventListener('click', e => {
    const fav = e.target.closest('[data-fav]');
    if (fav) { toggleFav(+fav.dataset.fav); return; }
    const btn = e.target.closest('[data-goto]');
    if (btn) select(+btn.dataset.goto);
  });

  // Избранное и сравнение
  $('#f-fav').addEventListener('change', e => { state.fav = e.target.checked; render(); });
  $('#compare-btn').addEventListener('click', openCompare);
  $('#compare-close').addEventListener('click', () => $('#compare').close());
  $('#compare').addEventListener('click', e => {
    if (e.target === $('#compare')) return $('#compare').close(); // клик по затемнению
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      toggleFav(+fav.dataset.fav);
      DATA.filter(d => favs.has(keyOf(d))).length >= 2 ? openCompare() : $('#compare').close();
      return;
    }
    const go = e.target.closest('[data-goto]');
    if (go) { $('#compare').close(); select(+go.dataset.goto); }
  });

  // Уровни обучения
  $('#levels').innerHTML = Object.entries(LEVELS).map(([k, v]) => `<button class="chip" data-value="${k}">${v}</button>`).join('');
  $('#levels').addEventListener('click', e => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const v = c.dataset.value;
    state.levels.has(v) ? state.levels.delete(v) : state.levels.add(v);
    c.classList.toggle('active', state.levels.has(v));
    render();
  });

  // От дома: адрес → координаты (Nominatim, OpenStreetMap)
  let homeMarker = null;
  function showHome() {
    $('#home-state').hidden = !home;
    $('#home-form').hidden = !!home;
    $('#home-label').textContent = home ? '🏠 ' + home.label : '';
    if (homeMarker) { map.removeLayer(homeMarker); homeMarker = null; }
    if (home) homeMarker = L.marker([home.lat, home.lng], { icon: L.divIcon({ className: '', html: '<div class="home-pin">🏠</div>', iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 2000, title: 'Дом' }).addTo(map);
  }
  $('#home-form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('#home-input').value.trim();
    if (!q) return;
    const btn = $('#home-go');
    btn.disabled = true; btn.textContent = 'Ищу…';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ru&accept-language=ru&viewbox=35.1,57.0,40.3,54.2&bounded=1&q=' + encodeURIComponent(q);
      const [r] = await (await fetch(url)).json();
      if (!r) { alert('Адрес не найден. Попробуйте написать иначе, например «Москва, Тверская улица, 1».'); return; }
      home = { lat: +r.lat, lng: +r.lon, label: r.display_name.split(',').slice(0, 3).join(',') };
      store.set('home', home);
      showHome();
      state.sort = 'home'; $('#sort').value = 'home';
      render();
      focusOn([home.lat, home.lng], 12);
    } catch { alert('Не удалось найти адрес — проверьте интернет.'); }
    finally { btn.disabled = false; btn.textContent = 'Найти'; }
  });
  $('#home-clear').addEventListener('click', () => {
    home = null; store.set('home', null);
    state.radius = 0; $('#radius').value = '0';
    if (state.sort === 'home') { state.sort = 'name'; $('#sort').value = 'name'; }
    showHome(); render();
  });
  $('#radius').addEventListener('change', e => { state.radius = +e.target.value; render(); });

  // Цвет точек
  $('#color-by').addEventListener('change', e => {
    state.colorBy = e.target.value;
    markers.forEach(m => m.setIcon(pinIcon(m.inst, m === activeMarker)));
    cluster.refreshClusters();
    render();
  });

  // Тёмная тема: сохранённая или системная
  const sysDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = () => (document.documentElement.dataset.theme || (sysDark() ? 'dark' : 'light')) === 'dark';
  $('#theme').addEventListener('click', () => {
    const t = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('vuzmap.theme', t); } catch {}
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!$('#dirs-pop').hidden) closeDirs();
    else if (state.selected !== null) closeCard();
  });

  // Кнопки карты
  $('#zoom-in').addEventListener('click', () => map.zoomIn());
  $('#zoom-out').addEventListener('click', () => map.zoomOut());
  $('#fit-all').addEventListener('click', () => {
    const b = cluster.getBounds();
    if (b.isValid()) map.fitBounds(b, visiblePadding());
  });

  let meMarker = null;
  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Браузер не поддерживает геолокацию');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        if (meMarker) meMarker.setLatLng(ll);
        else meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [16, 16] }) }).addTo(map);
        focusOn(ll, 13);
      },
      () => alert('Не удалось определить местоположение'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // Сворачивание панели на ПК; состояние запоминается в браузере (восстанавливается в начале файла)
  function isCollapsed() { return !isMobile() && document.body.classList.contains('panel-collapsed'); }
  function setCollapsed(on) {
    document.body.classList.toggle('panel-collapsed', on);
    const tab = $('#panel-collapse');
    tab.title = tab.ariaLabel = on ? 'Развернуть панель' : 'Свернуть панель';
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch {}
  }
  $('#panel-collapse').addEventListener('click', () => setCollapsed(!isCollapsed()));

  // Мобильная шторка
  $('#panel-grip').addEventListener('click', () => {
    const p = $('#panel');
    setSheet(p.classList.contains('open') || p.classList.contains('half') ? '' : 'open');
  });
  $('#search').addEventListener('focus', () => { if (isMobile()) setSheet('open'); });
  map.on('click', () => { closeDirs(); if (isMobile()) setSheet(''); });

  const fromLink = loadHash();
  showHome();
  updateDirsBtn();
  hashReady = true;
  if (state.colorBy !== 'type') markers.forEach(m => m.setIcon(pinIcon(m.inst)));
  render();
  if (fromLink) select(fromLink.id);
})();
