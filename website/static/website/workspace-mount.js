/* Mount existing data components as real pages before their controllers start. */
(() => {
  const page=document.body.dataset.workspace, target=document.getElementById('workspace-content');
  // Compatibility with markup retained by an already-running no-reload server.
  document.getElementById('results-tab-vegetation')?.remove();
  document.getElementById('results-panel-vegetation')?.remove();
  document.getElementById('nasa-ndvi')?.closest('article')?.remove();
  document.getElementById('nasa-satellite')?.remove();
  function mount(id){const node=document.getElementById(id);node.hidden=false;node.removeAttribute('role');node.removeAttribute('aria-labelledby');target.append(node);return node;}
  if(page==='crops')mount('results-panel-crops');
  if(page==='nasa'){
    document.getElementById('nasa-history-slot').append(mount('results-panel-weather'));
  }
  if(page==='market'){
    const original=document.getElementById('market-dialog'),section=document.createElement('section');
    section.id=original.id;section.className=original.className;section.dataset.marketPage='';
    section.append(...original.childNodes);original.remove();
    section.querySelector('[data-close]').remove();target.append(section);
  }
  document.querySelectorAll('#field-dialog form,#event-dialog form,#events-dialog form').forEach(form=>form.action='/map/');
  document.querySelectorAll('[data-results-target]').forEach(button=>button.addEventListener('click',()=>{
    document.querySelector(button.dataset.resultsTarget)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
  }));
  document.addEventListener('market-request',event=>{
    event.stopImmediatePropagation();const url=new URL('/workspace/market/',location.origin);
    if(event.detail?.ids?.length)url.searchParams.set('products',event.detail.ids.join(','));
    const a=document.querySelector('.sidebar nav a[href="/workspace/market/"]');
    a.href=url.href;a.click();
  },true);
})();
