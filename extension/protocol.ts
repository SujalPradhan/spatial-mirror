export const NS='sm-ink';
export const BACKGROUNDS=['off','slides','blur'] as const;
export type Background=typeof BACKGROUNDS[number];
export const BACKGROUND_LABELS:Record<Background,string>={off:'Background off',slides:'Slides',blur:'Blur'};
export const SLIDE_COUNT=6;
export type SegState='idle'|'ok'|'failed';
export interface InkConfig {ink:boolean;keep:boolean;lightboard:boolean;colour:string;background:Background;slide:number;guide:boolean;clearAt:number}
export const DEFAULT_CONFIG:InkConfig={ink:true,keep:false,lightboard:true,colour:'#ff3b30',background:'off',slide:0,guide:true,clearAt:0};
export const COLOURS=['#ff3b30','#ffd60a','#30d158','#0a84ff'];
export type TrackerState='idle'|'loading'|'ready'|'failed';
export interface InkStatus {tracker:TrackerState;hand:boolean;fps:number;ms:number;seg?:SegState;segMs?:number}
export const IDLE_STATUS:InkStatus={tracker:'idle',hand:false,fps:0,ms:0};
export const statusText=(s:InkStatus,ink:boolean)=>!ink?'Ink off':s.seg==='failed'?'Background failed, set to off':s.tracker==='failed'?'Tracker failed':s.tracker==='idle'?'Waiting for camera':s.tracker==='loading'?'Tracker starting':s.hand?'Tracking ok':'No hand';
