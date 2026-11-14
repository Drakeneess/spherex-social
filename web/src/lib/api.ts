/** Typed API contract for the FastAPI services shipped in sprints 1–4. */
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  created_at: string;
  email?: string;
};
export type Post = {
  id: string;
  username: string;
  caption: string;
  observation_id: string | null;
  visibility: 'public' | 'unlisted' | 'private';
  created_at: string;
  likes_count: number;
  comments_count: number;
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
export type SkySearch = {
  search_id: string; source: 'simulated' | 'irsa'; count: number; total_matches: number;
  ra: number; dec: number; detector: number;
  observations: {index: number;date: string;release: string;mjd: number}[];
};
export type SkyFrame = {
  image: string; index: number; date: string; release: string; mode: 'real' | 'simulated';
  wavelength_um: number | null; bandwidth_um: number | null;
  pixel_flags_nonzero_fraction?: number | null;
};
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'ApiError'; }
}
const TOKEN_KEY = 'astrogram.access_token';
const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
export const hasToken = () => Boolean(sessionStorage.getItem(TOKEN_KEY));
export const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);
const messages: Record<number, string> = {
  401: 'Sesión vencida o credenciales incorrectas', 403: 'No tienes permiso',
  404: 'No encontrado', 409: 'Ya existe un recurso con esos datos',
  422: 'Revisa los campos introducidos', 429: 'Demasiadas solicitudes',
};

async function request<T>(path: string, init: RequestInit = {}, auth = false, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body != null) headers.set('Content-Type', 'application/json');
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (auth) {
    if (!token) throw new ApiError('Debes iniciar sesión para continuar', 401);
    headers.set('Authorization', `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('No se pudo conectar con la API de AstroGram', 0);
  }
  if (!response.ok) {
    let detail = messages[response.status] ?? `Error HTTP ${response.status}`;
    try {
      const body: {detail?: string | {msg: string}[]} = await response.json();
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map(item => item.msg).join(' · ');
    } catch { /* preserve the HTTP error */ }
    if (response.status === 401 && auth) clearToken();
    throw new ApiError(detail, response.status);
  }
  // Likes, follows, bookmarks and DELETE routes return HTTP 204, not JSON.
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const get = <T>(path: string, auth = false, signal?: AbortSignal) =>
  request<T>(path, {}, auth, signal);
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
  logout: clearToken,
  me: () => get<Profile>('/v1/users/me', true),
  patchMe: (data: {display_name?:string;bio?:string|null}) => write<Profile>('PATCH','/v1/users/me',data),
  user: (username: string) => get<Profile>(`/v1/users/${encodeURIComponent(username)}`),
  stats: (username: string) => get<UserStats>(`/v1/users/${encodeURIComponent(username)}/stats`, hasToken()),
  follow: (username: string) => write<void>('POST',`/v1/users/${encodeURIComponent(username)}/follow`),
  unfollow: (username: string) => write<void>('DELETE',`/v1/users/${encodeURIComponent(username)}/follow`),
  feed: (limit = 20, offset = 0) => get<Post[]>(`/v1/feed?limit=${limit}&offset=${offset}`),
  userPosts: (username: string) => get<Post[]>(`/v1/users/${encodeURIComponent(username)}/posts`,hasToken()),
  createPost: (data: {caption:string;visibility:Post['visibility'];observation_id:string|null}) =>
    write<Post>('POST','/v1/posts',data),
  like: (id:string) => write<void>('POST',`/v1/posts/${id}/like`),
  unlike: (id:string) => write<void>('DELETE',`/v1/posts/${id}/like`),
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
  startSkyJob: (data: {ra:number;dec:number;size:number;detector:number;frames:number},signal?:AbortSignal) =>
    request<{job_id:string;phase:string}>('/api/search/jobs',{
      method:'POST',
      body:JSON.stringify({ra:data.ra,dec:data.dec,size_arcmin:data.size,
        detector:data.detector,max_frames:data.frames}),
    },false,signal),
  pollSkyJob: (id:string,signal?:AbortSignal) =>
    get<{phase:string;result?:SkySearch;error?:string;warning?:string;retry_after_seconds?:number;attempt?:number}>(`/api/search/jobs/${encodeURIComponent(id)}`,false,signal),
  cancelSkyJob: (id:string) =>
    request<void>(`/api/search/jobs/${encodeURIComponent(id)}`,{method:'DELETE'}),
  frame: (id:string,index:number,signal?:AbortSignal) =>
    get<SkyFrame>(`/api/frame/${encodeURIComponent(id)}/${index}`,false,signal),
};
