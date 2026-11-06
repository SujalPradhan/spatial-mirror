import {clearPairing,createPairing,hosted,pairing,relayOrigin,socketUrl} from '../session';

/** Socket address of the presenter's end; hosted builds make a relay room on first use. */
export async function presenterUrl(token:string){
 if(hosted&&!pairing)await createPairing();
 return hosted?socketUrl(pairing!.token,'presenter',pairing!.code):socketUrl(token,'presenter');
}
/** Socket address for a watch code, or null when the code cannot be one. Hosted codes are an 8-character room plus a secret. */
export function viewerUrl(code:string){
 if(hosted)return relayOrigin&&code.length>8?socketUrl(code.slice(8),'viewer',code.slice(0,8)):null;
 return `${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/control-stream?${new URLSearchParams({watch:code,role:'viewer'})}`;
}
export const forgetRoom=()=>{if(hosted)clearPairing();};
