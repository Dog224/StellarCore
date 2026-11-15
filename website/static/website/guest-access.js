/* One guest page visit per deliberate entry. This is navigation UX, not account
   authentication: the public guest workspace and its data endpoints stay public. */
(() => {
  const script = document.currentScript;
  const key = 'mekongrise-guest-entry';
  const login = script.dataset.login;
  const home = script.dataset.home;
  const grant = () => {
    try { sessionStorage.setItem(key, String(Date.now())); return true; }
    catch { return false; }
  };
  if (script.dataset.mode === 'entry') {
    document.querySelectorAll('[data-guest-entry]').forEach(link => link.addEventListener('click', () => {
      if (!grant()) {
        const url = new URL(link.href, location.href);
        url.searchParams.set('guest_entry', '1');
        link.href = url.href;
      }
    }));
    return;
  }
  let allowed = false;
  try {
    const entered = Number(sessionStorage.getItem(key));
    sessionStorage.removeItem(key);
    allowed = entered > 0 && Date.now() - entered >= 0 && Date.now() - entered < 60000;
  } catch { /* The explicit-link fallback below also works without storage. */ }
  const url = new URL(location.href);
  if (url.searchParams.get('guest_entry') === '1') {
    allowed = true;
    url.searchParams.delete('guest_entry');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  if (!allowed) {
    document.documentElement.style.visibility = 'hidden';
    location.replace(login);
    return;
  }
  // A restored old guest document must not bypass the new-visit login screen.
  addEventListener('pageshow', event => { if (event.persisted) location.replace(login); });
  addEventListener('DOMContentLoaded', () => {
    // Deliberate navigation between workspace pages belongs to this guest visit.
    document.querySelectorAll('a[href]').forEach(link => link.addEventListener('click', () => {
      const target = new URL(link.href, location.href);
      if (target.origin === location.origin && (target.pathname === home || target.pathname.startsWith('/workspace/')) && target.pathname !== location.pathname && !grant()) {
        target.searchParams.set('guest_entry', '1'); link.href = target.href;
      }
    }));
    document.querySelectorAll('.sidebar nav a,.home-brand').forEach(link=>link.addEventListener('click',event=>{
      const target=new URL(link.href,location.href);
      if(target.origin===location.origin&&target.pathname===location.pathname&&target.search===location.search&&!target.hash){event.preventDefault();window.scrollTo({top:0,behavior:'instant'});}
    }));
    // Intentional calendar navigation and form submissions belong to this visit.
    // A refresh has neither of these explicit actions, so no entry is carried.
    document.querySelectorAll('#calendar a[href]').forEach(link => link.addEventListener('click', () => {
      const target = new URL(link.href, location.href);
      if (target.origin === location.origin && target.pathname === home && !grant()) {
        target.searchParams.set('guest_entry', '1'); link.href = target.href;
      }
    }));
    document.querySelectorAll('form[method="post"]').forEach(form => form.addEventListener('submit', () => {
      const target = new URL(form.action || location.href, location.href);
      if (target.origin === location.origin && (target.pathname === home || target.pathname === '/')) {
        if (!grant()) {
          target.searchParams.set('guest_entry', '1'); form.action = target.href;
        }
      }
    }));
  }, {once:true});
})();
