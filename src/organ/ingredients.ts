/** The organ's materials. Every number is illustrative: plausible in order and in kind, not measured, and not a formulation reference. */
export type Family='citrus'|'green'|'floral'|'spicy'|'woody'|'amber'|'musk';
export const families:Family[]=['citrus','green','floral','spicy','woody','amber','musk'];
export const familyColor:Record<Family,string>={citrus:'#ffd84a',green:'#9fdc6a',floral:'#ff8fb8',spicy:'#ff7a3c',woody:'#c08a55',amber:'#ff9e2c',musk:'#e9dcff'};
/** Declarable fragrance allergens used here. since 2003 is the original 26 (Directive 2003/15/EC); since 2023 is added by Regulation (EU) 2023/1545. */
export interface Allergen {id:string;name:string;since:2003|2023;
 /** Illustrative ceiling in the finished product, %: a stand-in for use restrictions on strong sensitisers, not a regulatory number. */
 cap?:number}
export const allergens:Allergen[]=[
 {id:'limonene',name:'Limonene',since:2003},
 {id:'linalool',name:'Linalool',since:2003},
 {id:'citral',name:'Citral',since:2003,cap:.6},
 {id:'geraniol',name:'Geraniol',since:2003},
 {id:'citronellol',name:'Citronellol',since:2003},
 {id:'eugenol',name:'Eugenol',since:2003,cap:.5},
 {id:'isoeugenol',name:'Isoeugenol',since:2003,cap:.02},
 {id:'cinnamal',name:'Cinnamal',since:2003,cap:.05},
 {id:'coumarin',name:'Coumarin',since:2003,cap:1.6},
 {id:'farnesol',name:'Farnesol',since:2003},
 {id:'benzyl-benzoate',name:'Benzyl benzoate',since:2003},
 {id:'benzyl-salicylate',name:'Benzyl salicylate',since:2003},
 {id:'benzyl-alcohol',name:'Benzyl alcohol',since:2003},
 {id:'oakmoss',name:'Oakmoss extract',since:2003,cap:.1},
 {id:'linalyl-acetate',name:'Linalyl acetate',since:2023},
 {id:'alpha-pinene',name:'Alpha-pinene',since:2023},
 {id:'caryophyllene',name:'Beta-caryophyllene',since:2023},
 {id:'eucalyptol',name:'Eucalyptol',since:2023},
 {id:'camphor',name:'Camphor',since:2023},
 {id:'vanillin',name:'Vanillin',since:2023},
 {id:'santalol',name:'Santalol',since:2023},
 {id:'terpineol',name:'Terpineol',since:2023},
];
export const allergenById=new Map(allergens.map(a=>[a.id,a]));
export interface Ingredient {
 id:string;name:string;family:Family;color:string;
 /** e-folding time on skin in hours: the vapour-pressure-like volatility. Small is fleeting. */
 tau:number;
 /** Relative odour strength, for how much a material shapes the character. */
 strength:number;
 words:string[];
 /** Mass fraction of each declarable allergen in the material. */
 allergens:Record<string,number>;
 /** A gentler stand-in the compliance pass may use, and how much of the character it keeps. */
 substitute?:string;fidelity?:number;
 /** Not on the organ: only compliance brings it in. */
 hidden?:boolean;
}
const I=(id:string,name:string,family:Family,color:string,tau:number,strength:number,words:string[],allergens:Record<string,number>,more:Partial<Ingredient>={}):Ingredient=>({id,name,family,color,tau,strength,words,allergens,...more});
export const ingredients:Ingredient[]=[
 I('bergamot','Bergamot','citrus','#f6e05a',.35,1,['sparkling','bitter-sweet','tea'],{limonene:.38,'linalyl-acetate':.28,linalool:.12}),
 I('lemon','Lemon','citrus','#fff07a',.25,1.1,['zesty','sharp','clean'],{limonene:.65,citral:.03,'alpha-pinene':.02}),
 I('mandarin','Mandarin','citrus','#ffb547',.3,.9,['juicy','sweet','sunny'],{limonene:.7,linalool:.02}),
 I('pink-pepper','Pink pepper','spicy','#ff9aa8',.7,1.2,['peppery','rosy','fizzy'],{limonene:.2,'alpha-pinene':.2,caryophyllene:.05}),
 I('galbanum','Galbanum','green','#8fd16a',.8,1.6,['crushed stems','bitter','sap'],{'alpha-pinene':.1}),
 I('petitgrain','Petitgrain','green','#c4e27a',.9,.9,['leafy','woody-citrus','bright'],{'linalyl-acetate':.5,linalool:.25,geraniol:.03,terpineol:.05}),
 I('lavender','Lavender','floral','#b9a2ff',1.2,1,['herbal','fresh','soapy'],{linalool:.35,'linalyl-acetate':.35,camphor:.01,eucalyptol:.01,limonene:.01}),
 I('rose','Rose','floral','#ff6f9a',2.2,1.1,['velvet','honeyed','petal'],{citronellol:.35,geraniol:.18,eugenol:.02,farnesol:.01}),
 I('jasmine','Jasmine','floral','#fff3cf',2.8,1.4,['heady','creamy','indolic'],{'benzyl-benzoate':.2,linalool:.05,'benzyl-alcohol':.03,eugenol:.02}),
 I('ylang','Ylang-ylang','floral','#ffe08a',3.2,1.2,['banana-cream','narcotic','sweet'],{linalool:.1,'benzyl-benzoate':.07,'benzyl-salicylate':.04,caryophyllene:.1,geraniol:.01,farnesol:.02}),
 I('clove','Clove','spicy','#c2562a',1.6,1.5,['hot','dental','warm'],{eugenol:.8,caryophyllene:.1,isoeugenol:.002},{substitute:'clove-accord',fidelity:.65}),
 I('cinnamon','Cinnamon bark','spicy','#d9692c',2,1.5,['red-hot','sweet','bark'],{cinnamal:.6,eugenol:.06,coumarin:.005,linalool:.03},{substitute:'cinnamon-accord',fidelity:.6}),
 I('cedar','Cedar','woody','#d1a06c',9,.8,['pencil shavings','dry','straight'],{}),
 I('sandalwood','Sandalwood','woody','#e6c08e',14,.7,['milky','soft','creamy wood'],{santalol:.75}),
 I('vetiver','Vetiver','woody','#8f9a5a',12,1.1,['earthy','smoky','roots'],{}),
 I('oakmoss','Oakmoss','woody','#6f8a5c',15,1.3,['forest floor','inky','damp'],{oakmoss:1},{substitute:'moss-accord',fidelity:.55}),
 I('tonka','Tonka bean','amber','#c9874a',16,1.1,['almond','hay','caramel'],{coumarin:.45},{substitute:'tonka-accord',fidelity:.7}),
 I('vanilla','Vanilla','amber','#f2d39a',18,1,['sweet','balsamic','creamy'],{vanillin:.12,'benzyl-benzoate':.02}),
 I('musk','White musk','musk','#efe9ff',30,.6,['skin','clean laundry','soft'],{}),
 I('ambrette','Ambrette','musk','#f4dccd',22,.8,['powdery','pear skin','warm'],{farnesol:.02}),
 // Stand-ins: generic accords with most of the flagged material taken out.
 I('clove-accord','Clove accord','spicy','#b8603a',1.6,1.1,['warm','softened spice'],{eugenol:.06,caryophyllene:.08},{hidden:true}),
 I('cinnamon-accord','Cinnamon accord','spicy','#c9773e',2,1.1,['sweet spice','rounded'],{cinnamal:.005,eugenol:.01},{hidden:true}),
 I('moss-accord','Moss accord','woody','#7d9466',13,.9,['damp','green-woody','lighter'],{oakmoss:.01},{hidden:true}),
 I('tonka-accord','Tonka accord','amber','#c79562',14,.85,['almond','softer hay'],{coumarin:.08},{hidden:true}),
];
export const ingredientById=new Map(ingredients.map(i=>[i.id,i]));
/** Materials on the organ, in organ order. */
export const organ=ingredients.filter(i=>!i.hidden);
export type NoteClass='top'|'heart'|'base';
/** Perfumery's pyramid by volatility: under an hour is a top note, past five hours a base note. */
export const noteClass=(tau:number):NoteClass=>tau<1?'top':tau<5?'heart':'base';
export const halfLife=(tau:number)=>tau*Math.LN2;
