import { useEffect, useState } from 'react';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import {
  getSoundSettings, playSound, SOUND_SETTINGS_EVENT,
  updateSoundSettings, type SoundSettings,
} from '../lib/sounds';

export default function SoundSettingsPanel(){
  const [settings,setSettings]=useState<SoundSettings>(getSoundSettings);
  useEffect(()=>{
    const sync=()=>setSettings(getSoundSettings());
    window.addEventListener(SOUND_SETTINGS_EVENT,sync);
    return()=>window.removeEventListener(SOUND_SETTINGS_EVENT,sync);
  },[]);

  function enabled(value:boolean){
    const updated=updateSoundSettings({enabled:value});
    setSettings(updated);
    if(value)playSound('toggle');
  }
  function volume(value:number){
    setSettings(updateSoundSettings({volume:value}));
  }
  return <section className="sec sound-settings" aria-labelledby="sound-settings-title">
    <div className="sound-settings-heading">
      <span className="sound-settings-symbol" aria-hidden="true"><Music2 size={20}/></span>
      <div>
        <h3 id="sound-settings-title">Soniditos de AstroGram</h3>
        <p>Efectos originales que acompañan tus interacciones. Se generan en tu navegador; no descargan audio ni reproducen música.</p>
      </div>
    </div>
    <label className="sound-enabled-row">
      <span className="sound-enabled-label">
        {settings.enabled?<Volume2 size={19}/>:<VolumeX size={19}/>}
        <span><strong>Sonidos de interfaz</strong>
          <small>{settings.enabled?'Activados':'Silenciados'}</small></span>
      </span>
      <input data-sound="none" type="checkbox" checked={settings.enabled}
        onChange={event=>enabled(event.target.checked)}
        aria-label="Activar sonidos de AstroGram"/>
    </label>
    <div className={'sound-settings-body'+(!settings.enabled?' is-muted':'')}>
      <div className="sound-volume-line">
        <label htmlFor="sound-volume">Volumen</label>
        <output htmlFor="sound-volume">{settings.volume}%</output>
      </div>
      <input id="sound-volume" data-sound="none"
        type="range" min={0} max={100} step={5}
        disabled={!settings.enabled}
        value={settings.volume}
        onChange={event=>volume(Number(event.target.value))}
        onPointerUp={()=>playSound('toggle')}
        onKeyUp={()=>playSound('toggle')}
        aria-label="Volumen de los sonidos de interfaz"/>
    </div>
  </section>;
}
