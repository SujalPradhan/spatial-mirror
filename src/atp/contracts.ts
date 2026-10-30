import type {Quat} from '../types';
export type AtpComponent='rotor'|'stator'|'head'|'membrane';
export type AtpTool='view'|'rotor';
export type AtpRepresentation='structure'|'mechanism';
export interface AtpViewState {q:Quat;zoom:number;x:number;y:number}
export interface AtpState {schema:1;chapter:number;guided:boolean;tool:AtpTool;representation:AtpRepresentation;phase:number;selected:AtpComponent|null;view:AtpViewState;frozen:boolean}
export interface AtpChapter {title:string;kicker:string;text:string;hint:string;focus:AtpComponent[];representation:AtpRepresentation;tool:AtpTool;view:AtpViewState}
export interface AtpStructureChain {id:string;name:string;component:Exclude<AtpComponent,'membrane'>;points:number[]}
export interface AtpStructureAsset {schema:'atp-structure-v1';pdb:'6OQR';units:'angstrom';source:string;sha256:string;representation:string;chains:AtpStructureChain[];anchors:Record<AtpComponent,[number,number,number]>}
export type AtpInputSource='phone'|'hand';
export interface AtpInputTarget {state():AtpState;navigation?():'orbit'|'pan'|'zoom';zoom?(value:number):void;pan?(x:number,y:number):void;begin(source:AtpInputSource):boolean;view(q:Quat):void;phase(value:number):void;end(source:AtpInputSource):void;status(message:string):void}
