import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import type {Calibration,Estimate} from './model';
export class TrackingView {
 private scene=new THREE.Scene();private renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});private camera=new THREE.PerspectiveCamera(45,1,1,5000);private controls:OrbitControls;
 private dot=new THREE.Mesh(new THREE.SphereGeometry(8,16,16),new THREE.MeshBasicMaterial({color:0xdd792e}));
 private rays=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x9fc3d6}));
 constructor(private el:HTMLElement){this.camera.position.set(600,350,200);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,0,-500);this.controls.update();el.append(this.renderer.domElement);this.scene.add(this.dot,this.rays);this.dot.visible=false;
 const grid=new THREE.GridHelper(1200,12,0x46606f,0x1f2e3a);grid.position.set(0,-250,-500);this.scene.add(grid);const origin=new THREE.AxesHelper(100);this.scene.add(origin);
 new ResizeObserver(()=>this.resize()).observe(el);this.resize();}
 private resize(){this.renderer.setSize(this.el.clientWidth,this.el.clientHeight);this.renderer.setPixelRatio(Math.min(2,devicePixelRatio));this.camera.aspect=this.el.clientWidth/this.el.clientHeight;this.camera.updateProjectionMatrix();}
 show(e:Estimate|null,c:Calibration|null){this.dot.visible=!!e;this.rays.visible=!!e&&!!c;if(!e||!c)return;const p=new THREE.Vector3(e.point[0],-e.point[1],-e.point[2]);this.dot.position.copy(p);
 const r=new THREE.Matrix3().set(...c.R as [number,number,number,number,number,number,number,number,number]).transpose();const t=new THREE.Vector3(...c.T).negate().applyMatrix3(r);t.set(t.x,-t.y,-t.z);this.rays.geometry.dispose();this.rays.geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),p,t,p]);}
 render(){this.controls.update();this.renderer.render(this.scene,this.camera);}
}
