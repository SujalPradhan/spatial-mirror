export const NS='sm-ink';
export const BACKGROUNDS=['off','slides','blur','screen'] as const;
export type Background=typeof BACKGROUNDS[number];
export const BACKGROUND_LABELS:Record<Background,string>={off:'Background off',slides:'Slides',blur:'Blur',screen:'Screen behind you'};
export const LAYOUTS=['corner','side','full'] as const;
export type Layout=typeof LAYOUTS[number];
export const LAYOUT_LABELS:Record<Layout,string>={corner:'Corner',side:'Side',full:'Full'};
export const SLIDE_COUNT=6;
export type SegState='idle'|'ok'|'failed';
export type Presenter='in'|'out';
export interface InkConfig {ink:boolean;keep:boolean;lightboard:boolean;colour:string;background:Background;slide:number;guide:boolean;clearAt:number;layout:Layout;presenter:Presenter;videoVolume:number;duck:boolean;hear:boolean;palm:boolean}
export const DUCK_LEVEL=.3;
export const PRESENTER_MS=250;
export const DEFAULT_CONFIG:InkConfig={ink:true,keep:false,lightboard:true,colour:'#ff3b30',background:'off',slide:0,guide:true,clearAt:0,layout:'corner',presenter:'in',videoVolume:.6,duck:true,hear:false,palm:false};
export const COLOURS=['#ff3b30','#ffd60a','#30d158','#0a84ff'];
export type TrackerState='idle'|'loading'|'ready'|'failed';
export interface InkStatus {tracker:TrackerState;hand:boolean;fps:number;ms:number;seg?:SegState;segMs?:number;share?:boolean}
export const IDLE_STATUS:InkStatus={tracker:'idle',hand:false,fps:0,ms:0};
export const statusText=(s:InkStatus,ink:boolean)=>!ink?'Ink off':s.seg==='failed'?'Background failed, set to off':s.tracker==='failed'?'Tracker failed':s.tracker==='idle'?'Waiting for camera':s.tracker==='loading'?'Tracker starting':s.hand?'Tracking ok':'No hand';
