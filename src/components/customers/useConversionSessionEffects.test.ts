import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

test('a customer deep link survives the default inbox selection and releases selection after the requested view loads',()=>{
  const effects:Array<()=>void>=[],exports:any={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./useConversionSessionEffects.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
    exports,URLSearchParams,window:{location:{search:'?customer=target&followupDraft=1'}},
    require(name:string){if(name==='react')return {useEffect:(fn:()=>void)=>effects.push(fn)};if(name.endsWith('/auth'))return {authHeader:()=>({})};return {};},
  });
  const target={id:'target',stage:'lead'},other={id:'other',stage:'lead'};
  const deepLinkConsumedRef={current:false};let selected:string|null=null,view='inbox';
  const render=(items:unknown[])=>{
    effects.length=0;
    exports.useConversionSessionEffects({customers:[other,target],customersInActiveView:items,selectedId:selected,deepLinkConsumedRef,filterEmptySelectionRef:{current:false},setSelectedId:(id:string)=>selected=id,setView:(next:string)=>view=next});
    effects[0]();effects[1]();
  };
  render([other]);assert.equal(selected,'target');assert.equal(view,'leads');assert.equal(deepLinkConsumedRef.current,false);
  render([other,target]);assert.equal(selected,'target');assert.equal(deepLinkConsumedRef.current,true);
  selected='other';render([other,target]);assert.equal(selected,'other','ordinary manual selection remains available after the navigation is consumed');
});
