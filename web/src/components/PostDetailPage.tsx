import { useEffect, useState } from 'react';
import { ArrowLeft, MessageCircle } from 'lucide-react';
import { api, hasToken, type Post } from '../lib/api';
import PostCard from './PostCard';

export default function PostDetailPage({postId,showComments,searchBack,currentUsername,onProfile,onExplore,onLogin}:{
  postId:string;showComments:boolean;searchBack?:string;currentUsername?:string;
  onProfile:(username:string)=>void;onExplore:(id:string,sourcePostId?:string)=>void;onLogin:()=>void;
}){
  const [post,setPost]=useState<Post|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let active=true;
    setPost(null);setError('');setLoading(true);
    api.get<Post>(`/v1/posts/${encodeURIComponent(postId)}`,hasToken())
      .then(data=>{if(active)setPost(data);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'Publicación no disponible');})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[postId]);
  return <main className="wrap narrow notification-post-page">
    <div className="notification-post-heading">
      <button className="btn sm" type="button" onClick={()=>{window.location.hash=searchBack!==undefined
        ? '#/search?q='+encodeURIComponent(searchBack) : '#/activity';}}>
        <ArrowLeft size={17}/> {searchBack!==undefined?'Resultados':'Notificaciones'}
      </button>
      <h1>{showComments?<><MessageCircle size={21}/> Conversación</>:'Publicación'}</h1>
    </div>
    {loading&&<div className="card empty">Cargando publicación…</div>}
    {error&&<div className="card empty" role="status">
      Esta publicación ya no está disponible o es privada.
    </div>}
    {post&&<PostCard key={post.id} post={post} currentUsername={currentUsername}
      onProfile={onProfile} onExplore={onExplore} onRequireLogin={onLogin}
      initialCommentsOpen={showComments}/>}
  </main>;
}
