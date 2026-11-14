import { useEffect, useState } from 'react';
import { ArrowUpRight, Compass, Heart, MessageCircle, Orbit, RefreshCw } from 'lucide-react';
import './community.css';

type FeedPost = {
  id: string;
  username: string;
  caption: string;
  visibility: 'public' | 'unlisted' | 'private';
  observation_id: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
};

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export default function CommunityFeed({ onOpenObservation }: { onOpenObservation: (id: string) => void }) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function refresh(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const result = await fetch(`${BASE}/v1/feed?limit=12`, { signal });
      if (!result.ok) throw new Error(`Feed HTTP ${result.status}`);
      const json: FeedPost[] = await result.json();
      if (!signal?.aborted) setPosts(json);
    } catch (e) {
      if (!signal?.aborted) setError(e instanceof Error ? e.message : 'No se pudo cargar el feed');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, []);

  return (
    <section className="community" aria-label="Publicaciones recientes">
      <div className="community-heading">
        <div>
          <span className="community-kicker"><Orbit size={15} /> COMUNIDAD SPHEREX</span>
          <h2>Observaciones compartidas</h2>
          <p>Publicaciones públicas de la comunidad. Abre una región para inspeccionar sus coordenadas y consultar imágenes de IRSA.</p>
        </div>
        <button type="button" className="community-refresh" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={15} /> Actualizar feed
        </button>
      </div>
      {loading && <p className="community-status">Cargando publicaciones…</p>}
      {error && <p className="community-status community-error">{error}</p>}
      {!loading && !error && posts.length === 0 && <p className="community-status">Todavía no hay publicaciones públicas.</p>}
      <div className="community-grid">
        {posts.map(post => (
          <article className="community-card" key={post.id}>
            <div className="community-author">@{post.username}</div>
            <p>{post.caption}</p>
            <div className="community-stats">
              <span><Heart size={14} /> {post.likes_count}</span>
              <span><MessageCircle size={14} /> {post.comments_count}</span>
              <span>{new Date(post.created_at).toLocaleDateString('es')}</span>
            </div>
            {post.observation_id
              ? <a className="community-open"
                   href={`/?observation_id=${encodeURIComponent(post.observation_id)}`}
                   onClick={event => {
                     event.preventDefault();
                     onOpenObservation(post.observation_id!);
                   }}>
                  <Compass size={15} /> Abrir observación <ArrowUpRight size={14} />
                </a>
              : <div className="community-text-only">Publicación de texto · sin observación asociada</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
