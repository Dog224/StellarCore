/* Short, interruptible feedback; reduced-motion preferences apply immediately. */
(() => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Map();
  reduced.addEventListener('change', () => { if (reduced.matches) { active.forEach(animation => animation.cancel()); active.clear(); } });
  document.addEventListener('click', event => {
    if (reduced.matches || !Element.prototype.animate) return;
    const target = event.target.closest('button,summary,.auth-guest,.account-button');
    if (!target || target.disabled || target.closest('.leaflet-control')) return;
    active.get(target)?.cancel();
    const animation = target.animate([
      {transform: 'scale(1)'}, {transform: 'scale(.96)', offset: .22},
      {transform: 'scale(1.025)', offset: .65}, {transform: 'scale(1)'}
    ], {duration: 260, easing: 'ease-out'});
    active.set(target, animation);
    const cleanup = () => { if (active.get(target) === animation) active.delete(target); };
    animation.onfinish = cleanup; animation.oncancel = cleanup;
  });
})();
