import './style.css';
import {hosted,webcamOnly} from './session';
if((webcamOnly&&location.pathname.includes('/phone'))||(hosted&&location.pathname.startsWith('/lab'))||(hosted&&location.pathname==='/phone/lab')){
 document.querySelector('#app')!.innerHTML='<main style="padding:40px"><h1>Webcam preview</h1><p>Phone controls and the hardware lab are available in the local build.</p><a href="/cone">Open the 3D workspace</a></main>';
}
else if(['/phone','/mechanism/phone','/mechanism/box/phone'].includes(location.pathname))await import('./phone');
else if(['/atp','/atp/'].includes(location.pathname))await import('./atp/app');
else if(location.pathname==='/pottery')await import('./pottery/app');
else if(location.pathname==='/tracking')await import('./tracking/app');
else if(location.pathname==='/art')await import('./art/app');
else if(location.pathname==='/maths')await import('./maths/app');
else if(location.pathname==='/mechanism/box')await import('./mechanism/app');
else if(location.pathname==='/mechanism')await import('./stand/app');
else if(location.pathname==='/phone/lab'||location.pathname.startsWith('/lab'))await import('./lab');
else await import('./studio');
if(hosted&&!location.pathname.includes('/phone'))await import('./hosted-preview');
