// Catnap / Mustăți — translations (Romanian + English)
(function (root) {
  'use strict';
  const STRINGS = {
    ro: {
      docTitle: 'Mustăți — puzzle cu pisici',
      title: 'Mustăți',
      tagline: 'Câte o pisică pe fiecare rând, coloană și pernă colorată. Și nicio pisică nu stă lipită de alta.',
      modesLabel: 'Alege puzzle-ul',
      sizesLabel: 'Mărimea tablei',
      daily: 'Puzzle-ul zilei',
      newGame: 'Puzzle nou',
      boardLabel: 'Tabla de joc',
      winTitle: 'Miau! Ai rezolvat.',
      share: 'Copiază rezultatul',
      next: 'Încă unul',
      howto: 'Apasă o dată pentru <b>×</b>, de două ori pentru o pisică. Trage cu degetul ca să pui mai multe <b>×</b> deodată.',
      time: 'Timp',
      cats: 'Pisici',
      undo: 'Anulează',
      hint: 'Indiciu',
      reset: 'De la capăt',
      autoX: 'Pune × automat lângă pisici',
      showErr: 'Arată greșelile',
      rules: 'Regulile',
      rule1: 'Fiecare rând are exact o pisică.',
      rule2: 'Fiecare coloană are exact o pisică.',
      rule3: 'Fiecare pernă colorată are exact o pisică.',
      rule4: 'Pisicile nu se ating, nici măcar pe diagonală.',
      rulesNote: 'Fiecare puzzle are o singură soluție, deci nu trebuie să ghicești.',
      records: 'Recordurile tale',
      recBoard: 'Tablă',
      recBest: 'Cel mai bun timp',
      recSolved: 'Rezolvate',
      footer: 'Făcut cu Claude · cod sursă liber (MIT)',
      langSwitch: 'EN',
      langSwitchLabel: 'Switch to English',
      dailyName: 'Puzzle-ul zilei · {date} · {n}×{n}',
      puzzleName: 'Puzzle #{n}-{seed}',
      cell: 'Rândul {r}, coloana {c}',
      cellCat: ', pisică',
      cellMark: ', marcat',
      hintWrongCat: 'Pisica care clipește nu stă unde trebuie.',
      hintWrongMark: 'Ai pus × pe un loc unde de fapt doarme o pisică.',
      hintPlaced: 'Am pus o pisică pentru tine.',
      winIn: '{n}×{n} în {t}',
      winNoHints: ', fără indicii.',
      winHints1: ' cu 1 indiciu.',
      winHintsN: ' cu {k} indicii.',
      winRecord: ' Record nou!',
      shareDaily: 'Mustăți · puzzle-ul zilei {date}',
      shareOne: 'Mustăți · #{n}-{seed}',
      copied: 'Copiat! Lipește-l unde vrei.',
      copyFail: 'Nu am putut copia automat.'
    },
    en: {
      docTitle: 'Catnap — a cat logic puzzle',
      title: 'Catnap',
      tagline: 'One cat in every row, column and colored cushion. And no two cats may touch.',
      modesLabel: 'Choose a puzzle',
      sizesLabel: 'Board size',
      daily: 'Daily puzzle',
      newGame: 'New puzzle',
      boardLabel: 'Game board',
      winTitle: 'Meow! Solved.',
      share: 'Copy result',
      next: 'Another one',
      howto: 'Tap once for <b>×</b>, twice for a cat. Drag to place several <b>×</b> at once.',
      time: 'Time',
      cats: 'Cats',
      undo: 'Undo',
      hint: 'Hint',
      reset: 'Restart',
      autoX: 'Auto-place × around cats',
      showErr: 'Show mistakes',
      rules: 'Rules',
      rule1: 'Every row has exactly one cat.',
      rule2: 'Every column has exactly one cat.',
      rule3: 'Every colored cushion has exactly one cat.',
      rule4: 'Cats never touch, not even diagonally.',
      rulesNote: 'Every puzzle has exactly one solution, so you never need to guess.',
      records: 'Your records',
      recBoard: 'Board',
      recBest: 'Best time',
      recSolved: 'Solved',
      footer: 'Made with Claude · open source (MIT)',
      langSwitch: 'RO',
      langSwitchLabel: 'Schimbă în română',
      dailyName: 'Daily puzzle · {date} · {n}×{n}',
      puzzleName: 'Puzzle #{n}-{seed}',
      cell: 'Row {r}, column {c}',
      cellCat: ', cat',
      cellMark: ', marked',
      hintWrongCat: 'The blinking cat is in the wrong spot.',
      hintWrongMark: 'You put an × where a cat is actually napping.',
      hintPlaced: 'I placed a cat for you.',
      winIn: '{n}×{n} in {t}',
      winNoHints: ', no hints.',
      winHints1: ' with 1 hint.',
      winHintsN: ' with {k} hints.',
      winRecord: ' New record!',
      shareDaily: 'Catnap · daily puzzle {date}',
      shareOne: 'Catnap · #{n}-{seed}',
      copied: 'Copied! Paste it anywhere.',
      copyFail: 'Could not copy automatically.'
    }
  };

  let lang = 'en';
  function detect(saved) {
    if (saved && STRINGS[saved]) return saved;
    const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
    return /^ro\b/i.test(nav) ? 'ro' : 'en';
  }
  function t(key, vars) {
    let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }
  function apply(doc) {
    doc.documentElement.lang = lang;
    doc.title = t('docTitle');
    doc.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    doc.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
    doc.querySelectorAll('[data-i18n-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  }
  root.MustatiI18n = {
    STRINGS, t, apply, detect,
    get lang() { return lang; },
    set lang(v) { if (STRINGS[v]) lang = v; }
  };
})(window);
