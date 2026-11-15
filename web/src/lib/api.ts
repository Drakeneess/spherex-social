/** Typed API contract for the FastAPI services shipped in sprints 1–4. */
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  website: string|null;
  avatar_version: string|null;
  cover_version: string|null;
  avatar_color_start: string|null;
  avatar_color_end: string|null;
  cover_color_start: string|null;
  cover_color_end: string|null;
  birthday_public: string|null;
  birth_date?: string|null;
  show_birthday?: boolean;
  created_at: string;
  email?: string;
};
export type RevealRecipe = {
  version: 1;
  palette: 'gray'|'cyan'|'violet'|'ember'|'custom';
  stretch: 'linear'|'asinh'|'log';
  black: number;
  white: number;
  gamma: number;
  highlight: string;
  shadow: string;
  format: 'square'|'portrait'|'wide';
  sampling: 'smooth'|'pixels';
};
export const DEFAULT_REVEAL: RevealRecipe = {
  version:1,palette:'cyan',stretch:'asinh',black:2,white:99.5,
  gamma:1,highlight:'#62cfff',shadow:'#080d28',
  format:'square',sampling:'smooth',
};
export type PostBlinkInfo = {
  job_id: string;
  status: PersistentSkyJob['status'];
  detector: number;
  source: 'sia2'|'simulated';
  display_recipe: RevealRecipe|null;
  frames: {index:number;status:'pending'|'loading'|'ready'|'failed';date:string|null}[];
};
export type PostMedia = {id:string;media_type:'image/webp';position:number};
export type Post = {
  id: string;
  username: string;
  caption: string;
  display_recipe: RevealRecipe|null;
  link_url: string|null;
  hashtags: string[];
  media: PostMedia[];
  observation_id: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  created_at: string;
  likes_count: number;
  comments_count: number;
  reposts_count: number;
  reposted_by_me: boolean;
  bookmarked_by_me: boolean;
  liked_by_me: boolean;
  reposted_by: string | null;
  reposted_at: string | null;
};
export type Observation = {
  id: string;
  ra_deg: number;
  dec_deg: number;
  fov_arcmin: number;
  detector: number | null;
  mission: string;
  data_release: string | null;
  created_at: string;
  viewer_path: string;
};
export type ObservationParams = Pick<Observation, 'ra_deg' | 'dec_deg' | 'fov_arcmin'> & { detector: number };
export type UserStats = { username: string; followers_count: number; following_count: number; is_following: boolean };
export type Comment = { id: string; post_id: string; username: string; body: string; parent_id: string | null; created_at: string };
export type AstroNotification = {
  id:string;kind:'like'|'comment'|'reply'|'repost'|'follow';
  actor_username:string;actor_display_name:string;
  post_id:string|null;post_author_username:string|null;
  comment_preview:string|null;created_at:string;read_at:string|null;
};
export type UnreadNotifications = {unread:number};
export type Sia2Discovery = {
  method: 'sia2'; elapsed_ms:number; http_ms:number; parse_ms:number;
  attempts:number; retry_events:{attempt:number;elapsed_ms:number;failure:string}[];
  query_status:string; matching_detector_rows:number; valid_cutout_rows:number;
  usable_epoch_rows:number; radius_arcsec:number;
};
export type SkySearch = {
  search_id: string; source: 'simulated' | 'irsa' | 'sia2'; count: number; total_matches: number;
  discovery?: Sia2Discovery;
  ra: number; dec: number; detector: number;
  observations: {index: number;date: string;release: string;mjd: number}[];
};
export type MotionCandidate = {
  id:string;score:number;support:number;span_days:number;shift_px:number;
  motion_arcsec_day:number;fit_rms_px:number;ra_deg:number;dec_deg:number;
  detections:{index:number;mjd:number;x:number;y:number;snr_proxy:number}[];
};
export type SkyCandidateSearch = {
  job_id:string;method:string;frames_total:number;frames_used:number;frames_skipped:number;
  status:'candidates'|'no_candidates'|'insufficient';message:string;
  candidates:MotionCandidate[];limitations:string[];
};
export type PersistentSkyJob = {
  job_id: string;
  status: 'queued' | 'catalog' | 'frames' | 'complete' | 'partial' | 'empty' | 'failed' | 'cancelled';
  source: 'sia2' | 'simulated';
  created_at: string;
  updated_at: string;
  query: {ra:number;dec:number;size_arcmin:number;detector:number;max_frames:number;demo:boolean};
  total_matches: number|null;
  result: SkySearch|null;
  discovery: {method:string;elapsed_ms?:number;attempts?:number;query_status?:string}|null;
  frames: {index:number;status:'pending'|'loading'|'ready'|'failed';raw_available?:boolean;error?:string}[];
  error: string|null;
};
export type TapTiming = {
  submit_ms: number;
  run_ms: number;
  remote_observed_ms: number;
  phase_observed_ms: Record<string, number>;
  phase_events: {phase:string;at_ms:number}[];
  poll_count: number;
  poll_errors: number;
  phase_http_ms: number;
  result_fetch_ms: number | null;
  result_parse_ms: number | null;
  phase_method?: 'phase_endpoint' | 'full_job_fallback' | 'unknown';
  remote_start_time?: string | null;
  remote_end_time?: string | null;
  remote_execution_ms?: number | null;
  job_info_ms?: number | null;
  job_info_status?: string;
};
export type FrameTiming = {
  apertura_fits: number;
  lectura_pixeles: number;
  reproyeccion: number;
  metadatos: number;
  png: number;
  total: number;
  attempts?: number;
  total_with_retries?: number;
};
export type Sia2Comparison = {
  source: 'sia2_vs_tap';
  query: {ra:number;dec:number;size_arcmin:number;detector:number};
  sia2: {
    elapsed_ms:number;http_ms:number;parse_ms:number;query_status:string;
    attempts:number;retry_events:{attempt:number;elapsed_ms:number;failure:string}[];
    complete:boolean;raw_rows:number;matching_detector_rows:number;
    valid_cutout_rows:number;unique_compatible_images:number;
    releases:Record<string,number>;
    date_range:{earliest:string|null;latest:string|null};
    discarded:Record<string,number>;collections:string[];radius_arcsec:number;
  };
  tap: {
    unique_images:number;selected_epochs:number;releases:Record<string,number>;
    date_range:{earliest:string|null;latest:string|null};
  };
  overlap: {
    matched:number;tap_only:number;sia2_only:number;selected_tap_matched:number;
    tap_only_examples:{date:string|null;release:string|null}[];
    sia2_only_examples:{date:string|null;release:string|null}[];
  };
  comparable:boolean;caveats:string[];
};
export type SkyFrame = {
  image: string; index: number; date: string; release: string; mode: 'real' | 'simulated';
  wavelength_um: number | null; bandwidth_um: number | null;
  pixel_flags_nonzero_fraction?: number | null;
  timing_ms?: FrameTiming;
};
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
const TOKEN_KEY = 'astrogram.access_token';
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const realtimeBase = BASE;
export const hasToken = () => Boolean(sessionStorage.getItem(TOKEN_KEY));
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

