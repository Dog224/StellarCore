(() => {
  const introduction = document.querySelector('.auth-benefits');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (introduction && !reducedMotion.matches && 'IntersectionObserver' in window) {
    introduction.classList.add('auth-intro-pending');
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      introduction.classList.remove('auth-intro-pending');
      introduction.classList.add('auth-intro-visible');
      observer.disconnect();
    }, {threshold: .15});
    observer.observe(introduction);
    reducedMotion.addEventListener('change', event => {
      if (event.matches) {
        introduction.classList.remove('auth-intro-pending', 'auth-intro-visible');
        observer.disconnect();
      }
    });
  }
  document.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    button.querySelector('span').textContent = show ? 'Hide' : 'Show';
    window.TerraGrowI18n?.refresh(button);
  }));
  const form = document.getElementById('auth-form');
  form.addEventListener('submit', () => {
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    submit.querySelector('span').textContent = form.dataset.mode === 'signup' ? 'Creating account...' : 'Signing in...';
    window.TerraGrowI18n?.refresh(submit);
  });
  document.querySelector('[data-auth-errors]')?.focus();
})();
