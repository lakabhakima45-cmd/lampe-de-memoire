// La lampe de mémoire · en-tête, pied de page, langues et outils communs à toutes les pages
(() => {
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const LANGS = Object.keys(I18N);
  let lang = LANGS.includes(get('lampe_lang')) ? get('lampe_lang') : 'fr';
  window.T = k => (I18N[lang][k] ?? I18N.fr[k] ?? k);
  window.LANG = () => lang;
  window.esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const NAV = [['/', 'nav_home'], ['/mur', 'nav_wall'], ['/histoire', 'nav_history'], ['/fonctionnement', 'nav_how'], ['/projet', 'nav_project'], ['/historien/', 'nav_hist']];
  const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
  const head = document.createElement('div');
  head.innerHTML = `<a class="skip" href="#contenu" data-i18n="skip"></a>
  <div class="topbar" role="region" data-i18n-aria="a11y_bar"><div class="in">
    <a href="/accessibilite" class="a11ylink"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4" r="2" fill="currentColor"/><path d="M4 8h16M12 8v6m0 0-4 7m4-7 4 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg><span data-i18n="a11y_bar"></span></a>
    <label class="langsel"><span class="sr" data-i18n="lang"></span><select id="langSel">${LANGS.map(l => `<option value="${l}" lang="${l}">${I18N[l]._name}</option>`).join('')}</select></label>
    <button class="btn sm" data-z="-1" data-i18n-aria="zoom_minus">A−</button><button class="btn sm" data-z="1" data-i18n-aria="zoom_plus">A+</button><button class="btn sm" id="hcBtn" aria-pressed="false" data-i18n="hc"></button>
  </div></div>
  <header class="site"><div class="in"><a class="brand" href="/"><span data-i18n="brand_a"></span> <i data-i18n="brand_b"></i></a>
  <button class="menu" aria-expanded="false" aria-controls="nav" data-i18n="menu"></button>
  <nav id="nav">${NAV.map(([h, k]) => `<a href="${h}" data-i18n="${k}"${(here === h || (h !== '/' && here.startsWith(h.replace(/\/$/, '')))) ? ' aria-current="page"' : ''}${h === '/mur' ? ' class="cta"' : ''}></a>`).join('')}</nav></div></header>`;
  document.body.prepend(...head.childNodes);
  const menu = document.querySelector('.menu'), nav = document.getElementById('nav');
  menu.onclick = () => { const o = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', o); };

  const foot = document.createElement('footer');
  foot.className = 'foot';
  foot.innerHTML = `<div class="wrap"><p class="note"><span data-i18n="brand_a"></span> <span data-i18n="brand_b"></span> · <span data-i18n="foot_about"></span></p>
  <p class="note"><a href="/accessibilite" data-i18n="foot_a11y"></a> · <a href="/mentions" data-i18n="foot_legal"></a></p></div>`;
  document.body.append(foot);

  // apply the language to every marked element of the page
  window.applyI18n = (root = document) => {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', T(el.dataset.i18nAria)));
    root.querySelectorAll('[data-i18n-ph]').forEach(el => el.setAttribute('placeholder', T(el.dataset.i18nPh)));
    root.querySelectorAll('[data-i18n-list]').forEach(el => { el.innerHTML = T(el.dataset.i18nList).map(x => `<li>${esc(x)}</li>`).join(''); });
  };
  function setLang(l) {
    lang = l; set('lampe_lang', l);
    document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('langSel').value = l;
    applyI18n();
    document.title = (document.querySelector('h1')?.textContent || '') + ' · ' + T('brand_a') + ' ' + T('brand_b');
    window.dispatchEvent(new CustomEvent('langchange', { detail: l }));
  }
  document.getElementById('langSel').onchange = e => setLang(e.target.value);

  // display preferences, remembered in this browser only
  let z = +(get('lampe_zoom') || 1);
  const applyZoom = () => { document.querySelector('main').style.zoom = z; };
  document.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { z = Math.max(1, Math.min(2, z + (+b.dataset.z) * 0.25)); set('lampe_zoom', z); applyZoom(); });
  const hc = document.getElementById('hcBtn');
  const applyHc = on => { document.body.classList.toggle('hc', on); hc.setAttribute('aria-pressed', on); };
  hc.onclick = () => { const on = !document.body.classList.contains('hc'); set('lampe_hc', on ? '1' : ''); applyHc(on); };
  applyZoom(); applyHc(get('lampe_hc') === '1');

  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t);
  let tt;
  window.toast = s => { t.textContent = s; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3500); };
  window.api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Erreur ' + r.status), { status: r.status, code: data.code });
    return data;
  };
  new MutationObserver(() => { for (const c of document.querySelectorAll('.stack td:not([data-l])')) { let i = 0, p = c; while ((p = p.previousElementSibling)) i += p.colSpan; c.dataset.l = c.closest('table').rows[0].cells[i]?.textContent || ''; } }).observe(document.body, { childList: true, subtree: true });
  setLang(lang);
})();
