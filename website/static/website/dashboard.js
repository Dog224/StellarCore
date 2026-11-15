document.querySelectorAll('[data-dialog]').forEach(button => button.addEventListener('click', () => {
  const target = document.getElementById(button.dataset.dialog);
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  target.showModal();
}));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
document.querySelectorAll('dialog[data-open]').forEach(dialog => dialog.showModal());
document.querySelectorAll('[data-date]').forEach(button => button.addEventListener('click', () => {
  document.querySelector('#event-dialog input[name=date]').value = button.dataset.date;
  document.getElementById('event-dialog').showModal();
}));
document.querySelectorAll('.sidebar nav a').forEach(link => link.addEventListener('click', () => {
  document.querySelectorAll('.sidebar nav a').forEach(item => item.classList.toggle('active', item === link));
}));