// Short JWTs are an implementation detail. An HttpOnly, server-backed device
// session survives page reloads and renews them. Never store a refresh secret
// in JavaScript storage or expose it to the application.
let refreshInFlight: Promise<string | null> | null = null;
async function renewAccess(): Promise<string | null> {
  if(refreshInFlight)return refreshInFlight;
  refreshInFlight=(async()=>{
    try{
      const response=await fetch(`${BASE}/v1/auth/refresh`,{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Accept':'application/json'},
      });
      if(!response.ok)return null;
      const value=await response.json() as {access_token?:string};
      if(typeof value.access_token!=='string'||!value.access_token)return null;
      sessionStorage.setItem(TOKEN_KEY,value.access_token);
      return value.access_token;
    }catch{return null;}
  })();
  try{return await refreshInFlight;}
  finally{refreshInFlight=null;}
}

export const realtimeToken = () => renewAccess();

const messages: Record<number, string> = {
  401: 'Sesión vencida o credenciales incorrectas', 403: 'No tienes permiso',
  404: 'No encontrado', 409: 'Ya existe un recurso con esos datos',
  422: 'Revisa los campos introducidos', 429: 'Demasiadas solicitudes',
};

async function request<T>(path: string, init: RequestInit = {}, auth = false, signal?: AbortSignal): Promise<T> {
  const baseHeaders = new Headers(init.headers);
  baseHeaders.set('Accept','application/json');
  if(init.body!=null)baseHeaders.set('Content-Type','application/json');
  let token=auth?sessionStorage.getItem(TOKEN_KEY):null;
  if(auth&&!token){
    token=await renewAccess();
    if(!token)throw new ApiError('Debes iniciar sesión para continuar',401);
  }
  const send=async(accessToken:string|null)=>{
    const headers=new Headers(baseHeaders);
    if(auth&&accessToken)headers.set('Authorization',`Bearer ${accessToken}`);
    try{
      return await fetch(`${BASE}${path}`,{
        ...init,headers,signal,credentials:'same-origin',
      });
    }catch(error){
      if(signal?.aborted)throw error;
      throw new ApiError('No se pudo conectar con la API de AstroGram',0);
    }
  };
  let response=await send(token);
  // A concurrent tab or request may have just renewed its access token.
  // Try the latest access token, or refresh once, but never replay endlessly.
  if(auth&&response.status===401){
    const current=sessionStorage.getItem(TOKEN_KEY);
    const next=current&&current!==token?current:await renewAccess();
    if(next)response=await send(next);
    if(response.status===401||!next)clearToken();
  }
  if(!response.ok){
    let detail=messages[response.status]??`Error HTTP ${response.status}`;
    try{
      const body:{detail?:string|{msg:string}[]}=await response.json();
      if(typeof body.detail==='string')detail=body.detail;
      else if(Array.isArray(body.detail))detail=body.detail.map(x=>x.msg).join(' · ');
    }catch{/* Preserve the HTTP error. */}
    throw new ApiError(detail,response.status);
  }
  if(response.status===204)return undefined as T;
  return response.json() as Promise<T>;
}
const get = <T>(path: string, auth = false, signal?: AbortSignal) =>
  request<T>(path, auth ? {cache: 'no-store'} : {}, auth, signal);
