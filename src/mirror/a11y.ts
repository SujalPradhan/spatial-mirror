export type HoldTime='short'|'normal'|'long';
/** null follows the system's reduced-motion preference until the viewer chooses. */
export interface MirrorSettings {tracking:boolean;reducedMotion:boolean|null;hold:HoldTime;oneHanded:boolean}
export const HOLD_SCALE:Record<HoldTime,number>={short:.6,normal:1,long:1.8};
const STORAGE_KEY='mirror-settings-v1';
export const defaultSettings=():MirrorSettings=>({tracking:true,reducedMotion:null,hold:'normal',oneHanded:false});
type Store=Pick<Storage,'getItem'|'setItem'>;

export function loadSettings(store:Store|null):MirrorSettings{
 const out=defaultSettings();
 try{
  const raw=JSON.parse(store?.getItem(STORAGE_KEY)??'null') as Partial<MirrorSettings>|null;
  if(!raw||typeof raw!=='object')return out;
  if(typeof raw.tracking==='boolean')out.tracking=raw.tracking;
  if(typeof raw.reducedMotion==='boolean')out.reducedMotion=raw.reducedMotion;
  if(raw.hold&&raw.hold in HOLD_SCALE)out.hold=raw.hold;
  if(typeof raw.oneHanded==='boolean')out.oneHanded=raw.oneHanded;
 }catch{}
 return out;
}
export function saveSettings(store:Store|null,settings:MirrorSettings){try{store?.setItem(STORAGE_KEY,JSON.stringify(settings));}catch{}}
export const motionReduced=(settings:MirrorSettings,system:boolean)=>settings.reducedMotion??system;

interface KeyLike {key:string;shiftKey:boolean;ctrlKey:boolean;altKey:boolean;metaKey:boolean}
const NAMES:Record<string,string>={' ':'space'};
const named=(key:string)=>NAMES[key]??key.toLowerCase();
/** A spec is a lowercase key name with an optional "shift+" prefix, and "|" joins alternatives. Shift is ignored for punctuation, which already carries it. */
export function matchKey(e:KeyLike,spec:string):boolean{
 if(e.ctrlKey||e.altKey||e.metaKey)return false;
 return spec.split('|').some(one=>{
  const wantShift=one.startsWith('shift+'),key=wantShift?one.slice(6):one;
  if(named(e.key)!==key)return false;
  return /^[a-z0-9]$/.test(key)||key.length>1?e.shiftKey===wantShift:true;
 });
}
const LABELS:Record<string,string>={arrowleft:'Left arrow',arrowright:'Right arrow',arrowup:'Up arrow',arrowdown:'Down arrow',space:'Space',home:'Home',escape:'Esc'};
export function keyLabel(spec:string){
 return spec.split('|').map(one=>{
  const shift=one.startsWith('shift+'),key=shift?one.slice(6):one,text=LABELS[key]??(key.length===1?key.toUpperCase():key);
  return shift?`Shift+${text}`:text;
 }).join(' or ');
}

/** Lets a changed line through at most once per interval, so a screen reader is not read a counter ticking. */
export function textGate(minMs:number){
 let last='',at=-Infinity;
 return (text:string,now:number):string|null=>{
  if(text===last||now-at<minMs)return null;
  last=text;at=now;return text;
 };
}
