/** Per-account UI-only onboarding (no fabricated social activity or server flags). */
export const TASKS = [
  {key:'explore',title:'Explora el cielo',icon:'telescope',route:'explore'},
  {key:'mark',title:'Marca un objeto en movimiento',icon:'pin',route:'explore'},
  {key:'game',title:'Juega el reto diario',icon:'target',route:'game'},
  {key:'like',title:'Envía tu primer «Me encoheta»',icon:'ship',route:'home'},
  {key:'bio',title:'Completa tu bio',icon:'pen',route:'settings'},
  {key:'post',title:'Publica tu primer hallazgo',icon:'spark',route:'publish'},
] as const;
export type TaskKey = typeof TASKS[number]['key'];
export type TaskProgress = Partial<Record<TaskKey, true>>;
export type NudgeKey = 'like'|'mark'|'game';
export const TASK_EVENT = 'astrogram:onboarding-task';
export const NUDGE_EVENT = 'astrogram:onboarding-nudge';
export const ONBOARDING_VERSION = 'v1';

export function storageKey(userId:string,kind:string) {
  // Profile IDs, rather than public names, partition each account's progress.
  return `astrogram.onboarding.${ONBOARDING_VERSION}.${encodeURIComponent(userId)}.${kind}`;
}
export function readFlag(userId:string,kind:string):boolean {
  try {return localStorage.getItem(storageKey(userId,kind))==='1';}catch{return false;}
}
export function writeFlag(userId:string,kind:string,enabled=true) {
  try {
    const key=storageKey(userId,kind);
    if(enabled)localStorage.setItem(key,'1');
    else localStorage.removeItem(key);
  }catch {/* Browsers with blocked storage can still use the current tour. */}
}
export function readTasks(userId:string):TaskProgress {
  try {
    const data=JSON.parse(localStorage.getItem(storageKey(userId,'tasks'))??'{}') as Record<string,unknown>;
    if(!data || typeof data!=='object' || Array.isArray(data))return {};
    return Object.fromEntries(TASKS.filter(task=>data[task.key]===true).map(task=>[task.key,true])) as TaskProgress;
  }catch{return {};}
}
export function saveTasks(userId:string,tasks:TaskProgress) {
  try {localStorage.setItem(storageKey(userId,'tasks'),JSON.stringify(tasks));}catch{}
}
export function signalTask(key:TaskKey) {
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(TASK_EVENT,{detail:{key}}));
}
export function signalNudge(key:NudgeKey) {
  if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(NUDGE_EVENT,{detail:{key}}));
}
export const isTaskKey=(value:unknown):value is TaskKey=>TASKS.some(task=>task.key===value);

export type TourStep = {
  title:string; description:string; target?:string; icon?:string;
};
export type TourSpec = {
  key:string; steps:TourStep[]; soft?:boolean;
};
export function welcomeSteps(firstName:string):TourStep[] {
  return [
    {title:`¡Te damos la bienvenida a AstroGram, ${firstName}!`,icon:'planet',
      description:'Aquí puedes comparar imágenes del cielo entre épocas y compartir observaciones. Te enseñamos las funciones principales.'},
    {title:'Inicio',target:'[data-tour="nav-home"]',icon:'home',
      description:'Tu feed muestra las publicaciones de otras personas, con sus observaciones astronómicas y conversaciones.'},
    {title:'Tus primeros pasos',target:'[data-tour="first-steps"]',icon:'ship',
      description:'Seis misiones que se completan al utilizar las funciones reales de AstroGram. Su progreso queda guardado en este navegador.'},
    {title:'Explorar',target:'[data-tour="nav-explore"]',icon:'telescope',
      description:'Elige coordenadas RA y Dec, compara épocas de SPHEREx y personaliza la visualización con el revelado FITS.'},
    {title:'Juego educativo',target:'[data-tour="nav-game"]',icon:'target',
      description:'Practica identificando un objeto que se desplaza entre dos cielos simulados. No se trata de una detección científica.'},
    {title:'Publicar',target:'[data-tour="nav-publish"]',icon:'spark',
      description:'Comparte textos u observaciones reales. Las coordenadas y la receta de revelado se adjuntan cuando las seleccionas; las marcas aún no se publican.'},
    {title:'Tu perfil',target:'[data-tour="nav-profile"]',icon:'pen',
      description:'Consulta tus publicaciones, compartidos y biografía. Puedes actualizar tus datos desde Ajustes.'},
    {title:'Buscar astroamigos',target:'[data-tour="global-search"]',icon:'galaxy',
      description:'Busca por nombre de usuario o introduce coordenadas para abrir una región del cielo.'},
    {title:'¡Listo para explorar!',icon:'spark',
      description:'Empieza por una misión. Puedes repetir este recorrido desde Ajustes en cualquier momento.'},
  ];
}
export const explorerSteps:TourStep[]=[
  {title:'Empieza con un objeto conocido',target:'[data-tour="explore-presets"]',icon:'telescope',
    description:'Prueba uno de estos objetos o escribe tus propias coordenadas. La búsqueda real se realiza con datos de IRSA.'},
  {title:'Marca una posición',target:'[data-tour="explore-canvas"]',icon:'pin',
    description:'Cuando termine de cargar una época, toca el cielo para marcar una posición. Las marcas son personales y todavía no se adjuntan a las publicaciones.'},
  {title:'Revela y publica',target:'[data-tour="explore-publish"]',icon:'spark',
    description:'Si el FITS está archivado, puedes cambiar colores y formato antes de publicar. Comparte la región y la receta de visualización.'},
];
export const gameSteps:TourStep[]=[
  {title:'El reto diario',target:'[data-tour="game-start"]',icon:'target',
    description:'Cinco pares de cielos sintéticos. Empieza el reto y toca el objeto que cambió de posición en la imagen «Después».'},
];
export function publishingSteps(hasRegion:boolean):TourStep[]{
  return [
    {title:'1 · Cuenta qué viste',target:'[data-tour="publish-caption"]',icon:'pen',
      description:'Describe la observación y las épocas comparadas. Evita presentar un movimiento como confirmado sin verificarlo.'},
    {title:hasRegion?'2 · Adjunta coordenadas':'2 · Añade coordenadas',target:hasRegion?'[data-tour="publish-region"]':'[data-tour="publish-caption"]',icon:'pin',
      description:hasRegion?'Activa esta opción para conservar la región y, cuando corresponda, su revelado. Las marcas aún no se adjuntan.':'Puedes publicar texto. Para compartir una región, busca primero un objeto en el explorador.'},
    {title:'3 · ¡Publica!',target:'[data-tour="publish-submit"]',icon:'ship',
      description:'La publicación aparecerá según la visibilidad que elijas. Puedes editar su texto más adelante.'},
  ];
}
export function nudgeStep(key:NudgeKey):TourStep {
  if(key==='like')return {title:'¡Tu primer «Me encoheta»!',target:'[data-tour="like-button"]',icon:'ship',
    description:'El cohete muestra que te gustó una publicación. Puedes retirarlo pulsando de nuevo.'};
  if(key==='mark')return {title:'¡Primera marca!',target:'[data-tour="explore-canvas"]',icon:'pin',
    description:'Marca una posición en otra época para dibujar su trayectoria. Esto no confirma movimiento astronómico.'};
  return {title:'Detecta la diferencia',target:'[data-tour="game-after"]',icon:'target',
    description:'Compara «Antes» y «Después». Tu misión se ha registrado tras realizar el primer intento.'};
}
