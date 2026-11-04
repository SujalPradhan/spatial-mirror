import {clampConc,type Blend,type Compliance,type Product,type Skin} from './model';
/** Everything a hand can change, and so everything 👎 can take back. */
export type Mode='compose'|'drydown'|'layering';
export interface OrganDoc {
 blend:Blend;skin:Skin;product:Product;
 /** Families fanned apart on the organ. */
 fan:boolean;mode:Mode;
 /** Finished blends bottled for the forearm, oldest first, at most three. */
 stack:Blend[];
 /** The last compliance pass, while it still describes the flask. */
 compliance:Compliance|null;
}
export const emptyDoc=():OrganDoc=>({blend:{items:[],conc:.15},skin:'normal',product:'leave-on',fan:false,mode:'compose',stack:[],compliance:null});
export const STACK_MAX=3;
export const layerName=(i:number)=>'ABC'[i]??String(i+1);
const copy=(d:OrganDoc):OrganDoc=>structuredClone(d);
/** Snapshots before each change. Undo restores the newest and says what it took back. */
export class History {
 private past:{doc:OrganDoc;what:string}[]=[];
 constructor(private limit=60){}
 get size(){return this.past.length;}
 get last(){return this.past[this.past.length-1]?.what??null;}
 push(before:OrganDoc,what:string){this.past.push({doc:copy(before),what});if(this.past.length>this.limit)this.past.shift();}
 undo():{doc:OrganDoc;what:string}|null{return this.past.pop()??null;}
 clear(){this.past=[];}
}
/** Applies one change, recording the state before it; the change sees a private copy. */
export function apply(doc:OrganDoc,history:History,what:string,change:(d:OrganDoc)=>void):OrganDoc{
 const next=copy(doc);change(next);next.blend.conc=clampConc(next.blend.conc);
 if(JSON.stringify(next)===JSON.stringify(doc))return doc;
 history.push(doc,what);return next;
}
