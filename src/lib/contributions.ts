export interface ContributionPayload {
  terraceId: number;
  terraceName: string;
  contributorName: string;
  beerBrand: string;
  price: number;
  sunFrom?: string;
  sunTo?: string;
  comment?: string;
}

export async function sendContribution(payload: ContributionPayload) {
  const res = await fetch('/api/contribute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'No se pudo guardar la aportacion');
  return data as { ok: true; savedAt: string; reviewUrl?: string };
}