const write = <T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) =>
  request<T>(path, {method, ...(body === undefined ? {} : {body: JSON.stringify(body)})}, true);

export const api = {
  get,
  register: (data: {username:string;display_name:string;email:string;password:string}) =>
    request<Profile>('/v1/auth/register', {method:'POST',body:JSON.stringify(data)}),
  async login(email: string, password: string) {
    const result = await request<{access_token:string;token_type:string;expires_in:number}>(
      '/v1/auth/login', {method:'POST',body:JSON.stringify({email,password})}
    );
    sessionStorage.setItem(TOKEN_KEY, result.access_token);
    return result;
  },
  clearLocalSession: clearToken,
  // A new browser tab can restore the login using only the HttpOnly cookie.
  async restoreSession() {
    return Boolean(sessionStorage.getItem(TOKEN_KEY)||await renewAccess());
  },
  async logout() {
    // Revocation must be acknowledged before pretending logout succeeded.
    const response=await fetch(`${BASE}/v1/auth/logout`,{
      method:'POST',credentials:'same-origin',cache:'no-store',
    });
    if(!response.ok)throw new ApiError('No se pudo cerrar sesión en el servidor',response.status);
    clearToken();
    // Tell other open tabs to discard their short JWT too. The server has
    // already revoked this device session, so they cannot silently refresh.
    try{localStorage.setItem('astrogram.auth.logout',String(Date.now()));}catch{}
  },
  me: () => get<Profile>('/v1/users/me', true),
  patchMe: (data: {
    display_name?:string;bio?:string|null;website?:string|null;
    avatar_color_start?:string|null;avatar_color_end?:string|null;
    cover_color_start?:string|null;cover_color_end?:string|null;
    birth_date?:string|null;show_birthday?:boolean;
  }) =>
    write<Profile>('PATCH','/v1/users/me',data),
  profileMediaUrl: (username:string,kind:'avatar'|'cover',version:string) =>
    `${BASE}/v1/users/${encodeURIComponent(username)}/media/${kind}?v=${encodeURIComponent(version)}`,
  uploadProfileMedia: (kind:'avatar'|'cover',data_url:string) =>
    write<Profile>('POST',`/v1/users/me/media/${kind}`,{data_url}),
  deleteProfileMedia: (kind:'avatar'|'cover') =>
    write<Profile>('DELETE',`/v1/users/me/media/${kind}`),
  user: (username: string) => get<Profile>(`/v1/users/${encodeURIComponent(username)}`),
  stats: (username: string) => get<UserStats>(`/v1/users/${encodeURIComponent(username)}/stats`, hasToken()),
  follow: (username: string) => write<void>('POST',`/v1/users/${encodeURIComponent(username)}/follow`),
  unfollow: (username: string) => write<void>('DELETE',`/v1/users/${encodeURIComponent(username)}/follow`),
  unreadNotifications: () => get<UnreadNotifications>('/v1/users/me/notifications/count',true),
  notifications: (limit=20,offset=0) => get<AstroNotification[]>(
    `/v1/users/me/notifications?limit=${limit}&offset=${offset}`,true),
  markNotificationRead: (id:string) =>
    write<void>('POST',`/v1/users/me/notifications/${encodeURIComponent(id)}/read`),
  markAllNotificationsRead: () =>
    write<void>('POST','/v1/users/me/notifications/read-all'),
  feed: (limit = 20, offset = 0, tag?:string) => get<Post[]>(
    `/v1/feed?limit=${limit}&offset=${offset}${tag?`&tag=${encodeURIComponent(tag)}`:''}`,hasToken()),
  userPosts: (username: string) => get<Post[]>(`/v1/users/${encodeURIComponent(username)}/posts`,hasToken()),
  createPost: (data: {
    caption:string;visibility:Post['visibility'];observation_id:string|null;
    sky_job_id?:string|null;display_recipe?:RevealRecipe|null;
    images?:{data_url:string}[];link_url?:string|null;
  }) => write<Post>('POST','/v1/posts',data),
  postMediaData: (postId:string,mediaId:string,size:'thumbnail'|'full'='thumbnail') =>
    get<{data_url:string}>(
      `/v1/posts/${encodeURIComponent(postId)}/media/${encodeURIComponent(mediaId)}?size=${size}`,
      hasToken()),
  preparePostBlink: (postId:string,signal?:AbortSignal) =>
    request<PostBlinkInfo>(`/v1/posts/${encodeURIComponent(postId)}/blink`,
      {method:'POST'},hasToken(),signal),
  like: (id:string) => write<void>('POST',`/v1/posts/${id}/like`),
  unlike: (id:string) => write<void>('DELETE',`/v1/posts/${id}/like`),
  repost: (id:string) => write<void>('POST',`/v1/posts/${id}/repost`),
  unrepost: (id:string) => write<void>('DELETE',`/v1/posts/${id}/repost`),
  bookmark: (id:string) => write<void>('POST',`/v1/posts/${id}/bookmark`),
  unbookmark: (id:string) => write<void>('DELETE',`/v1/posts/${id}/bookmark`),
  bookmarks: () => get<Post[]>('/v1/users/me/bookmarks',true),
  comments: (id:string) => get<Comment[]>(`/v1/posts/${id}/comments`),
  createComment: (id:string,body:string,parent_id:string|null=null) =>
    write<Comment>('POST',`/v1/posts/${id}/comments`,{body,parent_id}),
  deleteComment: (postId:string,id:string) =>
    write<void>('DELETE',`/v1/posts/${postId}/comments/${id}`),
  observation: (id:string) => get<Observation>(`/v1/observations/${encodeURIComponent(id)}`),
  createObservation: (data:ObservationParams) => write<Observation>('POST','/v1/observations',data),
  observations: (limit=20,offset=0) => get<Observation[]>(`/v1/observations?limit=${limit}&offset=${offset}`),
  mine: () => get<Observation[]>('/v1/users/me/observations',true),
  async searchSky(data: {ra:number;dec:number;size:number;detector:number;frames:number;demo:boolean}, signal?:AbortSignal) {
    const query = new URLSearchParams({
      ra:String(data.ra),dec:String(data.dec),size_arcmin:String(data.size),
      detector:String(data.detector),max_frames:String(data.frames),demo:String(data.demo),
    });
    return get<SkySearch>(`/api/search?${query}`,false,signal);
  },
  searchSia2: (data: {ra:number;dec:number;size:number;detector:number;frames:number},signal?:AbortSignal) =>
    request<SkySearch>('/api/search/sia2', {
      method: 'POST',
      body: JSON.stringify({
        ra:data.ra, dec:data.dec, size_arcmin:data.size,
        detector:data.detector, max_frames:data.frames,
      }),
    },false,signal),
  startSkyJob: (data: {ra:number;dec:number;size:number;detector:number;frames:number},signal?:AbortSignal) =>
    request<{job_id:string;phase:string;timing:TapTiming}>('/api/search/jobs',{
      method:'POST',
      body:JSON.stringify({ra:data.ra,dec:data.dec,size_arcmin:data.size,
        detector:data.detector,max_frames:data.frames}),
    },false,signal),
  pollSkyJob: (id:string,signal?:AbortSignal) =>
    get<{phase:string;result?:SkySearch;error?:string;warning?:string;retry_after_seconds?:number;attempt?:number;timing?:TapTiming}>(`/api/search/jobs/${encodeURIComponent(id)}`,false,signal),
  cancelSkyJob: (id:string) =>
    request<void>(`/api/search/jobs/${encodeURIComponent(id)}`,{method:'DELETE'}),
  createPersistentSkyJob: (jobId:string,data: {
    ra:number;dec:number;size:number;detector:number;frames:number;demo:boolean;
  },signal?:AbortSignal) =>
    request<PersistentSkyJob>('/api/sky/jobs',{
      method:'POST',
      body:JSON.stringify({
        job_id:jobId, ra:data.ra,dec:data.dec,size_arcmin:data.size,
        detector:data.detector,max_frames:data.frames,demo:data.demo,
      }),
    },false,signal),
  getSkyCandidates: (jobId:string,signal?:AbortSignal) =>
    get<SkyCandidateSearch>(`/api/sky/jobs/${encodeURIComponent(jobId)}/candidates`,false,signal),
  getPersistentSkyJob: (jobId:string,signal?:AbortSignal) =>
    get<PersistentSkyJob>(`/api/sky/jobs/${encodeURIComponent(jobId)}`,false,signal),
  getPersistentSkyFrame: (jobId:string,index:number,signal?:AbortSignal) =>
    get<SkyFrame>(`/api/sky/jobs/${encodeURIComponent(jobId)}/frames/${index}`,false,signal),
  revealSkyFrame: (jobId:string,index:number,recipe:RevealRecipe,signal?:AbortSignal) =>
    request<{image:string;recipe:RevealRecipe;derived:boolean}>(
      `/api/sky/jobs/${encodeURIComponent(jobId)}/frames/${index}/reveal`,
      {method:'POST',body:JSON.stringify(recipe),cache:'no-store'},false,signal),
  cancelPersistentSkyJob: (jobId:string) =>
    request<void>(`/api/sky/jobs/${encodeURIComponent(jobId)}`,{method:'DELETE'}),
  compareSia2: (searchId:string,signal?:AbortSignal) =>
    get<Sia2Comparison>(`/api/diagnostics/sia2/${encodeURIComponent(searchId)}`,false,signal),
  frame: (id:string,index:number,signal?:AbortSignal) =>
    get<SkyFrame>(`/api/frame/${encodeURIComponent(id)}/${index}`,false,signal),
};
