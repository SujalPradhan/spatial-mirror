import './workspace-nav.css';
import type {Solid} from './geometry';

export const shapeRoutes: Record<Solid,string> = {cone:'/cone',cylinder:'/cylinder',cube:'/cube'};
export function shapeFromPath(path:string):Solid|null {
 return (Object.keys(shapeRoutes) as Solid[]).find(s=>shapeRoutes[s]===path.replace(/\/$/,''))??null;
}
// One list for every desktop workspace. Shape switches keep the live camera session.
export function workspaceNav(localShapes=false){
 const shapes=(Object.keys(shapeRoutes) as Solid[]).map(s=>localShapes
  ? `<button type="button" data-solid="${s}" aria-pressed="false">${s[0].toUpperCase()+s.slice(1)}</button>`
  : `<a href="${shapeRoutes[s]}">${s[0].toUpperCase()+s.slice(1)}</a>`).join('');
 return `<nav class="workspace-nav" aria-label="Workspaces">${shapes}<a href="/mechanism" ${location.pathname.startsWith('/mechanism')?'aria-current="page"':''}>Mechanism Studio</a><a href="/art" ${location.pathname==='/art'?'aria-current="page"':''}>Art</a><a href="/pottery" ${location.pathname==='/pottery'?'aria-current="page"':''}>Pottery</a><a href="/maths" ${location.pathname==='/maths'?'aria-current="page"':''}>Maths</a><a href="/atp" ${location.pathname.replace(/\/$/,'')==='/atp'?'aria-current="page"':''}>ATP synthase</a><a href="/tracking" ${location.pathname==='/tracking'?'aria-current="page"':''}>Tracking lab</a></nav>`;
}
