/* Apply before styles load to avoid a bright flash; photos/imagery stay intact. */
(() => {
  const key='mekongrise-theme';
  const system=matchMedia('(prefers-color-scheme: dark)');
  let explicit;
  try { explicit=localStorage.getItem(key); } catch {}
  if(!['light','dark'].includes(explicit))explicit=null;
  const updateButtons=()=>document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
    const action=document.documentElement.dataset.theme==='dark'?'Switch to light mode':'Switch to dark mode';
    button.setAttribute('aria-label',action);button.title=action;
    window.TerraGrowI18n?.refresh(button);
  });
  const apply=theme=>{
    document.documentElement.dataset.theme=theme;
    document.documentElement.style.colorScheme=theme;
    updateButtons();
    document.dispatchEvent(new CustomEvent('mekongrise-theme-changed',{detail:{theme}}));
  };
  apply(explicit||(system.matches?'dark':'light'));
  document.addEventListener('DOMContentLoaded',()=>{
    updateButtons();
    document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{
      explicit=document.documentElement.dataset.theme==='dark'?'light':'dark';
      try { localStorage.setItem(key,explicit); } catch {}
      apply(explicit);
    }));
  },{once:true});
  system.addEventListener('change',()=>{if(!explicit)apply(system.matches?'dark':'light');});
  addEventListener('storage',event=>{if(event.key===key){explicit=['light','dark'].includes(event.newValue)?event.newValue:null;apply(explicit||(system.matches?'dark':'light'));}});
})();
