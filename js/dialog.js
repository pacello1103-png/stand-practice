// A small in-app question (the iPad app's web view does not show the browser's own dialogs).
// ask('Discard these pages?', { ok: 'Discard', danger: true }) -> Promise<boolean>
export function ask(text, { ok = 'OK', cancel = 'Cancel', danger = false, sub = '' } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div'); back.className = 'ask-back';
    const box = document.createElement('div'); box.className = 'ask'; box.setAttribute('role', 'alertdialog');
    const h = document.createElement('p'); h.className = 'ask-title'; h.textContent = text; box.append(h);
    if (sub) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = sub; box.append(p); }
    const row = document.createElement('div'); row.className = 'ask-row';
    const no = document.createElement('button'); no.className = 'btn'; no.textContent = cancel;
    const yes = document.createElement('button'); yes.className = 'btn ' + (danger ? 'danger-fill' : 'primary'); yes.textContent = ok;
    row.append(no, yes); box.append(row); back.append(box); document.body.append(back);
    const done = (v) => { back.remove(); resolve(v); };
    no.addEventListener('click', () => done(false)); yes.addEventListener('click', () => done(true));
    back.addEventListener('click', (e) => { if (e.target === back) done(false); });
    setTimeout(() => yes.focus(), 30);
  });
}
