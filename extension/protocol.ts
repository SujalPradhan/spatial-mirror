export const NS='sm-ink';
export interface InkConfig {ink:boolean;keep:boolean;lightboard:boolean;colour:string;clearAt:number}
export const DEFAULT_CONFIG:InkConfig={ink:true,keep:false,lightboard:true,colour:'#ff3b30',clearAt:0};
export const COLOURS=['#ff3b30','#ffd60a','#30d158','#0a84ff'];
export type TrackerState='idle'|'loading'|'ready'|'failed';
export interface InkStatus {tracker:TrackerState;hand:boolean;fps:number;ms:number}
export const IDLE_STATUS:InkStatus={tracker:'idle',hand:false,fps:0,ms:0};
export const statusText=(s:InkStatus,ink:boolean)=>!ink?'Ink off':s.tracker==='failed'?'Tracker failed':s.tracker==='idle'?'Waiting for camera':s.tracker==='loading'?'Tracker starting':s.hand?'Tracking ok':'No hand';
