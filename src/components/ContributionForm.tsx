import { FormEvent, useState } from 'react';
import type { Terraza } from '../lib/types';
import { sendContribution } from '../lib/contributions';

export function ContributionForm({ terraza }: { terraza: Terraza }) {
  const [contributorName, setContributorName] = useState('');
  const [beerBrand, setBeerBrand] = useState('');
  const [price, setPrice] = useState('');
  const [sunFrom, setSunFrom] = useState('');
  const [sunTo, setSunTo] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const numericPrice = Number(price.replace(',', '.'));
    if (!contributorName.trim() || !beerBrand.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) {
      setStatus('error');
      setMessage('Nombre, marca y precio son obligatorios. El sol no firma anonimos.');
      return;
    }
    setStatus('saving');
    setMessage(null);
    try {
      const saved = await sendContribution({
        terraceId: terraza.id,
        terraceName: terraza.name,
        contributorName: contributorName.trim(),
        beerBrand: beerBrand.trim(),
        price: Math.round(numericPrice * 100) / 100,
        sunFrom: sunFrom || undefined,
        sunTo: sunTo || undefined,
        comment: comment.trim() || undefined
      });
      setStatus('saved');
      setMessage(saved.reviewUrl ? 'Enviado a revisión. David recibirá aviso para aprobarlo.' : 'Enviado a revisión. Madrid te debe una caña moral.');
      setContributorName('');
      setBeerBrand('');
      setPrice('');
      setSunFrom('');
      setSunTo('');
      setComment('');
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'No se pudo guardar ahora mismo.');
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 rounded-2xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-sun-300/90">Aporta a la barra libre de datos</p>
          <h3 className="font-display text-xl mt-1">Precio de la caña</h3>
        </div>
        <span className="text-2xl" aria-hidden="true">🍺</span>
      </div>

      <p className="mt-2 text-xs text-paper/50">Precio obligatorio. Horario de sol opcional si lo estas viendo en persona.</p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-paper/65">
          Tu nombre
          <input
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
            placeholder="Ej. David"
          />
        </label>
        <label className="text-xs text-paper/65">
          Marca
          <input
            value={beerBrand}
            onChange={(e) => setBeerBrand(e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
            placeholder="Mahou, Estrella..."
          />
        </label>
        <label className="text-xs text-paper/65">
          Precio euros
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            maxLength={8}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
            placeholder="2,80"
          />
        </label>
        <label className="text-xs text-paper/65">
          Sol desde
          <input
            type="time"
            value={sunFrom}
            onChange={(e) => setSunFrom(e.target.value)}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
          />
        </label>
        <label className="text-xs text-paper/65">
          Sol hasta
          <input
            type="time"
            value={sunTo}
            onChange={(e) => setSunTo(e.target.value)}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
          />
        </label>
        <label className="text-xs text-paper/65">
          Comentario opcional
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={140}
            className="mt-1 w-full rounded-xl bg-night-900/55 border border-white/10 px-3 py-2 text-paper placeholder:text-paper/35 outline-none focus:border-sun-300/80"
            placeholder="Tapa buena, vaso triste..."
          />
        </label>
      </div>

      <button
        disabled={status === 'saving'}
        className="mt-3 w-full rounded-xl bg-white/10 border border-white/10 text-paper py-2.5 text-sm hover:bg-white/15 disabled:opacity-60 transition"
      >
        {status === 'saving' ? 'Guardando en GitHub...' : 'Enviar aporte'}
      </button>
      {message && (
        <p className={`mt-2 text-xs ${status === 'error' ? 'text-red-200' : 'text-sun-100'}`}>{message}</p>
      )}
      <p className="mt-2 text-[10px] text-paper/40 leading-relaxed">
        Se envia a revision antes de publicarse. Nada de tarjetas, solo sabiduria cervecera con nombre propio.
      </p>
    </form>
  );
}
