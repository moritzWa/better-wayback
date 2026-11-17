const unavailable = 'The archive search service is temporarily unavailable. Please try again.';

export async function requestSearchJob(input, { signal, fetchRequest = fetch } = {}) {
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(65000)]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchRequest('/api/jobs', { method: 'POST', signal: deadline, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    let data;
    try { data = await response.json(); }
    catch {
      deadline.throwIfAborted();
      // Recover from an intermediary's HTML error page once. JSON errors from
      // our own API (including quotas) are intentional and must not be retried.
      if (!attempt && (response.ok || [500, 502, 503, 504].includes(response.status))) continue;
      throw new Error(unavailable);
    }
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : unavailable);
    if (!/^[a-f0-9]{24}$/.test(data?.id) || typeof data?.url !== 'string') throw new Error(unavailable);
    return data;
  }
}
