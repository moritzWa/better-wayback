let scriptPromise;
function loadTurnstile() {
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    const timer = setTimeout(() => { script.remove(); scriptPromise = null; reject(new Error('Verification took too long. Please try again.')); }, 15000);
    script.onload = () => { clearTimeout(timer); resolve(window.turnstile); };
    script.onerror = () => { clearTimeout(timer); script.remove(); scriptPromise = null; reject(new Error('Could not load verification. Please try again.')); };
    document.head.append(script);
  });
  return scriptPromise;
}

for (const region of document.querySelectorAll('[data-support]')) {
  const trigger = region.querySelector('[data-support-open]');
  const panel = region.querySelector('[data-support-panel]');
  const status = region.querySelector('[role="status"]');
  const widget = region.querySelector('[data-support-widget]');
  const cancel = region.querySelector('[data-support-cancel]');
  let controller, widgetId, generation = 0;
  function clearWidget() {
    if (widgetId !== undefined) { window.turnstile?.remove(widgetId); widgetId = undefined; }
    widget.replaceChildren();
  }
  cancel.addEventListener('click', () => {
    generation++;
    controller?.abort();
    clearWidget();
    status.replaceChildren();
    panel.hidden = true;
    trigger.disabled = false;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  });
  trigger.addEventListener('click', async () => {
    const current = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    clearWidget();
    panel.hidden = false;
    trigger.disabled = true;
    trigger.setAttribute('aria-expanded', 'true');
    status.textContent = 'Loading verification…';
    const fail = message => {
      if (current !== generation) return;
      clearWidget();
      status.textContent = message;
      trigger.disabled = false;
    };
    try {
      const config = await fetch('/api/support/config', { signal, cache: 'no-store' });
      const data = await config.json();
      if (!config.ok) throw new Error(data.error || 'Support email is unavailable.');
      const turnstile = await loadTurnstile();
      if (current !== generation) return;
      status.textContent = 'Complete the check to reveal the support email.';
      widgetId = turnstile.render(widget, {
        sitekey: data.siteKey, action: 'support-reveal', theme: 'light', size: 'flexible',
        callback: async token => {
          if (current !== generation) return;
          status.textContent = 'Revealing email…';
          try {
            const response = await fetch('/api/support/reveal', { method: 'POST', signal, cache: 'no-store',
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
            const result = await response.json();
            if (current !== generation) return;
            if (!response.ok) throw new Error(result.error || 'Could not reveal the email. Please try again.');
            if (!/^mailto:[^\s@?&#%:]+@[^\s@?&#%:]+\.[^\s@?&#%:]+$/.test(result.mailto)) throw new Error('Invalid support response.');
            clearWidget();
            const link = document.createElement('a');
            link.href = result.mailto;
            link.textContent = result.mailto.slice(7);
            status.replaceChildren('Email to support this project: ', link);
            link.focus();
          } catch (error) { if (!signal.aborted) fail(error.message); }
        },
        'error-callback': () => fail('Verification failed. Click Support this project to retry.'),
        'expired-callback': () => fail('Verification expired. Click Support this project to retry.'),
        'timeout-callback': () => fail('Verification timed out. Click Support this project to retry.'),
      });
    } catch (error) { if (!signal.aborted) fail(error.message); }
  });
}
