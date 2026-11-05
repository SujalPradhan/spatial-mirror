import type {Items} from './accord';
import type {Compliance} from './model';
/** Everything a hand can change, and so everything 👎 can take back. */
export interface OrganDoc {
 /** Drops on the palm by material; fractional while pouring. */
 items:Items;
 /** Rubbed palms: warm skin lifts everything sooner. */
 warm:boolean;
 /** The oakmoss swap, once made. */
 swap:Compliance|null;
}
export const emptyDoc=():OrganDoc=>({items:{},warm:false,swap:null});
const copy=(d:OrganDoc):OrganDoc=>structuredClone(d);
/** Each entry undoes one change. Pours subtract, so two vials poured at once undo independently. */
interface Entry {what:string;undo(d:OrganDoc):void}
export class History {
 private past:Entry[]=[];
 constructor(private limit=80){}
 get size(){return this.past.length;}
 get last(){return this.past[this.past.length-1]?.what??null;}
 push(what:string,undo:(d:OrganDoc)=>void){this.past.push({what,undo});if(this.past.length>this.limit)this.past.shift();}
 /** A whole-document snapshot, for changes that are not a simple pour. */
 snapshot(what:string,before:OrganDoc){const saved=copy(before);this.push(what,d=>{Object.assign(d,copy(saved));});}
 undo(doc:OrganDoc):{doc:OrganDoc;what:string}|null{const e=this.past.pop();if(!e)return null;const next=copy(doc);e.undo(next);clean(next);return {doc:next,what:e.what};}
 clear(){this.past=[];}
}
/** Drops that rounding left behind are not on the palm. */
export function clean(d:OrganDoc){for(const id of Object.keys(d.items))if(!(d.items[id]>1e-3))delete d.items[id];return d;}
/** A pour session: add drops now, and one undo takes the whole session back. */
export function pourUndo(id:string,drops:number){return (d:OrganDoc)=>{d.items[id]=(d.items[id]??0)-drops;};}
