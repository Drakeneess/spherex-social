import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import {
  getSoundSettings, playSound, SOUND_SETTINGS_EVENT, updateSoundSettings,
} from '../lib/sounds';

/** Compact mute control for signed-in navigation and guest exploration. */
export default function SoundQuickToggle({className=''}:{className?:string}) {
  const [settings,setSettings]=useState(getSoundSettings);
  useEffect(()=>{
    const update=()=>setSettings(getSoundSettings());
    window.addEventListener(SOUND_SETTINGS_EVENT,update);
    return()=>window.removeEventListener(SOUND_SETTINGS_EVENT,update);
  },[]);
  const audible=settings.enabled&&settings.volume>0;
  const label=audible?'Silenciar sonidos':'Activar sonidos';
  function toggle(){
    const next=updateSoundSettings({enabled:!settings.enabled,
      volume:settings.volume===0&&!settings.enabled?45:settings.volume});
    setSettings(next);
    if(next.enabled)playSound('toggle');
  }
  return <button type="button" data-sound="none"
    className={'sound-quick-toggle '+className}
    aria-label={label} aria-pressed={audible}
    title={label} onClick={toggle}>
    {audible?<Volume2 size={19} aria-hidden="true"/>:<VolumeX size={19} aria-hidden="true"/>}
    <span className="t">Sonidos</span>
  </button>;
}
