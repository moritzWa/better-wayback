export const examples = [
  { id: 'stripe', label: 'Stripe', host: 'stripe.com' },
  { id: 'openai', label: 'OpenAI', host: 'openai.com' },
  { id: 'anthropic', label: 'Anthropic', host: 'anthropic.com' },
  { id: 'nvidia', label: 'Nvidia', host: 'nvidia.com' },
  { id: 'amazon', label: 'Amazon', host: 'amazon.com' },
];

export function exampleForSite(input) {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.port || url.username || url.password) return null;
    return examples.find(example => example.host === url.hostname.replace(/^www\./, '')) || null;
  } catch { return null; }
}
