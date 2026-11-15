import { useEffect, useState } from 'react';
import { AlertCircle, Check, ChevronRight, LoaderCircle, Radar, ScanSearch, Telescope } from 'lucide-react';
import { api, type MotionCandidate, type SkyCandidateSearch } from '../lib/api';

type Props={
  jobId:string|null;
  ready:boolean;
  epochsAvailable:number;
  selectedId:string|null;
  onSelect:(candidate:MotionCandidate|null)=>void;
};

export default function CandidateFinder({
  jobId,ready,epochsAvailable,selectedId,onSelect,
}:Props){
  const [result,setResult]=useState<SkyCandidateSearch|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const canAnalyze=Boolean(jobId && ready && epochsAvailable>=3);

  useEffect(()=>{
    setResult(null);setLoading(false);setError('');
  },[jobId]);

  async function analyze(){
    if(!canAnalyze||!jobId||loading)return;
    setLoading(true);setError('');
    try{
      const response=await api.getSkyCandidates(jobId);
      setResult(response);
    }catch(e){
      setError(e instanceof Error?e.message:'No se pudo analizar este campo.');
    }finally{
      setLoading(false);
    }
  }

  return <section className="card sky-candidate-finder" aria-label="Buscar candidatos a movimiento">
    <div className="card-h">
      <span><Radar size={17}/> Buscar movimiento</span>
      <span className="chip">Experimental</span>
    </div>
    <div className="sky-candidate-intro">
      <p>Compara las épocas FITS para localizar posibles fuentes que cambian de posición.</p>
      <div className="sky-candidate-coverage">
        <Telescope size={16}/>
        <span>{epochsAvailable} épocas FITS editables</span>
        <small>mínimo 3</small>
      </div>
      <button className="btn sky-candidate-action" type="button" onClick={()=>void analyze()}
        disabled={!canAnalyze||loading}>
        {loading?<LoaderCircle size={17} className="spin"/>:<ScanSearch size={17}/>}
        {loading?'Analizando las épocas…':result?'Volver a analizar':'Buscar candidatos'}
      </button>
      {!ready&&<p className="sky-candidate-hint">
        El análisis estará disponible cuando termine la búsqueda astronómica.
      </p>}
      {ready&&epochsAvailable<3&&<p className="sky-candidate-hint">
        Se necesitan al menos tres épocas con FITS archivados para comparar trayectorias.
      </p>}
      {error&&<div role="alert" className="sky-candidate-error">
        <AlertCircle size={16}/>{error}
      </div>}
    </div>
    {result&&<div className="sky-candidate-results" aria-live="polite">
      <div className="sky-candidate-summary">
        <strong>{result.status==='candidates'
          ? result.candidates.length+' '+(result.candidates.length===1?'candidato':'candidatos')
          : result.status==='insufficient'?'Datos insuficientes':'Sin candidatos destacados'}</strong>
        <span>{result.frames_used} épocas analizadas</span>
      </div>
      <p className="sky-candidate-explanation">{result.message}</p>
      {result.candidates.map(candidate=><button type="button" key={candidate.id}
        className={'sky-candidate-item '+(selectedId===candidate.id?'selected':'')}
        aria-pressed={selectedId===candidate.id}
        onClick={()=>onSelect(selectedId===candidate.id?null:candidate)}>
        <span className="sky-candidate-item-top">
          <strong>{candidate.id} · trayectoria preliminar</strong>
          {selectedId===candidate.id?<Check size={17}/>:<ChevronRight size={17}/>}
        </span>
        <span className="sky-candidate-position">RA {candidate.ra_deg.toFixed(4)}° · Dec {candidate.dec_deg.toFixed(4)}°</span>
        <span className="sky-candidate-data">
          <span>{candidate.support} épocas</span>
          <span>{candidate.shift_px.toFixed(1)} píxeles</span>
          <span>{candidate.span_days.toFixed(0)} días</span>
        </span>
        <span className="sky-candidate-technical">
          Residuo de ajuste: {candidate.fit_rms_px.toFixed(2)} px ·
          desplazamiento aparente: {candidate.motion_arcsec_day.toFixed(3)}″/día
        </span>
      </button>)}
      {selectedId&&<p className="sky-candidate-hint">
        La trayectoria seleccionada aparece en cian sobre las épocas del explorador.
      </p>}
      {result.frames_skipped>0&&<p className="sky-candidate-hint">
        {result.frames_skipped} fotogramas no pudieron cargarse para este análisis.
      </p>}
    </div>}
    <p className="sky-candidate-disclaimer">
      <AlertCircle size={15}/>
      <span>Son señales <strong>para inspección</strong>, no descubrimientos confirmados. El método no
        identifica asteroides conocidos ni permite concluir que un candidato sea Planet X.
        La ausencia de señales no descarta movimiento.</span>
    </p>
  </section>;
}
